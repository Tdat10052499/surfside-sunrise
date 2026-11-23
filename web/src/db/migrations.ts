// Applies the SQL files in supabase/migrations to a database, in name order, once each.
// Applied files are recorded in public.schema_migrations, so re-running is safe.
// Used by `npm run db:migrate` and by the integration tests.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../supabase/migrations");
export const SEED_FILE = path.resolve(import.meta.dirname, "../../supabase/seed.sql");
const SEED_VERSION = "seed";

export type MigrateResult = { applied: string[]; skipped: string[]; seeded: boolean };

export async function migrationFiles(dir = MIGRATIONS_DIR): Promise<string[]> {
  return (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
}

/**
 * Brings the database up to date. Each file runs in its own transaction together with
 * its bookkeeping row, so a failing file leaves nothing half-applied.
 * With `seed`, supabase/seed.sql is applied once, after the migrations.
 */
export async function applyMigrations(
  url: string,
  opts: { seed?: boolean; dir?: string; seedFile?: string; log?: (line: string) => void } = {},
): Promise<MigrateResult> {
  const dir = opts.dir ?? MIGRATIONS_DIR;
  const log = opts.log ?? (() => {});
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const result: MigrateResult = { applied: [], skipped: [], seeded: false };
  try {
    await sql`
      create table if not exists public.schema_migrations (
        version    text primary key,
        applied_at timestamptz not null default now()
      )`;
    // Supabase exposes the public schema over its REST API; with RLS on and no policy,
    // only the server's own connection can read this table.
    await sql`alter table public.schema_migrations enable row level security`;
    const done = new Set(
      (await sql<{ version: string }[]>`select version from public.schema_migrations`).map((r) => r.version),
    );

    for (const file of await migrationFiles(dir)) {
      if (done.has(file)) {
        result.skipped.push(file);
        continue;
      }
      const body = await readFile(path.join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into public.schema_migrations (version) values (${file})`;
      });
      result.applied.push(file);
      log(`applied ${file}`);
    }

    if (opts.seed && !done.has(SEED_VERSION)) {
      const body = await readFile(opts.seedFile ?? SEED_FILE, "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into public.schema_migrations (version) values (${SEED_VERSION})`;
      });
      result.seeded = true;
      log("applied seed.sql");
    }
  } finally {
    await sql.end();
  }
  return result;
}
