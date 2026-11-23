// Public home data against a real Postgres: only published homes, taken nights
// without guest details, and quotes that use the server's rates and availability.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { bookings, calendarBlocks, properties, rateRules, taxRates } from "@/db/schema";
import { resetDatabase, testDatabaseUrl } from "@/test/database";
import { getHome, homeCalendar, listHomes, localToday, MAX_STAY_NIGHTS, quoteHome } from "./homes";

const url = testDatabaseUrl();
let db: Db;
let close: () => Promise<void>;
let homeId: string;

// 10:00 in Texas on 2026-11-23 (America/Chicago is UTC-6 in November).
const now = new Date("2026-11-23T16:00:00Z");
const SLUG = "test-home";

beforeAll(async () => {
  await resetDatabase(url);
  ({ db, close } = createDb(url));
});
afterAll(() => close());

beforeEach(async () => {
  await db.execute(
    sql`truncate properties, bookings, calendar_blocks, occupancy, rate_rules, tax_rates, email_outbox cascade`,
  );
  const [home] = await db
    .insert(properties)
    .values({
      slug: SLUG,
      name: "Test Home",
      status: "PUBLISHED",
      maxGuests: 8,
      maxPets: 2,
      cleaningFeeCents: 17_500,
      petFeeCents: 5_000,
    })
    .returning({ id: properties.id });
  homeId = home.id;
  await db.insert(properties).values({ slug: "draft-home", name: "Draft", status: "DRAFT", maxGuests: 4 });
});

let codeSeq = 0;
async function addBooking(
  checkIn: string,
  checkOut: string,
  status: "HOLD" | "AWAITING_APPROVAL" | "CONFIRMED" | "REJECTED",
  holdExpiresAt?: Date,
) {
  await db.insert(bookings).values({
    code: `T${++codeSeq}`,
    propertyId: homeId,
    status,
    checkIn,
    checkOut,
    guests: 2,
    guestName: "Private Guest",
    guestEmail: "private@example.com",
    holdExpiresAt: status === "HOLD" ? (holdExpiresAt ?? new Date(now.getTime() + 600_000)) : null,
  });
}

// Sample rates for tests only; the owner has not set real prices.
async function addRates() {
  await db.insert(rateRules).values([
    { propertyId: homeId, kind: "BASE", nightlyCents: 20_000 },
    { propertyId: homeId, kind: "WEEKEND", nightlyCents: 25_000 },
    { propertyId: homeId, kind: "SEASON", nightlyCents: 30_000, during: "[2026-12-20,2027-01-02)", label: "Holidays" },
    { propertyId: homeId, kind: "DATE", nightlyCents: 40_000, during: "[2026-12-31,2027-01-01)" },
  ]);
}

describe("homes", () => {
  it("lists only published homes, without internal ids", async () => {
    const homes = await listHomes(db);
    expect(homes.map((h) => h.slug)).toEqual([SLUG]);
    expect(homes[0]).not.toHaveProperty("id");
    expect(homes[0]).toMatchObject({ maxGuests: 8, maxPets: 2, cleaningFeeCents: 17_500, timezone: "America/Chicago" });
  });

  it("hides unpublished and unknown homes", async () => {
    expect(await getHome(db, SLUG)).toMatchObject({ name: "Test Home" });
    expect(await getHome(db, "draft-home")).toBeNull();
    expect(await getHome(db, "nope")).toBeNull();
  });
});

describe("localToday", () => {
  it("uses the home's time zone", () => {
    // 03:00 UTC on the 24th is still the 23rd in Texas.
    expect(localToday("America/Chicago", new Date("2026-11-24T03:00:00Z"))).toBe("2026-11-23");
    expect(localToday("UTC", new Date("2026-11-24T03:00:00Z"))).toBe("2026-11-24");
  });
});

describe("homeCalendar", () => {
  it("merges bookings, live holds and owner blocks into taken ranges", async () => {
    await addBooking("2026-12-01", "2026-12-04", "CONFIRMED");
    await addBooking("2026-12-04", "2026-12-06", "AWAITING_APPROVAL"); // back to back: merged
    await addBooking("2026-12-10", "2026-12-12", "HOLD");
    await db.insert(calendarBlocks).values({ propertyId: homeId, during: "[2026-12-24,2026-12-27)", reason: "Family" });

    const r = await homeCalendar(db, SLUG, {}, now);
    expect(r).toEqual({
      ok: true,
      from: "2026-11-23",
      to: "2027-11-23",
      taken: [
        { start: "2026-12-01", end: "2026-12-06" },
        { start: "2026-12-10", end: "2026-12-12" },
        { start: "2026-12-24", end: "2026-12-27" },
      ],
    });
    expect(JSON.stringify(r)).not.toMatch(/Private|private@|Family|HOLD|CONFIRMED/);
  });

  it("frees nights of rejected bookings and of holds whose time ran out", async () => {
    await addBooking("2026-12-01", "2026-12-04", "REJECTED");
    await addBooking("2026-12-10", "2026-12-12", "HOLD", new Date(now.getTime() - 1000));
    const r = await homeCalendar(db, SLUG, {}, now);
    expect(r.ok && r.taken).toEqual([]);
  });

  it("clips ranges to the window asked for", async () => {
    await addBooking("2026-12-01", "2026-12-10", "CONFIRMED");
    const r = await homeCalendar(db, SLUG, { from: "2026-12-05", to: "2026-12-08" }, now);
    expect(r.ok && r.taken).toEqual([{ start: "2026-12-05", end: "2026-12-08" }]);
  });

  it("rejects bad windows and unknown homes", async () => {
    for (const range of [
      { from: "2026-12-08", to: "2026-12-05" },
      { from: "2026-02-30", to: "2026-03-05" },
      { from: "2026-01-01", to: "2028-01-01" },
    ]) {
      expect(await homeCalendar(db, SLUG, range, now)).toEqual({ ok: false, error: "INVALID_RANGE" });
    }
    expect(await homeCalendar(db, "draft-home", {}, now)).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});

describe("quoteHome", () => {
  const ask = (checkIn: string, checkOut: string, guests = 2, pets = 0) =>
    quoteHome(db, SLUG, { checkIn, checkOut, guests, pets }, now);

  it("says the price is not set while the owner has no rates", async () => {
    expect(await ask("2026-12-07", "2026-12-09")).toEqual({
      ok: false,
      error: { code: "RATE_MISSING", date: "2026-12-07" },
    });
  });

  it("prices weekday, weekend, season and single-date nights from the database", async () => {
    await addRates();
    // Thu 3 Dec, Fri 4 Dec (weekend), Sat 5 Dec (weekend)
    const r = await ask("2026-12-03", "2026-12-06", 2, 1);
    expect(r.ok && r.quote.nights.map((n) => [n.date, n.kind, n.cents])).toEqual([
      ["2026-12-03", "BASE", 20_000],
      ["2026-12-04", "WEEKEND", 25_000],
      ["2026-12-05", "WEEKEND", 25_000],
    ]);
    expect(r.ok && r.quote.totalCents).toBe(70_000 + 17_500 + 5_000);
    expect(r.ok && r.currency).toBe("USD");

    const nye = await ask("2026-12-30", "2027-01-02");
    expect(nye.ok && nye.quote.nights.map((n) => n.cents)).toEqual([30_000, 40_000, 30_000]);
  });

  it("adds active taxes only", async () => {
    await addRates();
    await db.insert(taxRates).values([
      { propertyId: homeId, name: "Sample tax", rateBasisPoints: 1_100 },
      { propertyId: homeId, name: "Old tax", rateBasisPoints: 500, active: false },
    ]);
    const r = await ask("2026-12-07", "2026-12-08");
    expect(r.ok && r.quote.lines.filter((l) => l.code === "TAX")).toEqual([
      { code: "TAX", label: "Sample tax", quantity: 1, unitCents: null, amountCents: 2_200 },
    ]);
  });

  it("refuses nights that are taken and says which", async () => {
    await addRates();
    await addBooking("2026-12-05", "2026-12-08", "CONFIRMED");
    expect(await ask("2026-12-07", "2026-12-10")).toEqual({
      ok: false,
      error: { code: "DATES_TAKEN", taken: [{ start: "2026-12-07", end: "2026-12-08" }] },
    });
    // Check-in on the day the other guest checks out is fine.
    expect((await ask("2026-12-08", "2026-12-10")).ok).toBe(true);
  });

  it("checks dates and party size before anything else", async () => {
    await addRates();
    expect(await ask("2026-11-22", "2026-11-24")).toEqual({ ok: false, error: { code: "PAST_DATES" } });
    expect((await ask("2026-11-23", "2026-11-24")).ok).toBe(true); // today is bookable
    expect(await ask("2026-12-10", "2026-12-10")).toEqual({ ok: false, error: { code: "INVALID_DATES" } });
    expect(await ask("2028-12-01", "2028-12-03")).toMatchObject({ ok: false, error: { code: "TOO_FAR_AHEAD" } });
    expect(await ask("2027-01-01", "2027-03-15")).toEqual({
      ok: false,
      error: { code: "TOO_LONG", maxNights: MAX_STAY_NIGHTS },
    });
    expect(await ask("2026-12-07", "2026-12-09", 9)).toEqual({
      ok: false,
      error: { code: "TOO_MANY_GUESTS", maxGuests: 8 },
    });
    expect(await ask("2026-12-07", "2026-12-09", 2, 3)).toEqual({
      ok: false,
      error: { code: "TOO_MANY_PETS", maxPets: 2 },
    });
    expect(
      await quoteHome(db, "draft-home", { checkIn: "2026-12-07", checkOut: "2026-12-09", guests: 1, pets: 0 }, now),
    ).toEqual({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});
