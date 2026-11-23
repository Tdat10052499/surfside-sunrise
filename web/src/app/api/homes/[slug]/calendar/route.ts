// GET /api/homes/:slug/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
// Taken nights as merged ranges [start, end). It never says who or what took them.
import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { homeCalendar, MAX_CALENDAR_DAYS } from "@/lib/public/homes";
import { isSlug, jsonError, NO_STORE } from "@/lib/public/http";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/homes/[slug]/calendar">) {
  await connection();
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return jsonError(404, "NOT_FOUND");
  const q = req.nextUrl.searchParams;
  const result = await homeCalendar(getDb(), slug, {
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
  });
  if (!result.ok) {
    return result.error === "NOT_FOUND"
      ? jsonError(404, "NOT_FOUND")
      : jsonError(400, "INVALID_RANGE", { maxDays: MAX_CALENDAR_DAYS });
  }
  return Response.json({ from: result.from, to: result.to, taken: result.taken }, { headers: NO_STORE });
}
