// Creating a hold is the moment two guests can race for the same nights (§4, §5).
// The database decides: the occupancy exclusion constraint rejects the loser,
// whatever the timing. This code only translates that rejection.

import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bookings } from "@/db/schema";
import type { IsoDate } from "@/lib/dates";
import type { Quote } from "@/lib/pricing/quote";
import { newBookingCode } from "./code";

/** ASSUMPTION: 30 minutes, the shortest expiry Stripe Checkout allows. Owner to confirm. */
export const HOLD_MINUTES = 30;

export type HoldInput = {
  propertyId: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  guests: number;
  pets: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  message?: string;
  policyVersion: string;
  /** Must come from quoteStay() on the server, never from the browser. */
  quote: Quote;
};

export type HoldResult =
  { ok: true; bookingId: string; code: string; holdExpiresAt: Date } | { ok: false; reason: "DATES_TAKEN" };

const EXCLUSION_VIOLATION = "23P01";
const UNIQUE_VIOLATION = "23505";

function pgCode(error: unknown): string | undefined {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export async function createHold(db: Db, input: HoldInput, now = new Date()): Promise<HoldResult> {
  const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newBookingCode();
    try {
      const [row] = await db.transaction(async (tx) => {
        // A stale hold must never block a paying guest.
        await tx.execute(sql`select release_expired_holds(${input.propertyId}::uuid)`);
        return tx
          .insert(bookings)
          .values({
            code,
            propertyId: input.propertyId,
            source: "WEB",
            status: "HOLD",
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            guests: input.guests,
            pets: input.pets,
            guestName: input.guestName,
            guestEmail: input.guestEmail,
            guestPhone: input.guestPhone,
            message: input.message ?? null,
            quote: input.quote,
            totalCents: input.quote.totalCents,
            policyVersion: input.policyVersion,
            holdExpiresAt,
          })
          .returning({ id: bookings.id });
      });
      return { ok: true, bookingId: row.id, code, holdExpiresAt };
    } catch (error) {
      const pg = pgCode(error);
      if (pg === EXCLUSION_VIOLATION) return { ok: false, reason: "DATES_TAKEN" };
      if (pg === UNIQUE_VIOLATION) continue; // booking code collision, try a new one
      throw error;
    }
  }
  throw new Error("Could not allocate a unique booking code");
}
