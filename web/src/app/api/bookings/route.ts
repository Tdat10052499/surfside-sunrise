// POST /api/bookings: holds the nights and returns the Stripe Checkout URL to send
// the guest to. The price is computed here; the browser never sends one.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { startCheckout } from "@/lib/payments/checkout";
import { currentGateway } from "@/lib/payments/runtime";
import { isSlug, jsonError, NO_STORE } from "@/lib/public/http";

const body = z.object({
  slug: z.string().refine(isSlug),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests: z.number().int().min(1).max(50),
  pets: z.number().int().min(0).max(20).default(0),
  guestName: z.string().trim().min(1).max(120),
  guestEmail: z.string().trim().toLowerCase().email().max(254),
  guestPhone: z.string().trim().min(5).max(40),
  message: z.string().trim().max(2000).optional(),
  acceptPolicies: z.literal(true),
});

const STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  DATES_TAKEN: 409,
  RATE_MISSING: 422,
  RATE_CONFLICT: 422,
  PAYMENTS_OFF: 503,
  PAYMENT_ERROR: 502,
};

export async function POST(req: NextRequest) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, "INVALID_REQUEST", {
      fields: [...new Set(parsed.error.issues.map((i) => i.path.join(".")))],
    });
  }
  const { acceptPolicies: _accepted, ...input } = parsed.data;
  void _accepted;
  const result = await startCheckout(getDb(), input, { gateway: await currentGateway(), origin: req.nextUrl.origin });
  if (!result.ok) {
    const { code, ...extra } = result.error;
    return jsonError(STATUS[code] ?? 400, code, extra);
  }
  return Response.json({ code: result.code, checkoutUrl: result.checkoutUrl }, { status: 201, headers: NO_STORE });
}
