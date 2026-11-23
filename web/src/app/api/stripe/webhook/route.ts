// POST /api/stripe/webhook: Stripe's events about Checkout and payments (§5).
// Created automatically when the owner connects Stripe on the Connections page.
import { getDb } from "@/db/client";
import { serverEnv } from "@/lib/env";
import { stripeCredentials } from "@/lib/payments/connection";
import { stripeGateway, verifyStripeEvent } from "@/lib/payments/gateway";
import { handleStripeEvent } from "@/lib/payments/webhook";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const db = getDb();
  const creds = await stripeCredentials(db, serverEnv());
  // Not connected yet: answer 503 so Stripe retries once the key is pasted.
  if (!creds?.webhookSecret) return new Response("Stripe is not connected", { status: 503 });

  // The signature covers the exact bytes Stripe sent, so read the body as text.
  const payload = await request.text();
  let event;
  try {
    event = verifyStripeEvent(payload, signature, creds.webhookSecret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    const outcome = await handleStripeEvent(db, event, stripeGateway(creds.secretKey));
    return Response.json({ received: true, outcome });
  } catch (e) {
    console.error(`Stripe event ${event.id} (${event.type}) failed: ${(e as Error).message}`);
    return new Response("Processing failed", { status: 500 });
  }
}
