import { describe, expect, it } from "vitest";
import { addDays, dayOfWeek, isIsoDate, nightCount, stayNights } from "./dates";

describe("dates", () => {
  it("counts nights across month, year and DST boundaries", () => {
    expect(nightCount("2026-10-30", "2026-11-02")).toBe(3); // US DST ends 2026-11-01
    expect(nightCount("2026-12-30", "2027-01-02")).toBe(3);
    expect(nightCount("2028-02-28", "2028-03-01")).toBe(2); // leap year
  });

  it("lists the nights of a stay, excluding the check-out day", () => {
    expect(stayNights("2026-11-06", "2026-11-09")).toEqual(["2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(stayNights("2026-11-06", "2026-11-06")).toEqual([]);
  });

  it("validates calendar dates", () => {
    expect(isIsoDate("2026-11-06")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-11-6")).toBe(false);
    expect(isIsoDate("tomorrow")).toBe(false);
  });

  it("knows the weekday", () => {
    expect(dayOfWeek("2026-11-06")).toBe(5); // Friday
    expect(addDays("2026-11-06", 2)).toBe("2026-11-08");
  });
});
