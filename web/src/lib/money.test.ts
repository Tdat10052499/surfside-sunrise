import { describe, expect, it } from "vitest";
import { assertCents, formatUsd, percentOf } from "./money";

describe("money", () => {
  it("rounds percentages half up to the cent", () => {
    expect(percentOf(10_005, 600)).toBe(600); // 600.3
    expect(percentOf(10_050, 500)).toBe(503); // 502.5
    expect(percentOf(0, 1_100)).toBe(0);
  });

  it("only accepts non-negative integer cents", () => {
    expect(assertCents(17_500)).toBe(17_500);
    expect(() => assertCents(1.5)).toThrow(RangeError);
    expect(() => assertCents(-1)).toThrow(RangeError);
  });

  it("formats USD", () => {
    expect(formatUsd(17_500)).toBe("$175.00");
  });
});
