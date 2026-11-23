// GET /api/cron/daily: run by Vercel Cron once a day (vercel.json; the free plan
// allows daily jobs only). Expires requests the host didn't answer in time and holds
// whose payment page closed. Vercel signs the call with CRON_SECRET; without that
// secret set, the job refuses to run (the bookings page does the same work on open).
import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { expireOverdueApprovals } from "@/lib/booking/host";
import { serverEnv } from "@/lib/env";
import { currentGateway } from "@/lib/payments/runtime";

export async function GET(request: Request) {
  await connection(); // never prerendered at build time
  const secret = serverEnv().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const db = getDb();
  const [holds] = await db.execute<{ released: number }>(sql`select release_expired_holds() as released`);
  const approvals = await expireOverdueApprovals(db, await currentGateway());
  if (approvals.failed) console.error(`Daily job: ${approvals.failed} overdue request(s) could not be released`);
  return Response.json({ holdsReleased: holds.released, ...approvals });
}
