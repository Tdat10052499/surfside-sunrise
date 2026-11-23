// The host's decisions on a booking (§5, §7): approve (charge the card), decline
// (release it), cancel with a refund, move the dates, and the deadline that expires
// requests nobody answered.
//
// Each change runs in one transaction that locks the booking row, writes the new
// status first and calls Stripe last: if Stripe fails, the status change rolls back,
// and a Stripe webhook arriving meanwhile waits for the lock and then sees the new
// status, so it never undoes a decision.
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bookings, properties } from "@/db/schema";
import type { IsoDate } from "@/lib/dates";
import type { StripeGateway } from "@/lib/payments/gateway";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Status = (typeof bookings.$inferSelect)["status"];

export type HostError =
  | "NOT_FOUND"
  | "WRONG_STATUS" // the booking is not in a state this action applies to (maybe changed meanwhile)
  | "NO_PAYMENT" // nothing to charge or refund through Stripe
  | "PAYMENTS_OFF" // Stripe isn't connected
  | "BAD_AMOUNT"
  | "DATES_TAKEN"
  | "BAD_DATES"
  | "STRIPE_ERROR";

export type HostResult = { ok: true; status: Status } | { ok: false; error: HostError; detail?: string };

const EXCLUSION_VIOLATION = "23P01";

class Refusal extends Error {
  constructor(
    readonly error: HostError,
    readonly detail?: string,
  ) {
    super(error);
  }
}

async function locked(tx: Tx, id: string) {
  const [row] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
  if (!row) throw new Refusal("NOT_FOUND");
  return row;
}

async function run(db: Db, work: (tx: Tx) => Promise<Status>): Promise<HostResult> {
  try {
    return { ok: true, status: await db.transaction(work) };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: e.error, detail: e.detail };
    if (pgCode(e) === EXCLUSION_VIOLATION) return { ok: false, error: "DATES_TAKEN" };
    if (isStripeError(e)) return { ok: false, error: "STRIPE_ERROR", detail: scrub((e as Error).message) };
    throw e;
  }
}

/** Approve: charge the authorised card. The booking is confirmed. */
export function approveBooking(db: Db, id: string, gateway: StripeGateway | null): Promise<HostResult> {
  return run(db, async (tx) => {
    const b = await locked(tx, id);
    if (b.status !== "AWAITING_APPROVAL") throw new Refusal("WRONG_STATUS");
    if (!b.stripePaymentIntentId) throw new Refusal("NO_PAYMENT");
    if (!gateway) throw new Refusal("PAYMENTS_OFF");
    await tx
      .update(bookings)
      .set({ status: "CONFIRMED", decidedAt: sql`now()`, statusReason: null })
      .where(eq(bookings.id, id));
    await stripeCall(() => gateway.capturePaymentIntent(b.stripePaymentIntentId!));
    return "CONFIRMED";
  });
}

/** Decline: release the authorisation; the guest is never charged. Frees the nights. */
export function declineBooking(db: Db, id: string, gateway: StripeGateway | null, note?: string): Promise<HostResult> {
  return run(db, async (tx) => {
    const b = await locked(tx, id);
    if (b.status !== "AWAITING_APPROVAL") throw new Refusal("WRONG_STATUS");
    if (b.stripePaymentIntentId && !gateway) throw new Refusal("PAYMENTS_OFF");
    await tx
      .update(bookings)
      .set({ status: "REJECTED", statusReason: "HOST_DECLINED", decidedAt: sql`now()`, hostNote: note || null })
      .where(eq(bookings.id, id));
    if (b.stripePaymentIntentId) await stripeCall(() => gateway!.cancelPaymentIntent(b.stripePaymentIntentId!));
    return "REJECTED";
  });
}

/**
 * Cancel a confirmed booking, refunding `refundCents` (0 up to what is left to refund).
 * A web booking's refund goes back to the guest's card through Stripe; a booking
 * entered by hand (Airbnb, phone) has no card here, so only 0 is accepted.
 */
export function cancelBooking(
  db: Db,
  id: string,
  refundCents: number,
  gateway: StripeGateway | null,
  note?: string,
): Promise<HostResult> {
  return run(db, async (tx) => {
    const b = await locked(tx, id);
    if (b.status !== "CONFIRMED") throw new Refusal("WRONG_STATUS");
    const refundable = Math.max(0, (b.totalCents ?? 0) - b.refundedCents);
    if (!Number.isInteger(refundCents) || refundCents < 0 || refundCents > refundable) {
      throw new Refusal("BAD_AMOUNT", `between 0 and ${refundable}`);
    }
    if (refundCents > 0 && !b.stripePaymentIntentId) throw new Refusal("NO_PAYMENT");
    if (refundCents > 0 && !gateway) throw new Refusal("PAYMENTS_OFF");
    const refunded = b.refundedCents + refundCents;
    const status: Status = b.totalCents !== null && refunded >= b.totalCents && refunded > 0 ? "REFUNDED" : "CANCELLED";
    await tx
      .update(bookings)
      .set({ status, statusReason: "HOST_CANCELLED", refundedCents: refunded, hostNote: note || null })
      .where(eq(bookings.id, id));
    if (refundCents > 0) {
      // Same key on a retry, so a double click or a retried request refunds once.
      const key = `cancel-${id}-${b.refundedCents}-${refundCents}`;
      await stripeCall(() => gateway!.refund(b.stripePaymentIntentId!, refundCents, key));
    }
    return status;
  });
}

/**
 * Move a booking to other nights of the same home. The price is not recalculated or
 * charged again: ASSUMPTION until the owner sets a rule, the host settles any
 * difference with the guest and notes it here.
 */
export function changeDates(
  db: Db,
  id: string,
  dates: { checkIn: IsoDate; checkOut: IsoDate },
  note?: string,
): Promise<HostResult> {
  return run(db, async (tx) => {
    const b = await locked(tx, id);
    if (b.status !== "AWAITING_APPROVAL" && b.status !== "CONFIRMED") throw new Refusal("WRONG_STATUS");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dates.checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(dates.checkOut)) {
      throw new Refusal("BAD_DATES");
    }
    if (dates.checkOut <= dates.checkIn) throw new Refusal("BAD_DATES");
    // The occupancy constraint refuses nights held by anyone else (run() maps it).
    await tx
      .update(bookings)
      .set({ checkIn: dates.checkIn, checkOut: dates.checkOut, hostNote: note || b.hostNote })
      .where(eq(bookings.id, id));
    return b.status;
  });
}

/**
 * Requests the host did not answer in time: release the card and free the nights.
 * Run by the daily cron and whenever the host opens the bookings list. Returns how
 * many expired; one Stripe failure doesn't stop the others.
 */
export async function expireOverdueApprovals(
  db: Db,
  gateway: StripeGateway | null,
  now: Date = new Date(),
): Promise<{ expired: number; failed: number }> {
  const due = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.status, "AWAITING_APPROVAL"), lte(bookings.approveBy, now)));
  let expired = 0;
  let failed = 0;
  for (const { id } of due) {
    const r = await run(db, async (tx) => {
      const b = await locked(tx, id);
      if (b.status !== "AWAITING_APPROVAL" || !b.approveBy || b.approveBy > now) throw new Refusal("WRONG_STATUS");
      if (b.stripePaymentIntentId && !gateway) throw new Refusal("PAYMENTS_OFF");
      await tx.update(bookings).set({ status: "EXPIRED", statusReason: "APPROVAL_TIMEOUT" }).where(eq(bookings.id, id));
      if (b.stripePaymentIntentId) await stripeCall(() => gateway!.cancelPaymentIntent(b.stripePaymentIntentId!));
      return "EXPIRED";
    });
    if (r.ok) expired++;
    else if (r.error !== "WRONG_STATUS") failed++;
  }
  return { expired, failed };
}

// Reading -----------------------------------------------------------------------

export type BookingFilter = "awaiting" | "upcoming" | "all";

export async function listBookings(db: Db, filter: BookingFilter, today: IsoDate) {
  const where =
    filter === "awaiting"
      ? eq(bookings.status, "AWAITING_APPROVAL")
      : filter === "upcoming"
        ? and(inArray(bookings.status, ["CONFIRMED", "AWAITING_APPROVAL"]), sql`${bookings.checkOut} >= ${today}`)
        : sql`${bookings.status} <> 'HOLD' or ${bookings.holdExpiresAt} > now()`;
  return db
    .select({
      id: bookings.id,
      code: bookings.code,
      homeName: properties.name,
      source: bookings.source,
      status: bookings.status,
      statusReason: bookings.statusReason,
      checkIn: bookings.checkIn,
      checkOut: bookings.checkOut,
      guests: bookings.guests,
      pets: bookings.pets,
      guestName: bookings.guestName,
      totalCents: bookings.totalCents,
      refundedCents: bookings.refundedCents,
      approveBy: bookings.approveBy,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .innerJoin(properties, eq(properties.id, bookings.propertyId))
    .where(where)
    .orderBy(filter === "all" ? sql`${bookings.createdAt} desc` : bookings.checkIn)
    .limit(200);
}

export async function bookingDetail(db: Db, code: string) {
  const [row] = await db
    .select({ booking: bookings, homeName: properties.name, currency: properties.currency })
    .from(bookings)
    .innerJoin(properties, eq(properties.id, bookings.propertyId))
    .where(eq(bookings.code, code.trim().toUpperCase()));
  return row ?? null;
}

/** Numbers for the dashboard overview (§7). */
export async function overview(db: Db, today: IsoDate) {
  const [row] = await db.execute<{
    awaiting: number;
    upcoming: number;
    homes: number;
    published: number;
  }>(sql`
    select
      (select count(*)::int from bookings where status = 'AWAITING_APPROVAL') as awaiting,
      (select count(*)::int from bookings where status = 'CONFIRMED'
         and check_in between ${today}::date and ${today}::date + 14) as upcoming,
      (select count(*)::int from properties) as homes,
      (select count(*)::int from properties where status = 'PUBLISHED') as published
  `);
  return row;
}

// Helpers -----------------------------------------------------------------------

class StripeFailure extends Error {}

async function stripeCall(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    throw new StripeFailure((e as Error).message);
  }
}

function isStripeError(e: unknown) {
  return e instanceof StripeFailure;
}

/** Stripe messages can quote a key; never show one on the page. */
function scrub(msg: string) {
  return msg.replace(/\b(sk|rk|pk)_(test|live)_[A-Za-z0-9]+/g, "[key]").slice(0, 300);
}

function pgCode(error: unknown): string | undefined {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}
