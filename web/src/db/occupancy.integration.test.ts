// Proves the double-booking guarantee (§4) against a real Postgres.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { bookings, calendarBlocks, properties, rateRules } from "@/db/schema";
import { createHold, HOLD_MINUTES, type HoldInput } from "@/lib/booking/hold";
import { DEFAULT_WEEKEND_NIGHTS, quoteStay } from "@/lib/pricing/quote";
import { resetDatabase, testDatabaseUrl } from "@/test/database";

const url = testDatabaseUrl();
let db: Db;
let close: () => Promise<void>;
let homeId: string;

function hold(checkIn: string, checkOut: string, propertyId = homeId): HoldInput {
  const r = quoteStay(
    { checkIn, checkOut, guests: 2, pets: 0 },
    {
      maxGuests: 8,
      maxPets: null,
      minNights: 1,
      cleaningFeeCents: 17_500,
      petFeeCents: 5_000,
      weekendNights: DEFAULT_WEEKEND_NIGHTS,
    },
    [{ kind: "BASE", nightlyCents: 20_000 }], // sample rate for tests only
  );
  if (!r.ok) throw new Error(r.error.code);
  return {
    propertyId,
    checkIn,
    checkOut,
    guests: 2,
    pets: 0,
    guestName: "Test Guest",
    guestEmail: "guest@example.com",
    guestPhone: "+1 555 0100",
    policyVersion: "test",
    quote: r.quote,
  };
}

async function addHome(slug: string): Promise<string> {
  const [row] = await db.insert(properties).values({ slug, name: slug, maxGuests: 8 }).returning({ id: properties.id });
  return row.id;
}

function pgCodeOf(error: unknown): string | undefined {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
}

beforeAll(async () => {
  await resetDatabase(url);
  ({ db, close } = createDb(url));
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.execute(sql`truncate properties, bookings, calendar_blocks, occupancy, rate_rules restart identity cascade`);
  homeId = await addHome("test-home");
});

describe("occupancy exclusion constraint", () => {
  it("lets exactly one of many simultaneous guests hold the same nights", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => createHold(db, hold("2026-11-06", "2026-11-09"))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "DATES_TAKEN")).toHaveLength(9);
  });

  it("rejects a partial overlap but allows back-to-back stays", async () => {
    expect((await createHold(db, hold("2026-11-06", "2026-11-09"))).ok).toBe(true);
    expect(await createHold(db, hold("2026-11-08", "2026-11-10"))).toEqual({ ok: false, reason: "DATES_TAKEN" });
    expect((await createHold(db, hold("2026-11-09", "2026-11-11"))).ok).toBe(true); // check-in on the previous check-out day
    expect((await createHold(db, hold("2026-11-04", "2026-11-06"))).ok).toBe(true); // check-out on the next check-in day
  });

  it("keeps different homes independent", async () => {
    const other = await addHome("other-home");
    expect((await createHold(db, hold("2026-11-06", "2026-11-09"))).ok).toBe(true);
    expect((await createHold(db, hold("2026-11-06", "2026-11-09", other))).ok).toBe(true);
  });

  it("blocks guests from nights the owner closed, and the owner from closing booked nights", async () => {
    await db.insert(calendarBlocks).values({ propertyId: homeId, during: "[2026-12-24,2026-12-27)" });
    expect(await createHold(db, hold("2026-12-26", "2026-12-28"))).toEqual({ ok: false, reason: "DATES_TAKEN" });

    expect((await createHold(db, hold("2027-01-02", "2027-01-05"))).ok).toBe(true);
    const err = await db
      .insert(calendarBlocks)
      .values({ propertyId: homeId, during: "[2027-01-04,2027-01-06)" })
      .catch((e: unknown) => e);
    expect(pgCodeOf(err)).toBe("23P01");
  });

  it("releases an expired hold when the next guest asks for the same nights", async () => {
    const past = new Date(Date.now() - (HOLD_MINUTES + 1) * 60_000);
    const stale = await createHold(db, hold("2026-11-06", "2026-11-09"), past);
    if (!stale.ok) throw new Error("setup failed");

    expect((await createHold(db, hold("2026-11-06", "2026-11-09"))).ok).toBe(true);
    const [row] = await db.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, stale.bookingId));
    expect(row.status).toBe("EXPIRED");
  });

  it("does not release a hold that is still running", async () => {
    expect((await createHold(db, hold("2026-11-06", "2026-11-09"))).ok).toBe(true);
    expect(await createHold(db, hold("2026-11-06", "2026-11-09"))).toEqual({ ok: false, reason: "DATES_TAKEN" });
  });

  it("frees the nights when the owner rejects a booking, and refuses to revive it over a newer one", async () => {
    const first = await createHold(db, hold("2026-11-06", "2026-11-09"));
    if (!first.ok) throw new Error("setup failed");
    await db.update(bookings).set({ status: "REJECTED" }).where(eq(bookings.id, first.bookingId));

    expect((await createHold(db, hold("2026-11-06", "2026-11-09"))).ok).toBe(true);
    const err = await db
      .update(bookings)
      .set({ status: "CONFIRMED" })
      .where(eq(bookings.id, first.bookingId))
      .catch((e: unknown) => e);
    expect(pgCodeOf(err)).toBe("23P01");
  });

  it("checks changed dates too", async () => {
    const a = await createHold(db, hold("2026-11-06", "2026-11-09"));
    const b = await createHold(db, hold("2026-11-12", "2026-11-14"));
    if (!a.ok || !b.ok) throw new Error("setup failed");
    const err = await db
      .update(bookings)
      .set({ checkOut: "2026-11-13" })
      .where(eq(bookings.id, a.bookingId))
      .catch((e: unknown) => e);
    expect(pgCodeOf(err)).toBe("23P01");
  });
});

describe("schema guards", () => {
  it("rejects two seasons covering the same night", async () => {
    await db
      .insert(rateRules)
      .values({ propertyId: homeId, kind: "SEASON", nightlyCents: 30_000, during: "[2026-06-01,2026-09-01)" });
    const err = await db
      .insert(rateRules)
      .values({ propertyId: homeId, kind: "SEASON", nightlyCents: 35_000, during: "[2026-08-15,2026-08-20)" })
      .catch((e: unknown) => e);
    expect(pgCodeOf(err)).toBe("23P01");
  });

  it("rejects a hold without an expiry and a stay that ends before it starts", async () => {
    const base = { code: "SSR-TEST01", propertyId: homeId, guests: 2 } as const;
    const noExpiry = await db
      .insert(bookings)
      .values({ ...base, status: "HOLD", checkIn: "2026-11-06", checkOut: "2026-11-09" })
      .catch((e: unknown) => e);
    expect(pgCodeOf(noExpiry)).toBe("23514");
    const backwards = await db
      .insert(bookings)
      .values({ ...base, status: "CONFIRMED", checkIn: "2026-11-09", checkOut: "2026-11-06" })
      .catch((e: unknown) => e);
    expect(pgCodeOf(backwards)).toBe("23514");
  });

  it("loads the development seed", async () => {
    await db.execute(sql`truncate properties, site_settings cascade`);
    const seed = await readFile(path.resolve(__dirname, "../../supabase/seed.sql"), "utf8");
    await db.execute(sql.raw(seed));
    const [home] = await db.select().from(properties).where(eq(properties.slug, "surfside-sunrise-house"));
    expect(home).toMatchObject({ maxGuests: 8, cleaningFeeCents: 17_500, petFeeCents: 5_000, maxPets: null });
  });
});
