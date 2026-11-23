// Checkout and the Stripe connection against a real Postgres, with a fake Stripe.
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { adminUsers, bookings, properties, rateRules, serviceCredentials } from "@/db/schema";
import { CHECKOUT_MINUTES } from "@/lib/booking/hold";
import { resetDatabase, testDatabaseUrl } from "@/test/database";
import { bookingBySession, cancelCheckout, lookupBooking, startCheckout, type CheckoutInput } from "./checkout";
import { connectStripe, disconnectStripe, stripeCredentials, stripeStatus, WEBHOOK_PATH } from "./connection";
import { WEBHOOK_EVENTS, type CheckoutRequest, type StripeGateway } from "./gateway";

const url = testDatabaseUrl();
let db: Db;
let close: () => Promise<void>;
let adminId: string;

const now = new Date("2026-11-23T16:00:00Z");
const env = { SECRETS_KEY: randomBytes(32).toString("base64") };
const TEST_KEY = "rk_test_" + "a".repeat(24); // fake key for tests only
const LIVE_KEY = "rk_live_" + "b".repeat(24);

/** Records every call; behaves like Stripe for the parts the site uses. */
class FakeStripe implements StripeGateway {
  static calls: { key: string; op: string; arg?: unknown }[] = [];
  static failCheckout = false;
  static rejectKeys = new Set<string>();
  static seq = 0;
  constructor(readonly key: string) {}
  get livemode() {
    return this.key.includes("_live_");
  }
  private log(op: string, arg?: unknown) {
    FakeStripe.calls.push({ key: this.key, op, arg });
  }
  async accountName() {
    return "Test Host LLC";
  }
  async createWebhook(url: string, events: readonly string[]) {
    if (FakeStripe.rejectKeys.has(this.key)) throw new Error(`Invalid API Key provided: ${this.key}`);
    this.log("createWebhook", { url, events });
    return { id: `we_${++FakeStripe.seq}`, secret: `whsec_${FakeStripe.seq}` };
  }
  async deleteWebhook(id: string) {
    this.log("deleteWebhook", id);
  }
  async createCheckout(req: CheckoutRequest) {
    this.log("createCheckout", req);
    if (FakeStripe.failCheckout) throw new Error("Stripe is down");
    const id = `cs_test_${++FakeStripe.seq}`;
    return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
  }
  async expireCheckout(id: string) {
    this.log("expireCheckout", id);
  }
  async cancelPaymentIntent(id: string) {
    this.log("cancelPaymentIntent", id);
  }
}
const gatewayFor = (key: string) => new FakeStripe(key);

beforeAll(async () => {
  await resetDatabase(url);
  ({ db, close } = createDb(url));
  const [a] = await db
    .insert(adminUsers)
    .values({ email: "host@example.com", passwordHash: "x" })
    .returning({ id: adminUsers.id });
  adminId = a.id;
});
afterAll(() => close());

beforeEach(async () => {
  FakeStripe.calls = [];
  FakeStripe.failCheckout = false;
  FakeStripe.rejectKeys = new Set();
  FakeStripe.seq = 0;
  await db.execute(sql`truncate properties, bookings, occupancy, rate_rules, service_credentials cascade`);
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
const deps = (gateway: StripeGateway | null = new FakeStripe(TEST_KEY)) => ({
  gateway,
  origin: "https://preview.example.com",
  now,
});

describe("startCheckout", () => {
  it("holds the nights and opens an authorise-only Checkout for the server's price", async () => {
    const r = await startCheckout(db, input, deps());
    expect(r).toMatchObject({ ok: true, checkoutUrl: expect.stringContaining("checkout.stripe.com") });

    const [call] = FakeStripe.calls;
    const req = call.arg as CheckoutRequest;
    expect(req.lines).toEqual([
      { name: "Test Home: 2 nights", amountCents: 40_000 },
      { name: "Cleaning fee", amountCents: 17_500 },
    ]);
    expect(req.customerEmail).toBe("jordan@example.com");
    expect(req.expiresAt).toEqual(new Date(now.getTime() + CHECKOUT_MINUTES * 60_000));
    expect(req.successUrl).toBe("https://preview.example.com/book/done?session_id={CHECKOUT_SESSION_ID}");

    const [b] = await db.select().from(bookings);
    expect(b).toMatchObject({
      status: "HOLD",
      totalCents: 57_500,
      stripeCheckoutSessionId: expect.stringMatching(/^cs_test_/),
    });
    expect(b.holdExpiresAt!.getTime()).toBeGreaterThan(req.expiresAt.getTime());
  });

  it("refuses when the nights are taken, without calling Stripe", async () => {
    expect((await startCheckout(db, input, deps())).ok).toBe(true);
    const second = await startCheckout(db, { ...input, guestEmail: "other@example.com" }, deps());
    expect(second).toMatchObject({ ok: false, error: { code: "DATES_TAKEN" } });
    expect(FakeStripe.calls.filter((c) => c.op === "createCheckout")).toHaveLength(1);
  });

  it("says payments are off when Stripe isn't connected, and holds nothing", async () => {
    expect(await startCheckout(db, input, deps(null))).toEqual({ ok: false, error: { code: "PAYMENTS_OFF" } });
    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it("frees the nights when Stripe fails", async () => {
    FakeStripe.failCheckout = true;
    expect(await startCheckout(db, input, deps())).toEqual({ ok: false, error: { code: "PAYMENT_ERROR" } });
    const [b] = await db.select().from(bookings);
    expect(b.status).toBe("EXPIRED");
    FakeStripe.failCheckout = false;
    expect((await startCheckout(db, input, deps())).ok).toBe(true);
  });

  it("passes quote errors through", async () => {
    expect(await startCheckout(db, { ...input, guests: 9 }, deps())).toMatchObject({
      ok: false,
      error: { code: "TOO_MANY_GUESTS" },
    });
  });
});

describe("after Checkout", () => {
  async function started() {
    const r = await startCheckout(db, input, deps());
    if (!r.ok) throw new Error("setup");
    const [b] = await db.select().from(bookings).where(eq(bookings.code, r.code));
    return { code: r.code, sessionId: b.stripeCheckoutSessionId! };
  }

  it("cancel frees the nights and closes the Checkout Session", async () => {
    const { sessionId } = await started();
    const gateway = new FakeStripe(TEST_KEY);
    expect(await cancelCheckout(db, sessionId, gateway)).toMatchObject({ status: "EXPIRED" });
    expect(FakeStripe.calls.at(-1)).toMatchObject({ op: "expireCheckout", arg: sessionId });
    expect((await startCheckout(db, input, deps())).ok).toBe(true);
  });

  it("cancel leaves a booking that is past HOLD alone", async () => {
    const { sessionId } = await started();
    await db
      .update(bookings)
      .set({ status: "AWAITING_APPROVAL" })
      .where(eq(bookings.stripeCheckoutSessionId, sessionId));
    expect(await cancelCheckout(db, sessionId, new FakeStripe(TEST_KEY))).toMatchObject({
      status: "AWAITING_APPROVAL",
    });
  });

  it("finds a booking by session, and by code with the right email only", async () => {
    const { code, sessionId } = await started();
    expect(await bookingBySession(db, sessionId)).toMatchObject({ code, homeName: "Test Home", totalCents: 57_500 });
    const found = await lookupBooking(db, ` ${code.toLowerCase()} `, "JORDAN@example.com");
    expect(found).toMatchObject({ code, checkIn: "2026-12-07", lines: expect.any(Array) });
    expect(found).not.toHaveProperty("id");
    expect(JSON.stringify(found)).not.toMatch(/Jordan Lee|555 0100/);
    expect(await lookupBooking(db, code, "someone@example.com")).toBeNull();
    expect(await lookupBooking(db, "SSR-XXXXXX", "jordan@example.com")).toBeNull();
  });
});

describe("Stripe connection", () => {
  const connect = (key: string, siteUrl: string | null = "https://www.example.com") =>
    connectStripe(db, { key, adminId, siteUrl, env }, gatewayFor);

  it("checks the key, creates the webhook and stores both secrets encrypted", async () => {
    const r = await connect(TEST_KEY);
    expect(r).toMatchObject({
      ok: true,
      status: {
        livemode: false,
        masked: "rk_test_…aaaa",
        accountName: "Test Host LLC",
        webhookUrl: `https://www.example.com${WEBHOOK_PATH}`,
      },
    });
    expect(FakeStripe.calls[0]).toMatchObject({ op: "createWebhook", arg: { events: WEBHOOK_EVENTS } });

    const [row] = await db.select().from(serviceCredentials);
    expect(JSON.stringify(row)).not.toContain(TEST_KEY);
    expect(JSON.stringify(row)).not.toMatch(/whsec_/);
    expect(await stripeCredentials(db, env)).toEqual({
      secretKey: TEST_KEY,
      webhookSecret: "whsec_1",
      livemode: false,
    });
  });

  it("replaces a previous key and removes its webhook", async () => {
    await connect(TEST_KEY);
    const r = await connect(LIVE_KEY);
    expect(r).toMatchObject({ ok: true, status: { livemode: true } });
    expect(FakeStripe.calls.find((c) => c.op === "deleteWebhook")).toMatchObject({ key: TEST_KEY });
    expect(await db.select().from(serviceCredentials)).toHaveLength(1);
    expect((await stripeCredentials(db, env))?.secretKey).toBe(LIVE_KEY);
  });

  it("explains keys it can't use, without echoing them", async () => {
    expect(await connect("pk_live_abcdefghijklmnop")).toMatchObject({ ok: false, reason: "publishable_key" });
    expect(await connect("hello")).toMatchObject({ ok: false, reason: "bad_format" });
    expect(await connect(TEST_KEY, null)).toMatchObject({ ok: false, reason: "no_site_url" });
    FakeStripe.rejectKeys.add(TEST_KEY);
    const r = await connect(TEST_KEY);
    expect(r).toMatchObject({ ok: false, reason: "rejected" });
    expect(JSON.stringify(r)).not.toContain(TEST_KEY);
    expect(
      await connectStripe(db, { key: TEST_KEY, adminId, siteUrl: "https://x.example", env: {} }, gatewayFor),
    ).toMatchObject({ ok: false, reason: "no_secrets_key" });
    expect(await db.select().from(serviceCredentials)).toHaveLength(0);
  });

  it("falls back to the development key in the environment, and disconnects", async () => {
    const devEnv = { ...env, STRIPE_SECRET_KEY: "sk_test_" + "c".repeat(24) };
    expect(await stripeStatus(db, devEnv)).toMatchObject({ connected: true, source: "env", livemode: false });
    await connect(LIVE_KEY);
    expect(await stripeStatus(db, devEnv)).toMatchObject({ source: "dashboard", livemode: true });
    await disconnectStripe(db, env, gatewayFor);
    expect(FakeStripe.calls.at(-1)).toMatchObject({ op: "deleteWebhook", key: LIVE_KEY });
    expect(await stripeStatus(db, env)).toEqual({ connected: false });
  });
});
