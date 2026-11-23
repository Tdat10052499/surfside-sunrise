// Health check used by /api/health and uptime monitors. It reports whether the
// configuration is valid and the database answers, never the values themselves.
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

export type Health = {
  status: "ok" | "degraded";
  checks: { config: "ok" | "error"; database: "ok" | "error" | "skipped" };
  version: string;
  time: string;
};

const DB_TIMEOUT_MS = 3_000;

export async function checkHealth(deps: {
  config: () => unknown;
  db: () => Db;
  version?: string;
  now?: Date;
}): Promise<Health> {
  const checks: Health["checks"] = { config: "ok", database: "skipped" };
  try {
    deps.config();
  } catch {
    checks.config = "error";
  }
  if (checks.config === "ok") {
    checks.database = (await pingDatabase(deps.db)) ? "ok" : "error";
  }
  return {
    status: checks.config === "ok" && checks.database === "ok" ? "ok" : "degraded",
    checks,
    version: deps.version ?? "dev",
    time: (deps.now ?? new Date()).toISOString(),
  };
}

async function pingDatabase(db: () => Db): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), DB_TIMEOUT_MS);
  });
  const ping = (async () => {
    await db().execute(sql`select 1`);
    return true;
  })().catch(() => false);
  try {
    return await Promise.race([ping, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
