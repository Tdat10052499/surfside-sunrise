// The host's decisions against a real Postgres, with a fake Stripe.
import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { bookings, properties, rateRules, siteSettings } from "@/db/schema";
import { startCheckout, type CheckoutInput } from "@/lib/payments/checkout";
import type { CheckoutRequest, StripeGateway } from "@/lib/payments/gateway";
import { handleStripeEvent } from "@/lib/payments/webhook";
import { resetDatabase, testDatabaseUrl } from "@/test/database";
import {
  approveBooking,
  bookingDetail,
  cancelBooking,
  changeDates,
  declineBooking,
  expireOverdueApprovals,
  listBookings,
  overview,
} from "./host";

const url = testDatabaseUrl();
let db: Db;
let close: () => Promise<void>;

class FakeStripe implements StripeGateway {
  readonly livemode = false;
  calls: [string, ...unknown[]][] = [];
  fail = false;
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
  private call(name: string, ...args: unknown[]) {
    if (this.fail) throw new Error(`Stripe is down (sk_test_${"x".repeat(12)})`);
    this.calls.push([name, ...args]);
  }
  async cancelPaymentIntent(id: string) {
    this.call("cancel", id);
  }
  async capturePaymentIntent(id: string) {
    this.call("capture", id);
  }
  async refund(pi: string, amount: number, key: string) {
    this.call("refund", pi, amount, key);
  }
}
let stripe: FakeStripe;

const TOTAL = 57_500;
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
const NOW = new Date("2026-11-23T16:00:00Z");

beforeAll(async () => {
  await resetDatabase(url);
  ({ db, close } = createDb(url));
});
afterAll(() => close());

beforeEach(async () => {
  stripe = new FakeStripe();
  await db.execute(sql`truncate properties, bookings, occupancy, rate_rules, stripe_events, site_settings cascade`);
  const [home] = await db
    .insert(properties)
    .values({ slug: "test-home", name: "Test Home", status: "PUBLISHED", maxGuests: 8, cleaningFeeCents: 17_500 })
    .returning({ id: properties.id });
  // Sample rate for tests only.
  await db.insert(rateRules).values({ propertyId: home.id, kind: "BASE", nightlyCents: 20_000 });
});

let n = 0;
/** A web booking whose card Stripe has authorised: AWAITING_APPROVAL. */
async function awaiting(over: Partial<CheckoutInput> = {}) {
  const r = await startCheckout(db, { ...input, ...over }, { gateway: stripe, origin: "https://x.example" });
  if (!r.ok) throw new Error("setup");
  const [b] = await db.select().from(bookings).where(eq(bookings.code, r.code));
  const pi = `pi_${++n}`;
  const event = {
    id: `evt_${n}`,
    type: "payment_intent.amount_capturable_updated",
    data: {
      object: {
        id: pi,
        status: "requires_capture",
        amount_capturable: TOTAL,
        currency: "usd",
        metadata: { booking_id: b.id },
      },
    },
  } as unknown as Stripe.Event;
  expect(await handleStripeEvent(db, event, stripe, NOW)).toBe("awaiting_approval");
  return { id: b.id, code: b.code, pi };
}
const get = async (id: string) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0];

describe("approval deadline", () => {
  it("defaults to 48 hours after authorisation", async () => {
    const { id } = await awaiting();
    expect((await get(id)).approveBy).toEqual(new Date(NOW.getTime() + 48 * 3_600_000));
  });

  it("follows the owner's setting, capped at 6 days", async () => {
    await db.insert(siteSettings).values({ key: "booking_policy", value: { approvalHours: 500 } });
    const { id } = await awaiting();
    expect((await get(id)).approveBy).toEqual(new Date(NOW.getTime() + 144 * 3_600_000));
  });
});

describe("approve and decline", () => {
  it("approve captures the card and confirms", async () => {
    const { id, pi } = await awaiting();
    expect(await approveBooking(db, id, stripe)).toEqual({ ok: true, status: "CONFIRMED" });
    expect(stripe.calls).toContainEqual(["capture", pi]);
    expect((await get(id)).decidedAt).not.toBeNull();
    expect(await approveBooking(db, id, stripe)).toMatchObject({ ok: false, error: "WRONG_STATUS" });
  });

  it("leaves the booking waiting when Stripe fails, without leaking the key", async () => {
    const { id } = await awaiting();
    stripe.fail = true;
    const r = await approveBooking(db, id, stripe);
    expect(r).toMatchObject({ ok: false, error: "STRIPE_ERROR" });
    expect(JSON.stringify(r)).not.toMatch(/sk_test_/);
    expect((await get(id)).status).toBe("AWAITING_APPROVAL");
  });

  it("needs Stripe connected", async () => {
    const { id } = await awaiting();
    expect(await approveBooking(db, id, null)).toMatchObject({ ok: false, error: "PAYMENTS_OFF" });
  });

  it("decline releases the card and frees the nights", async () => {
    const { id, pi } = await awaiting();
    expect(await declineBooking(db, id, stripe, "Dates blocked for repairs")).toEqual({
      ok: true,
      status: "REJECTED",
    });
    expect(stripe.calls).toContainEqual(["cancel", pi]);
    expect(await get(id)).toMatchObject({ statusReason: "HOST_DECLINED", hostNote: "Dates blocked for repairs" });
    await awaiting({ guestEmail: "next@example.com" }); // the same nights can be booked again
  });

  it("a Stripe cancel event after a decline doesn't change it", async () => {
    const { id, pi } = await awaiting();
    await declineBooking(db, id, stripe);
    const e = {
      id: "evt_after_decline",
      type: "payment_intent.canceled",
      data: { object: { id: pi, status: "canceled", metadata: { booking_id: id } } },
    } as unknown as Stripe.Event;
    expect(await handleStripeEvent(db, e, stripe)).toBe("ignored");
    expect((await get(id)).status).toBe("REJECTED");
  });
});

describe("cancel and refund", () => {
  async function confirmed() {
    const b = await awaiting();
    await approveBooking(db, b.id, stripe);
    return b;
  }

  it("refunds part and keeps the booking cancelled", async () => {
    const { id, pi } = await confirmed();
    expect(await cancelBooking(db, id, 20_000, stripe)).toEqual({ ok: true, status: "CANCELLED" });
    expect(stripe.calls.at(-1)).toEqual(["refund", pi, 20_000, `cancel-${id}-0-20000`]);
    expect(await get(id)).toMatchObject({ refundedCents: 20_000, statusReason: "HOST_CANCELLED" });
  });

  it("a full refund marks the booking refunded", async () => {
    const { id } = await confirmed();
    expect(await cancelBooking(db, id, TOTAL, stripe)).toEqual({ ok: true, status: "REFUNDED" });
  });

  it("cancelling without a refund calls no Stripe refund", async () => {
    const { id } = await confirmed();
    const before = stripe.calls.length;
    expect(await cancelBooking(db, id, 0, null)).toEqual({ ok: true, status: "CANCELLED" });
    expect(stripe.calls).toHaveLength(before);
  });

  it("refuses amounts outside 0 to the paid total", async () => {
    const { id } = await confirmed();
    expect(await cancelBooking(db, id, TOTAL + 1, stripe)).toMatchObject({ ok: false, error: "BAD_AMOUNT" });
    expect(await cancelBooking(db, id, -1, stripe)).toMatchObject({ ok: false, error: "BAD_AMOUNT" });
    expect(await cancelBooking(db, id, 10.5, stripe)).toMatchObject({ ok: false, error: "BAD_AMOUNT" });
    expect((await get(id)).status).toBe("CONFIRMED");
  });

  it("records a refund made straight in Stripe", async () => {
    const { id, pi } = await confirmed();
    const e = {
      id: "evt_refund",
      type: "charge.refunded",
      data: { object: { payment_intent: pi, amount_refunded: TOTAL } },
    } as unknown as Stripe.Event;
    expect(await handleStripeEvent(db, e, stripe)).toBe("refund_recorded");
    expect(await get(id)).toMatchObject({ status: "REFUNDED", refundedCents: TOTAL });
  });
});

describe("change dates", () => {
  it("moves to free nights and refuses taken ones", async () => {
    const a = await awaiting();
    await awaiting({ checkIn: "2026-12-20", checkOut: "2026-12-22", guestEmail: "b@example.com" });
    expect(await changeDates(db, a.id, { checkIn: "2026-12-10", checkOut: "2026-12-12" })).toEqual({
      ok: true,
      status: "AWAITING_APPROVAL",
    });
    expect(await get(a.id)).toMatchObject({ checkIn: "2026-12-10", checkOut: "2026-12-12" });
    expect(await changeDates(db, a.id, { checkIn: "2026-12-21", checkOut: "2026-12-23" })).toMatchObject({
      ok: false,
      error: "DATES_TAKEN",
    });
    expect(await changeDates(db, a.id, { checkIn: "2026-12-12", checkOut: "2026-12-12" })).toMatchObject({
      ok: false,
      error: "BAD_DATES",
    });
  });
});

describe("overdue requests", () => {
  it("expire after the deadline, releasing the card", async () => {
    const { id, pi } = await awaiting();
    const early = await expireOverdueApprovals(db, stripe, new Date(NOW.getTime() + 47 * 3_600_000));
    expect(early).toEqual({ expired: 0, failed: 0 });
    const late = await expireOverdueApprovals(db, stripe, new Date(NOW.getTime() + 49 * 3_600_000));
    expect(late).toEqual({ expired: 1, failed: 0 });
    expect(await get(id)).toMatchObject({ status: "EXPIRED", statusReason: "APPROVAL_TIMEOUT" });
    expect(stripe.calls).toContainEqual(["cancel", pi]);
  });

  it("count a Stripe failure and keep the booking for the next run", async () => {
    const { id } = await awaiting();
    stripe.fail = true;
    expect(await expireOverdueApprovals(db, stripe, new Date(NOW.getTime() + 49 * 3_600_000))).toEqual({
      expired: 0,
      failed: 1,
    });
    expect((await get(id)).status).toBe("AWAITING_APPROVAL");
  });
});

describe("reading", () => {
  it("lists by filter, shows detail by code, and counts the overview", async () => {
    const a = await awaiting();
    const c = await awaiting({ checkIn: "2026-11-30", checkOut: "2026-12-02", guestEmail: "c@example.com" });
    await approveBooking(db, c.id, stripe);
    expect((await listBookings(db, "awaiting", "2026-11-23")).map((r) => r.code)).toEqual([a.code]);
    expect((await listBookings(db, "upcoming", "2026-11-23")).map((r) => r.code)).toEqual([c.code, a.code]);
    expect(await bookingDetail(db, c.code.toLowerCase())).toMatchObject({ homeName: "Test Home" });
    expect(await overview(db, "2026-11-23")).toEqual({ awaiting: 1, upcoming: 1, homes: 1, published: 1 });
  });
});
