// What the site does with each Stripe event (§5): a booking only counts as paid when
// a signed event says so, each event is applied once, and the amount Stripe
// authorised must equal the price the server quoted.
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import type { Db } from "@/db/client";
import { bookings, properties, stripeEvents, type StatusReason } from "@/db/schema";
import { approvalDeadline, bookingPolicy } from "@/lib/booking/policy";
import type { StripeGateway } from "./gateway";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type WebhookOutcome =
  | "duplicate" // seen before; nothing done
  | "ignored" // not about a booking of this site, or nothing to change
  | "awaiting_approval"
  | "confirmed"
  | "expired"
  | "released" // authorised but refused (amount or dates); the hold on the card was released
  | "refund_recorded";

const EXCLUSION_VIOLATION = "23P01";

/**
 * Applies one verified event. The event id is recorded in the same transaction as
 * its effect, so a retry after a crash runs it again and a duplicate does nothing.
 * Throws if Stripe has to be called and fails: the transaction rolls back and the
 * route answers 500, so Stripe retries later.
 */
export async function handleStripeEvent(
  db: Db,
  event: Stripe.Event,
  gateway: StripeGateway | null,
  now: Date = new Date(),
): Promise<WebhookOutcome> {
  return db.transaction(async (tx) => {
    const [fresh] = await tx
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    if (!fresh) return "duplicate";

    switch (event.type) {
      case "checkout.session.completed":
        return linkPaymentIntent(tx, event.data.object);
      case "checkout.session.expired":
        return expireCheckout(tx, event.data.object);
      case "payment_intent.amount_capturable_updated":
        return authorised(tx, event.data.object, gateway, now);
      case "payment_intent.succeeded":
        return captured(tx, event.data.object);
      case "payment_intent.canceled":
        return canceled(tx, event.data.object);
      case "charge.refunded":
        return refunded(tx, event.data.object);
      default:
        // payment_intent.payment_failed: the guest can try another card on the same
        // Checkout page; if they give up, checkout.session.expired frees the nights.
        return "ignored";
    }
  });
}

/** The booking a PaymentIntent pays for: by our metadata, else by the stored id. */
async function bookingForIntent(tx: Tx, pi: Stripe.PaymentIntent) {
  const bookingId = pi.metadata?.booking_id;
  const [row] = await tx
    .select({
      id: bookings.id,
      status: bookings.status,
      totalCents: bookings.totalCents,
      currency: properties.currency,
      paymentIntentId: bookings.stripePaymentIntentId,
    })
    .from(bookings)
    .innerJoin(properties, eq(properties.id, bookings.propertyId))
    .where(
      bookingId && isUuid(bookingId)
        ? or(eq(bookings.id, bookingId), eq(bookings.stripePaymentIntentId, pi.id))
        : eq(bookings.stripePaymentIntentId, pi.id),
    )
    .for("update");
  return row ?? null;
}

async function linkPaymentIntent(tx: Tx, session: Stripe.Checkout.Session): Promise<WebhookOutcome> {
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!pi) return "ignored";
  await tx
    .update(bookings)
    .set({ stripePaymentIntentId: pi })
    .where(and(eq(bookings.stripeCheckoutSessionId, session.id), sql`${bookings.stripePaymentIntentId} is null`));
  // The status moves on payment_intent.amount_capturable_updated, which carries the amount.
  return "ignored";
}

async function expireCheckout(tx: Tx, session: Stripe.Checkout.Session): Promise<WebhookOutcome> {
  const rows = await tx
    .update(bookings)
    .set({ status: "EXPIRED", statusReason: "CHECKOUT_EXPIRED" })
    .where(and(eq(bookings.stripeCheckoutSessionId, session.id), eq(bookings.status, "HOLD")))
    .returning({ id: bookings.id });
  return rows.length ? "expired" : "ignored";
}

/** The card is authorised for the full amount: the booking waits for the host. */
async function authorised(
  tx: Tx,
  pi: Stripe.PaymentIntent,
  gateway: StripeGateway | null,
  now: Date,
): Promise<WebhookOutcome> {
  if (pi.status !== "requires_capture") return "ignored";
  const booking = await bookingForIntent(tx, pi);
  if (!booking) return "ignored";
  // Already past this point (a late or reordered event).
  if (booking.status !== "HOLD" && booking.status !== "EXPIRED") return "ignored";

  const release = async (reason: StatusReason): Promise<WebhookOutcome> => {
    await tx
      .update(bookings)
      .set({ status: "EXPIRED", statusReason: reason, stripePaymentIntentId: pi.id })
      .where(eq(bookings.id, booking.id));
    if (!gateway) throw new Error("Stripe is not connected; cannot release the authorisation.");
    await gateway.cancelPaymentIntent(pi.id);
    console.warn(`Released authorisation ${pi.id} for booking ${booking.id}: ${reason}`);
    return "released";
  };

  const amountOk =
    booking.totalCents !== null &&
    pi.amount_capturable === booking.totalCents &&
    pi.currency.toLowerCase() === booking.currency.toLowerCase();
  if (!amountOk) return release("AMOUNT_MISMATCH");

  const approveBy = approvalDeadline(await bookingPolicy(tx), now);
  try {
    // A savepoint: if the nights were given to someone else after this hold ran out,
    // the occupancy constraint refuses and only this step is undone.
    await tx.transaction(async (sp) => {
      await sp
        .update(bookings)
        .set({
          status: "AWAITING_APPROVAL",
          statusReason: null,
          stripePaymentIntentId: pi.id,
          holdExpiresAt: null,
          approveBy,
        })
        .where(eq(bookings.id, booking.id));
    });
  } catch (e) {
    if (pgCode(e) === EXCLUSION_VIOLATION) return release("DATES_TAKEN");
    throw e;
  }
  return "awaiting_approval";
}

/** Money captured (the host approved, step 6). */
async function captured(tx: Tx, pi: Stripe.PaymentIntent): Promise<WebhookOutcome> {
  const booking = await bookingForIntent(tx, pi);
  if (!booking || booking.status !== "AWAITING_APPROVAL") return "ignored";
  if (pi.amount_received !== booking.totalCents) {
    // Never mark as paid for a different amount; the owner sees it in the dashboard.
    console.error(`Booking ${booking.id}: captured ${pi.amount_received}, expected ${booking.totalCents}`);
    return "ignored";
  }
  await tx
    .update(bookings)
    .set({ status: "CONFIRMED", decidedAt: sql`coalesce(${bookings.decidedAt}, now())` })
    .where(eq(bookings.id, booking.id));
  return "confirmed";
}

/** The authorisation was released outside a host decision (e.g. it ran out after 7 days). */
async function canceled(tx: Tx, pi: Stripe.PaymentIntent): Promise<WebhookOutcome> {
  const booking = await bookingForIntent(tx, pi);
  if (!booking) return "ignored";
  const rows = await tx
    .update(bookings)
    .set({ status: "EXPIRED", statusReason: "PAYMENT_CANCELED" })
    .where(and(eq(bookings.id, booking.id), inArray(bookings.status, ["HOLD", "AWAITING_APPROVAL"])))
    .returning({ id: bookings.id });
  return rows.length ? "expired" : "ignored";
}

/**
 * A refund, made from the dashboard or straight in Stripe: keep the refunded total in
 * step with Stripe's, and mark a fully refunded booking.
 */
async function refunded(tx: Tx, charge: Stripe.Charge): Promise<WebhookOutcome> {
  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!piId) return "ignored";
  const [booking] = await tx
    .select({ id: bookings.id, status: bookings.status, totalCents: bookings.totalCents })
    .from(bookings)
    .where(eq(bookings.stripePaymentIntentId, piId))
    .for("update");
  if (!booking) return "ignored";
  const full = booking.totalCents !== null && charge.amount_refunded >= booking.totalCents;
  await tx
    .update(bookings)
    .set({
      refundedCents: charge.amount_refunded,
      ...(full && (booking.status === "CONFIRMED" || booking.status === "CANCELLED") ? { status: "REFUNDED" } : {}),
    })
    .where(eq(bookings.id, booking.id));
  return "refund_recorded";
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function pgCode(error: unknown): string | undefined {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}
