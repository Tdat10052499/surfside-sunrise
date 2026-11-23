// The Stripe card on the Connections page: the owner pastes one key and the server
// checks it, creates the webhook endpoint and stores both secrets encrypted.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { serviceCredentials } from "@/db/schema";
import { decryptSecret, encryptSecret, maskKey } from "@/lib/secrets";
import { STRIPE_KEY_PATTERN, WEBHOOK_EVENTS, type StripeGateway } from "./gateway";

export const WEBHOOK_PATH = "/api/stripe/webhook";

type StripeMeta = {
  masked: string;
  livemode: boolean;
  accountName: string | null;
  webhookId: string;
  webhookUrl: string;
};

export type StripeStatus =
  | { connected: false }
  | ({ connected: true; source: "dashboard"; updatedAt: Date } & StripeMeta)
  | { connected: true; source: "env"; masked: string; livemode: boolean };

export type StripeCredentials = { secretKey: string; webhookSecret: string | null; livemode: boolean };

type Env = { SECRETS_KEY?: string; STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string };

/** Keys for server calls: the dashboard's if set, else the environment's (development). */
export async function stripeCredentials(db: Db, env: Env): Promise<StripeCredentials | null> {
  const [row] = await db.select().from(serviceCredentials).where(eq(serviceCredentials.service, "stripe"));
  if (row) {
    const secretKey = decryptSecret(row.secretEnc, env.SECRETS_KEY);
    return {
      secretKey,
      webhookSecret: row.extraEnc ? decryptSecret(row.extraEnc, env.SECRETS_KEY) : null,
      livemode: secretKey.includes("_live_"),
    };
  }
  if (env.STRIPE_SECRET_KEY) {
    return {
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
      livemode: env.STRIPE_SECRET_KEY.includes("_live_"),
    };
  }
  return null;
}

export async function stripeStatus(db: Db, env: Env): Promise<StripeStatus> {
  const [row] = await db.select().from(serviceCredentials).where(eq(serviceCredentials.service, "stripe"));
  if (row) return { connected: true, source: "dashboard", updatedAt: row.updatedAt, ...(row.meta as StripeMeta) };
  if (env.STRIPE_SECRET_KEY) {
    return {
      connected: true,
      source: "env",
      masked: maskKey(env.STRIPE_SECRET_KEY),
      livemode: env.STRIPE_SECRET_KEY.includes("_live_"),
    };
  }
  return { connected: false };
}

export type ConnectResult =
  | { ok: true; status: Extract<StripeStatus, { source: "dashboard" }> }
  | {
      ok: false;
      reason: "bad_format" | "publishable_key" | "rejected" | "no_site_url" | "no_secrets_key";
      detail?: string;
    };

/**
 * Checks a pasted key by creating the webhook endpoint with it (a key that can't do
 * that can't run the site either), then replaces any previous connection.
 */
export async function connectStripe(
  db: Db,
  input: { key: string; adminId: string; siteUrl: string | null; env: Env },
  gatewayFor: (key: string) => StripeGateway,
): Promise<ConnectResult> {
  const key = input.key.trim();
  if (/^pk_(test|live)_/.test(key)) return { ok: false, reason: "publishable_key" };
  if (!STRIPE_KEY_PATTERN.test(key)) return { ok: false, reason: "bad_format" };
  if (!input.env.SECRETS_KEY) return { ok: false, reason: "no_secrets_key" };
  if (!input.siteUrl) return { ok: false, reason: "no_site_url" };

  const gateway = gatewayFor(key);
  const webhookUrl = new URL(WEBHOOK_PATH, input.siteUrl).toString();
  let webhook: { id: string; secret: string };
  try {
    webhook = await gateway.createWebhook(webhookUrl, WEBHOOK_EVENTS);
  } catch (e) {
    return { ok: false, reason: "rejected", detail: stripeMessage(e) };
  }
  const meta: StripeMeta = {
    masked: maskKey(key),
    livemode: gateway.livemode,
    accountName: await gateway.accountName(),
    webhookId: webhook.id,
    webhookUrl,
  };

  // Remove the old endpoint so Stripe doesn't keep sending to two of them.
  await removeOldWebhook(db, input.env, gatewayFor);

  const values = {
    service: "stripe" as const,
    secretEnc: encryptSecret(key, input.env.SECRETS_KEY),
    extraEnc: encryptSecret(webhook.secret, input.env.SECRETS_KEY),
    meta,
    updatedBy: input.adminId,
  };
  const [row] = await db
    .insert(serviceCredentials)
    .values(values)
    .onConflictDoUpdate({ target: serviceCredentials.service, set: values })
    .returning({ updatedAt: serviceCredentials.updatedAt });
  return { ok: true, status: { connected: true, source: "dashboard", updatedAt: row.updatedAt, ...meta } };
}

export async function disconnectStripe(db: Db, env: Env, gatewayFor: (key: string) => StripeGateway): Promise<void> {
  await removeOldWebhook(db, env, gatewayFor);
  await db.delete(serviceCredentials).where(eq(serviceCredentials.service, "stripe"));
}

async function removeOldWebhook(db: Db, env: Env, gatewayFor: (key: string) => StripeGateway) {
  const [row] = await db.select().from(serviceCredentials).where(eq(serviceCredentials.service, "stripe"));
  if (!row) return;
  const { webhookId } = row.meta as StripeMeta;
  try {
    await gatewayFor(decryptSecret(row.secretEnc, env.SECRETS_KEY)).deleteWebhook(webhookId);
  } catch {
    // The old key may be revoked already; the owner can delete the endpoint in Stripe.
  }
}

function stripeMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Stripe error messages can quote the key; never pass one back to the page.
  return msg.replace(/\b(sk|rk|pk)_(test|live)_[A-Za-z0-9]+/g, "[key]").slice(0, 300);
}
