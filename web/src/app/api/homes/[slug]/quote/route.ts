// GET /api/homes/:slug/quote?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&guests=2&pets=0
// A price computed on the server from the owner's rates, and whether the nights are free.
import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { quoteHome } from "@/lib/public/homes";
import { isSlug, jsonError, NO_STORE } from "@/lib/public/http";

const query = z.object({
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests: z.coerce.number().int().min(1).max(50),
  pets: z.coerce.number().int().min(0).max(20).default(0),
});

// Errors about the request itself are 400; a valid request that can't be booked is 409/422.
const STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  DATES_TAKEN: 409,
  RATE_MISSING: 422,
  RATE_CONFLICT: 422,
};

export async function GET(req: NextRequest, ctx: RouteContext<"/api/homes/[slug]/quote">) {
  await connection();
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return jsonError(404, "NOT_FOUND");
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return jsonError(400, "INVALID_REQUEST", {
      fields: [...new Set(parsed.error.issues.map((i) => i.path.join(".")))],
    });
  }
  const result = await quoteHome(getDb(), slug, parsed.data);
  if (!result.ok) {
    const { code, ...extra } = result.error;
    return jsonError(STATUS[code] ?? 400, code, extra);
  }
  return Response.json({ currency: result.currency, quote: result.quote }, { headers: NO_STORE });
}
