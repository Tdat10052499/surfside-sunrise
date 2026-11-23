// POST /api/bookings/lookup {code, email}: a guest's own booking. POST keeps the email
// out of URLs and logs. Unknown code and wrong email get the same answer.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { lookupBooking } from "@/lib/payments/checkout";
import { jsonError, NO_STORE } from "@/lib/public/http";

const body = z.object({
  code: z.string().trim().max(20),
  email: z.string().trim().max(254),
});

export async function POST(req: NextRequest) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "INVALID_REQUEST");
  const booking = await lookupBooking(getDb(), parsed.data.code, parsed.data.email);
  if (!booking) return jsonError(404, "NOT_FOUND");
  return Response.json({ booking }, { headers: NO_STORE });
}
