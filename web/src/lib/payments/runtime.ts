// Wiring for request handlers: the live database, the stored keys, the real Stripe client.
import { getDb } from "@/db/client";
import { serverEnv } from "@/lib/env";
import { stripeCredentials } from "./connection";
import { stripeGateway, type StripeGateway } from "./gateway";

export async function currentGateway(): Promise<StripeGateway | null> {
  const creds = await stripeCredentials(getDb(), serverEnv());
  return creds ? stripeGateway(creds.secretKey) : null;
}

/** The live site's address, where Stripe sends webhooks. Null in local development. */
export function siteUrl(): string | null {
  const { SITE_URL } = serverEnv();
  if (SITE_URL) return SITE_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : null;
}
