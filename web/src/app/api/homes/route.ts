// GET /api/homes: published homes, with the facts the booking widget needs.
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { listHomes } from "@/lib/public/homes";
import { SHORT_CACHE } from "@/lib/public/http";

export async function GET() {
  await connection();
  return Response.json({ homes: await listHomes(getDb()) }, { headers: SHORT_CACHE });
}
