import { describe, expect, it } from "vitest";
import { checkNewPassword, hashPassword, passwordRules, verifyPassword } from "./password";
import { safeNextPath } from "./next-path";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse 42");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse 42", hash)).toBe(true);
    expect(await verifyPassword("correct horse 43", hash)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password 1")).not.toBe(await hashPassword("same password 1"));
  });

  it("returns false for a hash it cannot read", async () => {
    for (const bad of ["", "plain", "bcrypt$1$2$3$4$5", "scrypt$x$8$1$AAAA$BBBB", "scrypt$32768$8$1$AAAA$"]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });
});

describe("new password rules", () => {
  const base = { current: "Temporary-pass-1", email: "host@example.com" };

  it("lists the rules for the checklist", () => {
    expect(passwordRules("short1").map((r) => r.ok)).toEqual([false, true]);
    expect(passwordRules("longenoughbutnodigits").map((r) => r.ok)).toEqual([true, false]);
    expect(passwordRules("sunrise over 2 decks").every((r) => r.ok)).toBe(true);
  });

  it("accepts a good password", () => {
    expect(checkNewPassword({ ...base, password: "sunrise over 2 decks", repeat: "sunrise over 2 decks" })).toBeNull();
  });

  it("names what is wrong", () => {
    const check = (password: string, repeat = password) => checkNewPassword({ ...base, password, repeat });
    expect(check("short1")).toBe("rules");
    expect(check("a1".repeat(65))).toBe("too_long");
    expect(check("sunrise over 2 decks", "sunrise over 2 deck")).toBe("mismatch");
    expect(check("Temporary-pass-1")).toBe("same_as_current");
    expect(check("my host password 9")).toBe("contains_email");
  });
});

describe("safeNextPath", () => {
  it("keeps admin paths", () => {
    expect(safeNextPath("/admin")).toBe("/admin");
    expect(safeNextPath("/admin/bookings/abc-123")).toBe("/admin/bookings/abc-123");
    expect(safeNextPath("/admin/bookings?status=AWAITING")).toBe("/admin/bookings?status=AWAITING");
  });

  it("refuses anything that could leave the admin area", () => {
    for (const bad of [
      undefined,
      "",
      "/",
      "https://evil.example/admin",
      "//evil.example",
      "/admin.evil",
      "/admin/login",
      "/admin\\..\\x",
      "/administrator",
    ]) {
      expect(safeNextPath(bad)).toBe("/admin");
    }
  });
});
