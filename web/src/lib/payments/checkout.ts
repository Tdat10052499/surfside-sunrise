// From "Request these dates" to Stripe Checkout: price on the server, hold the
// nights, open a Checkout Session that only authorises the card.
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bookings, properties } from "@/db/schema";
import { CHECKOUT_MINUTES, createHold } from "@/lib/booking/hold";
import type { IsoDate } from "@/lib/dates";
import { findHome, quoteHome, type PublicQuoteError } from "@/lib/public/homes";
import type { QuoteLine } from "@/lib/pricing/quote";
import type { StripeGateway } from "./gateway";

/** ASSUMPTION: no policy text is published yet; bookings record which version the guest accepted. */
export const POLICY_VERSION = "draft-2026-11";

export type CheckoutInput = {
  slug: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  guests: number;
  pets: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  message?: string;
};

export type CheckoutResult =
  | { ok: true; code: string; checkoutUrl: string }
  | { ok: false; error: PublicQuoteError | { code: "PAYMENTS_OFF" } | { code: "PAYMENT_ERROR" } };

export async function startCheckout(
  db: Db,
  input: CheckoutInput,
  deps: { gateway: StripeGateway | null; origin: string; now?: Date },
): Promise<CheckoutResult> {
  const now = deps.now ?? new Date();
  // Never take prices from the browser: quote again here.
  const quoted = await quoteHome(db, input.slug, input, now);
  if (!quoted.ok) return quoted;
  if (!deps.gateway) return { ok: false, error: { code: "PAYMENTS_OFF" } };
  const home = (await findHome(db, input.slug))!;

  const hold = await createHold(
    db,
    {
      propertyId: home.id,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      guests: input.guests,
      pets: input.pets,
      guestName: input.guestName,
      guestEmail: input.guestEmail,
      guestPhone: input.guestPhone,
      message: input.message,
      policyVersion: POLICY_VERSION,
      quote: quoted.quote,
    },
    now,
  );
  if (!hold.ok) return { ok: false, error: { code: "DATES_TAKEN", taken: [] } };

  try {
    const session = await deps.gateway.createCheckout({
      bookingId: hold.bookingId,
      bookingCode: hold.code,
      currency: quoted.currency,
      lines: quoted.quote.lines.map((l) => ({ name: lineName(l, home.name), amountCents: l.amountCents })),
      customerEmail: input.guestEmail,
      description: `${home.name}, ${input.checkIn} to ${input.checkOut} (${hold.code})`,
      expiresAt: new Date(now.getTime() + CHECKOUT_MINUTES * 60_000),
      successUrl: `${deps.origin}/book/done?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${deps.origin}/book/cancelled?session_id={CHECKOUT_SESSION_ID}`,
    });
    await db.update(bookings).set({ stripeCheckoutSessionId: session.id }).where(eq(bookings.id, hold.bookingId));
    return { ok: true, code: hold.code, checkoutUrl: session.url };
  } catch (e) {
    console.error(`Checkout for ${hold.code} failed: ${(e as Error).message}`);
    await releaseHold(db, hold.bookingId);
    return { ok: false, error: { code: "PAYMENT_ERROR" } };
  }
}

function lineName(line: QuoteLine, homeName: string): string {
  return line.code === "NIGHTS" ? `${homeName}: ${line.label}` : line.label;
}

/** Frees the nights of a hold that will not be paid. Does nothing to any other status. */
async function releaseHold(db: Db, bookingId: string): Promise<boolean> {
  const rows = await db
    .update(bookings)
    .set({ status: "EXPIRED" })
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, "HOLD")))
    .returning({ id: bookings.id });
  return rows.length > 0;
}

/**
 * The guest pressed "back" on Stripe's page: free the nights now instead of in 35
 * minutes, and close the Checkout Session so it can't be paid later.
 */
export async function cancelCheckout(db: Db, sessionId: string, gateway: StripeGateway | null) {
  const booking = await bookingBySession(db, sessionId);
  if (!booking) return null;
  if (booking.status === "HOLD") {
    // Close the payment page first: if that fails, the hold simply runs out.
    try {
      await gateway?.expireCheckout(sessionId);
    } catch {
      return booking;
    }
    await releaseHold(db, booking.id);
    return { ...booking, status: "EXPIRED" as const };
  }
  return booking;
}

export type GuestBooking = {
  code: string;
  homeName: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  guests: number;
  pets: number;
  status: (typeof bookings.$inferSelect)["status"];
  statusReason: (typeof bookings.$inferSelect)["statusReason"];
  totalCents: number | null;
  currency: string;
  lines: QuoteLine[];
};

const guestColumns = {
  id: bookings.id,
  code: bookings.code,
  homeName: properties.name,
  checkIn: bookings.checkIn,
  checkOut: bookings.checkOut,
  guests: bookings.guests,
  pets: bookings.pets,
  status: bookings.status,
  statusReason: bookings.statusReason,
  totalCents: bookings.totalCents,
  currency: properties.currency,
  quote: bookings.quote,
};

function toGuest(row: { quote: unknown } & Omit<GuestBooking, "lines"> & { id: string }) {
  const { quote, ...rest } = row;
  return { ...rest, lines: ((quote as { lines?: QuoteLine[] } | null)?.lines ?? []) as QuoteLine[] };
}

export async function bookingBySession(db: Db, sessionId: string) {
  const [row] = await db
    .select(guestColumns)
    .from(bookings)
    .innerJoin(properties, eq(properties.id, bookings.propertyId))
    .where(eq(bookings.stripeCheckoutSessionId, sessionId));
  return row ? toGuest(row) : null;
}

/** A guest's own booking, found by its code and the email it was made with. */
export async function lookupBooking(db: Db, code: string, email: string): Promise<GuestBooking | null> {
  const [row] = await db
    .select(guestColumns)
    .from(bookings)
    .innerJoin(properties, eq(properties.id, bookings.propertyId))
    .where(
      and(
        eq(bookings.code, code.trim().toUpperCase()),
        sql`lower(${bookings.guestEmail}) = ${email.trim().toLowerCase()}`,
        eq(bookings.source, "WEB"),
      ),
    );
  if (!row) return null;
  const { id, ...guest } = toGuest(row);
  void id; // internal; not for the guest
  return guest;
}
