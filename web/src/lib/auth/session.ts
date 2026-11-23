// Next.js side of admin sign-in: the session cookie and the checks every admin page,
// Server Action and Route Handler calls. Pages must call these themselves; the proxy
// (src/proxy.ts) only redirects early when no cookie is present.
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { sessionAdmin, type Admin } from "./service";

export { safeNextPath } from "./next-path";

export const SESSION_COOKIE = "ssr_admin";
export const LOGIN_PATH = "/admin/login";
export const CHANGE_PASSWORD_PATH = "/admin/change-password";

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Only from a Server Action or Route Handler: cookies can't be set while rendering. */
export async function setSessionCookie(token: string, expires: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentAdmin(): Promise<Admin | null> {
  const token = await sessionToken();
  await connection(); // the session check compares against the current time
  return sessionAdmin(getDb(), token);
}

/**
 * The signed-in admin, or a redirect to the sign-in page. An admin still on the
 * temporary password is sent to the change-password page first, unless the caller
 * is that page.
 */
export async function requireAdmin(opts: { allowPasswordChange?: boolean } = {}): Promise<Admin> {
  const admin = await currentAdmin();
  if (!admin) redirect(LOGIN_PATH);
  if (admin.mustChangePassword && !opts.allowPasswordChange) redirect(CHANGE_PASSWORD_PATH);
  return admin;
}
