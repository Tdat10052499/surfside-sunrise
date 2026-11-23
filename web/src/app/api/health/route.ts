import { connection } from "next/server";
import { getDb } from "@/db/client";
import { serverEnv } from "@/lib/env";
import { checkHealth } from "@/lib/health";

export async function GET() {
  await connection(); // always answer from a live check, never a prerendered copy
  const health = await checkHealth({
    config: serverEnv,
    db: getDb,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
  });
  return Response.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
