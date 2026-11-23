"use server";
// Every action re-checks the session itself; nothing here trusts the browser.
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { PASSWORD_MAX_LENGTH } from "@/lib/auth/password";
import { changePassword, login, logout } from "@/lib/auth/service";
import {
  CHANGE_PASSWORD_PATH,
  LOGIN_PATH,
  clearSessionCookie,
  safeNextPath,
  sessionToken,
  setSessionCookie,
} from "@/lib/auth/session";

export type FormState = { error?: string; email?: string };

const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.slice(0, PASSWORD_MAX_LENGTH + 1) : "";
};

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const email = field(form, "email").trim();
  const password = field(form, "password");
  if (!email || !password) return { error: "Enter your email and password.", email };

  const result = await login(getDb(), email, password);
  if (!result.ok) {
    if (result.reason === "locked") {
      const mins = Math.max(1, Math.ceil((result.lockedUntil.getTime() - Date.now()) / 60_000));
      return {
        error: `Too many wrong tries. Sign-in is paused for this account; try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
        email,
      };
    }
    return { error: "That email and password don’t match.", email };
  }
  await setSessionCookie(result.token, result.expiresAt);
  redirect(result.mustChangePassword ? CHANGE_PASSWORD_PATH : safeNextPath(form.get("next")));
}

const CHANGE_ERRORS: Record<string, string> = {
  wrong_current: "Your current password isn’t right.",
  rules: "The new password doesn’t meet the rules below.",
  too_long: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  mismatch: "The two new passwords don’t match.",
  same_as_current: "Choose a password different from the current one.",
  contains_email: "Don’t use your email name in the password.",
};

export async function updatePassword(_prev: FormState, form: FormData): Promise<FormState> {
  const token = await sessionToken();
  if (!token) redirect(LOGIN_PATH);
  const result = await changePassword(getDb(), token, {
    current: field(form, "current"),
    password: field(form, "password"),
    repeat: field(form, "repeat"),
  });
  if (!result.ok) return { error: CHANGE_ERRORS[result.reason] };
  redirect("/admin?password=changed");
}

export async function signOut(): Promise<void> {
  await logout(getDb(), await sessionToken());
  await clearSessionCookie();
  redirect(LOGIN_PATH);
}
