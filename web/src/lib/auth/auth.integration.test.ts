// Admin sign-in against a real Postgres: lockout, sessions, forced password change, bootstrap.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { adminSessions, adminUsers } from "@/db/schema";
import { resetDatabase, testDatabaseUrl } from "@/test/database";
import { bootstrapAdmin } from "./bootstrap";
import {
  changePassword,
  LOCK_MINUTES,
  login,
  logout,
  MAX_FAILED_ATTEMPTS,
  SESSION_DAYS,
  sessionAdmin,
} from "./service";

const url = testDatabaseUrl();
let db: Db;
let close: () => Promise<void>;

const EMAIL = "host@example.com";
const TEMP = "temporary-pass-2026"; // test value only
const NEW = "sunrise over 2 decks";
const t0 = new Date("2026-11-23T12:00:00Z");
const later = (ms: number) => new Date(t0.getTime() + ms);

beforeAll(async () => {
  await resetDatabase(url);
  ({ db, close } = createDb(url));
});
afterAll(() => close());
beforeEach(async () => {
  await db.delete(adminUsers);
  expect(await bootstrapAdmin(url, { email: " Host@Example.com ", password: TEMP })).toBe("created");
});

async function signedIn(password = TEMP, now = t0) {
  const r = await login(db, EMAIL, password, now);
  if (!r.ok) throw new Error(r.reason);
  return r;
}

describe("bootstrapAdmin", () => {
  it("creates the first admin only once, with a must-change flag", async () => {
    expect(await bootstrapAdmin(url, { email: "other@example.com", password: "another-pass-123" })).toBe("exists");
    const users = await db.select().from(adminUsers);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: EMAIL, mustChangePassword: true });
    expect(users[0].passwordHash).not.toContain(TEMP);
  });

  it("resets a forgotten password and signs the admin out everywhere", async () => {
    const s = await signedIn();
    await changePassword(db, s.token, { current: TEMP, password: NEW, repeat: NEW }, t0);
    expect(await bootstrapAdmin(url, { email: EMAIL, password: TEMP, reset: true })).toBe("reset");
    expect(await sessionAdmin(db, s.token, t0)).toBeNull();
    const again = await signedIn(TEMP);
    expect(again.mustChangePassword).toBe(true);
  });

  it("refuses to reset an unknown email", async () => {
    await expect(bootstrapAdmin(url, { email: "nobody@example.com", password: TEMP, reset: true })).rejects.toThrow();
  });
});

describe("login", () => {
  it("signs in with the temporary password and asks for a new one", async () => {
    const r = await signedIn();
    expect(r.mustChangePassword).toBe(true);
    expect(r.expiresAt).toEqual(later(SESSION_DAYS * 86_400_000));
    expect(await sessionAdmin(db, r.token, t0)).toMatchObject({ email: EMAIL, mustChangePassword: true });
  });

  it("stores only a hash of the session token", async () => {
    const r = await signedIn();
    const rows = await db.select().from(adminSessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(r.token);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    expect(await login(db, EMAIL, "wrong-password-1", t0)).toEqual({ ok: false, reason: "invalid" });
    expect(await login(db, "nobody@example.com", TEMP, t0)).toEqual({ ok: false, reason: "invalid" });
  });

  it(`locks the account for ${LOCK_MINUTES} minutes after ${MAX_FAILED_ATTEMPTS} wrong passwords`, async () => {
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      expect(await login(db, EMAIL, "wrong-password-1", t0)).toMatchObject({ reason: "invalid" });
    }
    expect(await login(db, EMAIL, "wrong-password-1", t0)).toMatchObject({ reason: "locked" });
    // Even the right password is refused while locked.
    expect(await login(db, EMAIL, TEMP, later(LOCK_MINUTES * 60_000 - 1000))).toMatchObject({ reason: "locked" });
    expect((await login(db, EMAIL, TEMP, later(LOCK_MINUTES * 60_000 + 1000))).ok).toBe(true);
  });

  it("resets the count after a successful sign-in", async () => {
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) await login(db, EMAIL, "wrong-password-1", t0);
    await signedIn();
    expect(await login(db, EMAIL, "wrong-password-1", t0)).toMatchObject({ reason: "invalid" });
  });

  it("ignores email case and spaces", async () => {
    expect((await login(db, "  HOST@example.COM ", TEMP, t0)).ok).toBe(true);
  });
});

describe("sessions", () => {
  it("expire", async () => {
    const r = await signedIn();
    expect(await sessionAdmin(db, r.token, later(SESSION_DAYS * 86_400_000 - 1000))).not.toBeNull();
    expect(await sessionAdmin(db, r.token, later(SESSION_DAYS * 86_400_000 + 1000))).toBeNull();
  });

  it("end at sign-out", async () => {
    const r = await signedIn();
    await logout(db, r.token);
    expect(await sessionAdmin(db, r.token, t0)).toBeNull();
  });

  it("reject unknown tokens", async () => {
    expect(await sessionAdmin(db, "forged-token", t0)).toBeNull();
    expect(await sessionAdmin(db, undefined, t0)).toBeNull();
  });
});

describe("changePassword", () => {
  it("replaces the temporary password and clears the flag", async () => {
    const s = await signedIn();
    expect(await changePassword(db, s.token, { current: TEMP, password: NEW, repeat: NEW }, t0)).toEqual({ ok: true });
    expect(await sessionAdmin(db, s.token, t0)).toMatchObject({ mustChangePassword: false });
    expect(await login(db, EMAIL, TEMP, t0)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await signedIn(NEW)).toMatchObject({ mustChangePassword: false });
  });

  it("keeps this browser signed in and signs out the others", async () => {
    const here = await signedIn();
    const other = await signedIn();
    await changePassword(db, here.token, { current: TEMP, password: NEW, repeat: NEW }, t0);
    expect(await sessionAdmin(db, here.token, t0)).not.toBeNull();
    expect(await sessionAdmin(db, other.token, t0)).toBeNull();
  });

  it("needs the current password and a valid new one", async () => {
    const s = await signedIn();
    const change = (current: string, password: string, repeat = password) =>
      changePassword(db, s.token, { current, password, repeat }, t0);
    expect(await change("wrong-password-1", NEW)).toEqual({ ok: false, reason: "wrong_current" });
    expect(await change(TEMP, "short1")).toEqual({ ok: false, reason: "rules" });
    expect(await change(TEMP, NEW, NEW + "x")).toEqual({ ok: false, reason: "mismatch" });
    expect(await change(TEMP, TEMP)).toEqual({ ok: false, reason: "same_as_current" });
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, EMAIL));
    expect(user.mustChangePassword).toBe(true);
  });

  it("refuses without a valid session", async () => {
    expect(await changePassword(db, "forged-token", { current: TEMP, password: NEW, repeat: NEW }, t0)).toEqual({
      ok: false,
      reason: "wrong_current",
    });
  });
});
