"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/session";
import { serverEnv } from "@/lib/env";
import { connectStripe, disconnectStripe } from "@/lib/payments/connection";
import { stripeGateway } from "@/lib/payments/gateway";
import { siteUrl } from "@/lib/payments/runtime";

export type ConnectState = { error?: string; ok?: boolean };

const MESSAGES: Record<string, string> = {
  bad_format: "That doesn’t look like a Stripe secret key. It starts with rk_live_, sk_live_, rk_test_ or sk_test_.",
  publishable_key: "That’s the publishable key (pk_…). Paste the secret or restricted key instead.",
  rejected: "Stripe didn’t accept that key",
  no_site_url: "The site address isn’t known yet, so Stripe can’t be told where to send updates. Ask the site team.",
  no_secrets_key: "Keys can’t be stored safely yet (SECRETS_KEY is missing). Ask the site team.",
};

export async function connectStripeAction(_prev: ConnectState, form: FormData): Promise<ConnectState> {
  const admin = await requireAdmin();
  const key = String(form.get("key") ?? "").slice(0, 300);
  const result = await connectStripe(
    getDb(),
    { key, adminId: admin.id, siteUrl: siteUrl(), env: serverEnv() },
    stripeGateway,
  );
  if (!result.ok) {
    return { error: result.detail ? `${MESSAGES[result.reason]}: ${result.detail}` : MESSAGES[result.reason] };
  }
  revalidatePath("/admin/connections");
  return { ok: true };
}

export async function disconnectStripeAction(): Promise<void> {
  await requireAdmin();
  await disconnectStripe(getDb(), serverEnv(), stripeGateway);
  revalidatePath("/admin/connections");
}
