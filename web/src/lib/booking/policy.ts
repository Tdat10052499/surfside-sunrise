// Booking rules the owner will set in the dashboard (step 8). Until then the
// defaults below apply; each is marked ASSUMPTION because the owner hasn't chosen.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { siteSettings } from "@/db/schema";

export type BookingPolicy = {
  /** Hours the host has to approve or decline after the card is authorised. */
  approvalHours: number;
};

/** ASSUMPTION: 48 hours, as suggested in the payment guidance; owner to confirm. */
export const DEFAULT_POLICY: BookingPolicy = { approvalHours: 48 };

/**
 * A card authorisation lasts about 7 days (online card payments). The decision
 * deadline stays well inside that so an approval can always be captured.
 */
export const MAX_APPROVAL_HOURS = 6 * 24;

export async function bookingPolicy(db: Pick<Db, "select">): Promise<BookingPolicy> {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, "booking_policy"));
  const stored = (row?.value ?? {}) as Partial<BookingPolicy>;
  const hours = Number(stored.approvalHours);
  return {
    approvalHours:
      Number.isFinite(hours) && hours >= 1 ? Math.min(hours, MAX_APPROVAL_HOURS) : DEFAULT_POLICY.approvalHours,
  };
}

export function approvalDeadline(policy: BookingPolicy, authorisedAt: Date): Date {
  return new Date(authorisedAt.getTime() + Math.min(policy.approvalHours, MAX_APPROVAL_HOURS) * 3_600_000);
}
