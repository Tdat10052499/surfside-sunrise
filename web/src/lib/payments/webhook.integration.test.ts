// The Stripe webhook against a real Postgres: signed events move bookings, each event
// counts once, and a wrong amount or lost nights never become a paid booking.
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { bookings, properties, rateRules, stripeEvents } from "@/db/schema";
import { resetDatabase, testDatabaseUrl } from "@/test/database";
import { bookingBySession, startCheckout, type CheckoutInput } from "./checkout";
import { verifyStripeEvent, type CheckoutRequest, type StripeGateway } from "./gateway";
import { handleStripeEvent } from "./webhook";

const url = testDatabaseUrl();
let db: Db;
let close: () => Promise<void>;

class FakeStripe implements StripeGateway {
  readonly livemode = false;
  canceled: string[] = [];
  failCancel = false;
  private seq = 0;
  async accountName() {
    return null;
  }
  async createWebhook() {
    return { id: "we_1", secret: "whsec_1" };
  }
  async deleteWebhook() {}
  async createCheckout(req: CheckoutRequest) {
    void req;
    const id = `cs_test_${++this.seq}`;
    return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
  }
  async expireCheckout() {}
  async cancelPaymentIntent(id: string) {
    if (this.failCancel) throw new Error("Stripe is down");
    this.canceled.push(id);
  }
  async capturePaymentIntent() {}
  async refund() {}
}
let stripe: FakeStripe;

beforeAll(async () => {
  await resetDatabase(url);
  ({ db, close } = createDb(url));
});
afterAll(() => close());

beforeEach(async () => {
  stripe = new FakeStripe();
  await db.execute(sql`truncate properties, bookings, occupancy, rate_rules, stripe_events cascade`);
  const [home] = await db
    .insert(properties)
    .values({ slug: "test-home", name: "Test Home", status: "PUBLISHED", maxGuests: 8, cleaningFeeCents: 17_500 })
    .returning({ id: properties.id });
  // Sample rate for tests only.
  await db.insert(rateRules).values({ propertyId: home.id, kind: "BASE", nightlyCents: 20_000 });
});

const input: CheckoutInput = {
  slug: "test-home",
  checkIn: "2026-12-07",
  checkOut: "2026-12-09",
  guests: 2,
  pets: 0,
  guestName: "Jordan Lee",
  guestEmail: "jordan@example.com",
  guestPhone: "+1 555 0100",
};
const TOTAL = 57_500;

async function held(checkInput = input) {
  const r = await startCheckout(db, checkInput, { gateway: stripe, origin: "https://preview.example.com" });
  if (!r.ok) throw new Error(`setup: ${JSON.stringify(r.error)}`);
  const [b] = await db.select().from(bookings).where(eq(bookings.code, r.code));
  return b;
}

let n = 0;
function ev<T>(type: string, object: T): Stripe.Event {
  return { id: `evt_${++n}`, object: "event", type, data: { object } } as unknown as Stripe.Event;
}
const session = (id: string, pi = "pi_1") => ({ id, object: "checkout.session", payment_intent: pi });
const intent = (bookingId: string, over: Partial<Stripe.PaymentIntent> = {}) => ({
  id: "pi_1",
  object: "payment_intent",
  status: "requires_capture",
  amount: TOTAL,
  amount_capturable: TOTAL,
  amount_received: 0,
  currency: "usd",
  metadata: { booking_id: bookingId },
  ...over,
});
const statusOf = async (id: string) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0];

describe("authorisation", () => {
  it("moves the hold to awaiting approval when the full amount is authorised", async () => {
    const b = await held();
    await handleStripeEvent(db, ev("checkout.session.completed", session(b.stripeCheckoutSessionId!)), stripe);
    expect((await statusOf(b.id)).stripePaymentIntentId).toBe("pi_1");

    expect(await handleStripeEvent(db, ev("payment_intent.amount_capturable_updated", intent(b.id)), stripe)).toBe(
      "awaiting_approval",
    );
    expect(await statusOf(b.id)).toMatchObject({
      status: "AWAITING_APPROVAL",
      holdExpiresAt: null,
      statusReason: null,
    });
    expect(await bookingBySession(db, b.stripeCheckoutSessionId!)).toMatchObject({ status: "AWAITING_APPROVAL" });
  });

  it("applies an event only once", async () => {
    const b = await held();
    const e = ev("payment_intent.amount_capturable_updated", intent(b.id));
    expect(await handleStripeEvent(db, e, stripe)).toBe("awaiting_approval");
    expect(await handleStripeEvent(db, e, stripe)).toBe("duplicate");
    expect(await db.select().from(stripeEvents)).toHaveLength(1);
  });

  it("refuses an amount that differs from the quote and releases the card", async () => {
    const b = await held();
    const e = ev("payment_intent.amount_capturable_updated", intent(b.id, { amount_capturable: 100 }));
    expect(await handleStripeEvent(db, e, stripe)).toBe("released");
    expect(await statusOf(b.id)).toMatchObject({ status: "EXPIRED", statusReason: "AMOUNT_MISMATCH" });
    expect(stripe.canceled).toEqual(["pi_1"]);
  });

  it("refuses another currency", async () => {
    const b = await held();
    const e = ev("payment_intent.amount_capturable_updated", intent(b.id, { currency: "eur" }));
    expect(await handleStripeEvent(db, e, stripe)).toBe("released");
  });

  it("still accepts a payment that lands just after the hold ran out, if the nights are free", async () => {
    const b = await held();
    await db.update(bookings).set({ status: "EXPIRED" }).where(eq(bookings.id, b.id));
    expect(await handleStripeEvent(db, ev("payment_intent.amount_capturable_updated", intent(b.id)), stripe)).toBe(
      "awaiting_approval",
    );
  });

  it("releases the card when the nights went to someone else meanwhile", async () => {
    const late = await held();
    await db.update(bookings).set({ status: "EXPIRED" }).where(eq(bookings.id, late.id));
    await held({ ...input, guestEmail: "other@example.com" });
    const e = ev("payment_intent.amount_capturable_updated", intent(late.id));
    expect(await handleStripeEvent(db, e, stripe)).toBe("released");
    expect(await statusOf(late.id)).toMatchObject({ status: "EXPIRED", statusReason: "DATES_TAKEN" });
    expect(stripe.canceled).toEqual(["pi_1"]);
  });

  it("rolls back when Stripe can't release the card, so Stripe retries the event", async () => {
    const b = await held();
    stripe.failCancel = true;
    const e = ev("payment_intent.amount_capturable_updated", intent(b.id, { amount_capturable: 1 }));
    await expect(handleStripeEvent(db, e, stripe)).rejects.toThrow("Stripe is down");
    expect((await statusOf(b.id)).status).toBe("HOLD");
    expect(await db.select().from(stripeEvents)).toHaveLength(0);
    stripe.failCancel = false;
    expect(await handleStripeEvent(db, e, stripe)).toBe("released");
  });

  it("ignores an intent that is not authorised yet, or not ours", async () => {
    const b = await held();
    const notYet = ev("payment_intent.amount_capturable_updated", intent(b.id, { status: "processing" }));
    expect(await handleStripeEvent(db, notYet, stripe)).toBe("ignored");
    const other = ev("payment_intent.amount_capturable_updated", intent("not-a-uuid", { id: "pi_other" }));
    expect(await handleStripeEvent(db, other, stripe)).toBe("ignored");
    expect((await statusOf(b.id)).status).toBe("HOLD");
  });
});

describe("other outcomes", () => {
  it("frees the nights when the Checkout page expires unpaid", async () => {
    const b = await held();
    expect(
      await handleStripeEvent(db, ev("checkout.session.expired", session(b.stripeCheckoutSessionId!)), stripe),
    ).toBe("expired");
    expect(await statusOf(b.id)).toMatchObject({ status: "EXPIRED", statusReason: "CHECKOUT_EXPIRED" });
    expect((await startCheckout(db, input, { gateway: stripe, origin: "https://x.example" })).ok).toBe(true);
  });

  it("does not expire a booking that was already authorised", async () => {
    const b = await held();
    await handleStripeEvent(db, ev("payment_intent.amount_capturable_updated", intent(b.id)), stripe);
    expect(
      await handleStripeEvent(db, ev("checkout.session.expired", session(b.stripeCheckoutSessionId!)), stripe),
    ).toBe("ignored");
    expect((await statusOf(b.id)).status).toBe("AWAITING_APPROVAL");
  });

  it("confirms on capture of the exact amount only", async () => {
    const b = await held();
    await handleStripeEvent(db, ev("payment_intent.amount_capturable_updated", intent(b.id)), stripe);
    const wrong = ev("payment_intent.succeeded", intent(b.id, { status: "succeeded", amount_received: 1 }));
    expect(await handleStripeEvent(db, wrong, stripe)).toBe("ignored");
    const right = ev("payment_intent.succeeded", intent(b.id, { status: "succeeded", amount_received: TOTAL }));
    expect(await handleStripeEvent(db, right, stripe)).toBe("confirmed");
    expect((await statusOf(b.id)).status).toBe("CONFIRMED");
  });

  it("expires an authorisation released outside a host decision", async () => {
    const b = await held();
    await handleStripeEvent(db, ev("payment_intent.amount_capturable_updated", intent(b.id)), stripe);
    const e = ev("payment_intent.canceled", intent(b.id, { status: "canceled" }));
    expect(await handleStripeEvent(db, e, stripe)).toBe("expired");
    expect(await statusOf(b.id)).toMatchObject({ status: "EXPIRED", statusReason: "PAYMENT_CANCELED" });
  });

  it("records but ignores a failed card attempt (the guest can retry on the same page)", async () => {
    const b = await held();
    const e = ev("payment_intent.payment_failed", intent(b.id, { status: "requires_payment_method" }));
    expect(await handleStripeEvent(db, e, stripe)).toBe("ignored");
    expect((await statusOf(b.id)).status).toBe("HOLD");
  });
});

describe("signature", () => {
  const secret = "whsec_" + randomBytes(16).toString("hex");
  const payload = JSON.stringify({ id: "evt_sig", object: "event", type: "checkout.session.expired", data: {} });

  it("accepts a body signed with the endpoint's secret", () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(verifyStripeEvent(payload, header, secret).id).toBe("evt_sig");
  });

  it("rejects a tampered body, another secret and an old signature", () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(() => verifyStripeEvent(payload.replace("expired", "completed"), header, secret)).toThrow();
    expect(() => verifyStripeEvent(payload, header, "whsec_other")).toThrow();
    const old = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });
    expect(() => verifyStripeEvent(payload, old, secret)).toThrow();
  });
});
