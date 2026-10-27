import { describe, expect, it } from "vitest";
import { DEFAULT_WEEKEND_NIGHTS, quoteStay, type PricingProperty, type RateRule } from "./quote";

// Sample numbers for tests only. Real nightly rates are TODO until the owner sets them.
const home: PricingProperty = {
  maxGuests: 8,
  maxPets: null,
  minNights: 1,
  cleaningFeeCents: 17_500,
  petFeeCents: 5_000,
  weekendNights: DEFAULT_WEEKEND_NIGHTS,
};
const base: RateRule = { kind: "BASE", nightlyCents: 20_000 };
const weekend: RateRule = { kind: "WEEKEND", nightlyCents: 25_000 };

// 2026-11-02 is a Monday.
const weekdays = { checkIn: "2026-11-02", checkOut: "2026-11-05", guests: 4, pets: 0 };

describe("quoteStay", () => {
  it("prices weekday nights at the base rate and adds the cleaning fee", () => {
    const r = quoteStay(weekdays, home, [base, weekend]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quote.nights.map((n) => n.kind)).toEqual(["BASE", "BASE", "BASE"]);
    expect(r.quote.lines).toEqual([
      { code: "NIGHTS", label: "3 nights", quantity: 3, unitCents: null, amountCents: 60_000 },
      { code: "CLEANING", label: "Cleaning fee", quantity: 1, unitCents: 17_500, amountCents: 17_500 },
    ]);
    expect(r.quote.totalCents).toBe(77_500);
  });

  it("uses the weekend rate on Friday and Saturday nights only", () => {
    // Thu 5 Nov -> Sun 8 Nov: Thu, Fri, Sat nights
    const r = quoteStay({ ...weekdays, checkIn: "2026-11-05", checkOut: "2026-11-08" }, home, [base, weekend]);
    if (!r.ok) throw new Error(r.error.code);
    expect(r.quote.nights.map((n) => [n.date, n.kind])).toEqual([
      ["2026-11-05", "BASE"],
      ["2026-11-06", "WEEKEND"],
      ["2026-11-07", "WEEKEND"],
    ]);
    expect(r.quote.subtotalCents).toBe(20_000 + 25_000 * 2 + 17_500);
  });

  it("applies DATE > SEASON > WEEKEND > BASE", () => {
    const rules: RateRule[] = [
      base,
      weekend,
      { kind: "SEASON", nightlyCents: 30_000, start: "2026-11-06", end: "2026-11-08" },
      { kind: "DATE", nightlyCents: 40_000, date: "2026-11-07" },
    ];
    const r = quoteStay({ ...weekdays, checkIn: "2026-11-05", checkOut: "2026-11-09" }, home, rules);
    if (!r.ok) throw new Error(r.error.code);
    expect(r.quote.nights.map((n) => [n.kind, n.cents])).toEqual([
      ["BASE", 20_000],
      ["SEASON", 30_000],
      ["DATE", 40_000],
      ["BASE", 20_000], // Sunday night, season ended on the 8th (exclusive)
    ]);
  });

  it("charges the pet fee once per pet per stay", () => {
    const r = quoteStay({ ...weekdays, pets: 2 }, home, [base]);
    if (!r.ok) throw new Error(r.error.code);
    expect(r.quote.lines.find((l) => l.code === "PET")).toEqual({
      code: "PET",
      label: "Pet fee (2)",
      quantity: 2,
      unitCents: 5_000,
      amountCents: 10_000,
    });
    expect(r.quote.totalCents).toBe(60_000 + 17_500 + 10_000);
  });

  it("rounds each tax half up on its own base", () => {
    // 1 night at 10_005 cents; 6% = 600.3 -> 600, 5% = 500.25 -> 500
    const rules: RateRule[] = [{ kind: "BASE", nightlyCents: 10_005 }];
    const r = quoteStay({ ...weekdays, checkOut: "2026-11-03" }, { ...home, cleaningFeeCents: 0 }, rules, [
      {
        name: "Tax A (sample)",
        basisPoints: 600,
        appliesToNightly: true,
        appliesToCleaning: false,
        appliesToPet: false,
      },
      {
        name: "Tax B (sample)",
        basisPoints: 500,
        appliesToNightly: true,
        appliesToCleaning: false,
        appliesToPet: false,
      },
    ]);
    if (!r.ok) throw new Error(r.error.code);
    expect(r.quote.taxCents).toBe(1_100);
    expect(r.quote.totalCents).toBe(11_105);
    expect(r.quote.lines.filter((l) => l.code === "TAX").map((l) => l.amountCents)).toEqual([600, 500]);
  });

  it("only taxes the fees a tax is configured for", () => {
    const r = quoteStay(
      { ...weekdays, checkOut: "2026-11-03", pets: 1 },
      home,
      [base],
      [
        {
          name: "Sample tax",
          basisPoints: 1_000,
          appliesToNightly: true,
          appliesToCleaning: true,
          appliesToPet: false,
        },
      ],
    );
    if (!r.ok) throw new Error(r.error.code);
    expect(r.quote.taxCents).toBe(Math.round((20_000 + 17_500) / 10));
  });

  it.each([
    [{ checkIn: "2026-11-05", checkOut: "2026-11-05" }, "INVALID_DATES"],
    [{ checkIn: "2026-11-05", checkOut: "2026-11-04" }, "INVALID_DATES"],
    [{ checkIn: "2026-02-30", checkOut: "2026-03-02" }, "INVALID_DATES"],
    [{ guests: 9 }, "TOO_MANY_GUESTS"],
    [{ guests: 0 }, "INVALID_GUESTS"],
    [{ pets: -1 }, "INVALID_GUESTS"],
    [{ guests: 2.5 }, "INVALID_GUESTS"],
  ])("rejects %o with %s", (patch, code) => {
    const r = quoteStay({ ...weekdays, ...patch }, home, [base]);
    expect(r.ok ? null : r.error.code).toBe(code);
  });

  it("enforces minimum nights and the pet limit once set", () => {
    const strict = { ...home, minNights: 2, maxPets: 1 };
    expect(quoteStay({ ...weekdays, checkOut: "2026-11-03" }, strict, [base])).toEqual({
      ok: false,
      error: { code: "MIN_NIGHTS", minNights: 2 },
    });
    expect(quoteStay({ ...weekdays, pets: 2 }, strict, [base])).toEqual({
      ok: false,
      error: { code: "TOO_MANY_PETS", maxPets: 1 },
    });
  });

  it("refuses to quote a night with no rate", () => {
    expect(quoteStay(weekdays, home, [])).toEqual({
      ok: false,
      error: { code: "RATE_MISSING", date: "2026-11-02" },
    });
  });

  it("refuses overlapping rules of the same kind instead of guessing", () => {
    const r = quoteStay(weekdays, home, [
      base,
      { kind: "SEASON", nightlyCents: 1, start: "2026-11-01", end: "2026-11-10" },
      { kind: "SEASON", nightlyCents: 2, start: "2026-11-03", end: "2026-11-04" },
    ]);
    expect(r).toEqual({ ok: false, error: { code: "RATE_CONFLICT", date: "2026-11-03", kind: "SEASON" } });
  });

  it("rejects non-integer money in configuration", () => {
    expect(() => quoteStay(weekdays, home, [{ kind: "BASE", nightlyCents: 199.99 }])).toThrow(RangeError);
  });
});
