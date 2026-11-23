// GET /api/homes/:slug: one published home.
import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { getHome } from "@/lib/public/homes";
import { isSlug, jsonError, SHORT_CACHE } from "@/lib/public/http";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/homes/[slug]">) {
  await connection();
  const { slug } = await ctx.params;
  const home = isSlug(slug) ? await getHome(getDb(), slug) : null;
  if (!home) return jsonError(404, "NOT_FOUND");
  return Response.json({ home }, { headers: SHORT_CACHE });
}
