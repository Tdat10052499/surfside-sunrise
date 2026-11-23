// The few Stripe calls the site makes, behind a small interface so tests can use a
// fake and the rest of the code never sees the SDK.
import Stripe from "stripe";

export type CheckoutLine = { name: string; amountCents: number };

export type CheckoutRequest = {
  bookingId: string;
  bookingCode: string;
  currency: string;
  lines: CheckoutLine[];
  customerEmail: string;
  description: string;
  /** Stripe allows 30 minutes to 24 hours from now. */
  expiresAt: Date;
  successUrl: string;
  cancelUrl: string;
};

export interface StripeGateway {
  readonly livemode: boolean;
  /** The account's display name, or null if the key may not read it. */
  accountName(): Promise<string | null>;
  createWebhook(url: string, events: readonly string[]): Promise<{ id: string; secret: string }>;
  deleteWebhook(id: string): Promise<void>;
  createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }>;
  expireCheckout(id: string): Promise<void>;
  /** Releases a card authorisation that will not be captured. */
  cancelPaymentIntent(id: string): Promise<void>;
}

/** Events the webhook handler (src/lib/payments/webhook.ts) acts on. */
export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "payment_intent.amount_capturable_updated",
  "payment_intent.succeeded",
  "payment_intent.canceled",
  "payment_intent.payment_failed",
  "charge.refunded",
] as const;

export const STRIPE_KEY_PATTERN = /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/;

export function stripeGateway(key: string): StripeGateway {
  const stripe = new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000 });
  return {
    livemode: key.includes("_live_"),
    async accountName() {
      try {
        const a = await stripe.accounts.retrieveCurrent();
        return a.settings?.dashboard?.display_name ?? a.business_profile?.name ?? a.email ?? null;
      } catch {
        return null; // a restricted key without Account read access
      }
    },
    async createWebhook(url, events) {
      const w = await stripe.webhookEndpoints.create({
        url,
        enabled_events: [...events] as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
        description: "Seathesunrise bookings (created from the dashboard)",
      });
      if (!w.secret) throw new Error("Stripe did not return a signing secret.");
      return { id: w.id, secret: w.secret };
    },
    async deleteWebhook(id) {
      await stripe.webhookEndpoints.del(id);
    },
    async createCheckout(req) {
      const s = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: req.lines.map((l) => ({
          quantity: 1,
          price_data: {
            currency: req.currency.toLowerCase(),
            unit_amount: l.amountCents,
            product_data: { name: l.name },
          },
        })),
        customer_email: req.customerEmail,
        client_reference_id: req.bookingId,
        metadata: { booking_id: req.bookingId, booking_code: req.bookingCode },
        // Authorise only: the card is charged when the host approves (step 6).
        payment_intent_data: {
          capture_method: "manual",
          description: req.description,
          metadata: { booking_id: req.bookingId, booking_code: req.bookingCode },
        },
        expires_at: Math.floor(req.expiresAt.getTime() / 1000),
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
      });
      if (!s.url) throw new Error("Stripe did not return a Checkout URL.");
      return { id: s.id, url: s.url };
    },
    async expireCheckout(id) {
      await stripe.checkout.sessions.expire(id);
    },
    async cancelPaymentIntent(id) {
      const pi = await stripe.paymentIntents.retrieve(id);
      if (pi.status === "canceled") return; // already released
      await stripe.paymentIntents.cancel(id);
    },
  };
}

/**
 * Checks Stripe's signature on a webhook body and parses it. Throws if the body was
 * not signed with this secret or is older than five minutes (replayed).
 */
export function verifyStripeEvent(payload: string, signature: string, secret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(payload, signature, secret);
}
