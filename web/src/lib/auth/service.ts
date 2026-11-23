// Admin accounts and sessions, independent of Next.js so it can be tested against Postgres.
// The Next.js side (cookies, redirects) lives in ./session.ts.
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { adminSessions, adminUsers } from "@/db/schema";
import { checkNewPassword, decoyHash, hashPassword, verifyPassword, type NewPasswordProblem } from "./password";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const SESSION_DAYS = 7;

const minutes = (n: number) => n * 60_000;
const days = (n: number) => n * 86_400_000;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; mustChangePassword: boolean }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; lockedUntil: Date };

/**
 * Checks an email and password. Five wrong passwords in a row lock the account for
 * 15 minutes; while locked, even the right password is refused. An unknown email
 * takes as long as a wrong password and gets the same answer.
 */
export async function login(db: Db, emailInput: string, password: string, now = new Date()): Promise<LoginResult> {
  const email = normalizeEmail(emailInput);
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  if (!user) {
    await verifyPassword(password, await decoyHash());
    return { ok: false, reason: "invalid" };
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    return { ok: false, reason: "locked", lockedUntil: user.lockedUntil };
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    // Counted in SQL so two parallel guesses can't both read the old count.
    const [row] = await db
      .update(adminUsers)
      .set({
        failedAttempts: sql`case when ${adminUsers.failedAttempts} + 1 >= ${MAX_FAILED_ATTEMPTS} then 0 else ${adminUsers.failedAttempts} + 1 end`,
        lockedUntil: sql`case when ${adminUsers.failedAttempts} + 1 >= ${MAX_FAILED_ATTEMPTS} then ${new Date(now.getTime() + minutes(LOCK_MINUTES)).toISOString()}::timestamptz else null end`,
      })
      .where(eq(adminUsers.id, user.id))
      .returning({ lockedUntil: adminUsers.lockedUntil });
    return row?.lockedUntil
      ? { ok: false, reason: "locked", lockedUntil: row.lockedUntil }
      : { ok: false, reason: "invalid" };
  }

  await db
    .update(adminUsers)
    .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: now })
    .where(eq(adminUsers.id, user.id));
  const { token, expiresAt } = await createSession(db, user.id, now);
  return { ok: true, token, expiresAt, mustChangePassword: user.mustChangePassword };
}

async function createSession(db: Db, adminId: string, now: Date) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + days(SESSION_DAYS));
  await db.insert(adminSessions).values({ tokenHash: hashToken(token), adminId, createdAt: now, expiresAt });
  return { token, expiresAt };
}

export type Admin = { id: string; email: string; mustChangePassword: boolean };

/** The admin a session token belongs to, or null if it is unknown or expired. */
export async function sessionAdmin(db: Db, token: string | undefined, now = new Date()): Promise<Admin | null> {
  if (!token) return null;
  const [row] = await db
    .select({ id: adminUsers.id, email: adminUsers.email, mustChangePassword: adminUsers.mustChangePassword })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminId))
    .where(and(eq(adminSessions.tokenHash, hashToken(token)), gt(adminSessions.expiresAt, now)));
  return row ?? null;
}

export async function logout(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token)));
}

export type ChangePasswordResult = { ok: true } | { ok: false; reason: "wrong_current" | NewPasswordProblem };

/**
 * Replaces the password of the admin signed in with `token`. Requires the current
 * password, clears the must-change flag, and signs out every other browser.
 */
export async function changePassword(
  db: Db,
  token: string,
  input: { current: string; password: string; repeat: string },
  now = new Date(),
): Promise<ChangePasswordResult> {
  const admin = await sessionAdmin(db, token, now);
  if (!admin) return { ok: false, reason: "wrong_current" };
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.id));
  if (!user || !(await verifyPassword(input.current, user.passwordHash))) return { ok: false, reason: "wrong_current" };
  const problem = checkNewPassword({ ...input, email: user.email });
  if (problem) return { ok: false, reason: problem };

  const passwordHash = await hashPassword(input.password);
  await db.transaction(async (tx) => {
    await tx
      .update(adminUsers)
      .set({ passwordHash, mustChangePassword: false, passwordChangedAt: now, failedAttempts: 0, lockedUntil: null })
      .where(eq(adminUsers.id, user.id));
    await tx
      .delete(adminSessions)
      .where(and(eq(adminSessions.adminId, user.id), ne(adminSessions.tokenHash, hashToken(token))));
  });
  return { ok: true };
}
