// Usage: npm run db:migrate [-- --seed]
// Reads MIGRATION_DATABASE_URL, or DATABASE_URL when that is not set.
// On Supabase use the direct or session-pooler connection string, not the transaction pooler.
import { applyMigrations } from "../src/db/migrations.ts";

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Set MIGRATION_DATABASE_URL or DATABASE_URL first (see web/.env.example).");
  process.exit(1);
}

const seed = process.argv.includes("--seed");
const host = new URL(url).hostname;
console.log(`Migrating database on ${host}${seed ? " (with seed data)" : ""}`);

try {
  const r = await applyMigrations(url, { seed, log: (line) => console.log(`  ${line}`) });
  console.log(
    `Done: ${r.applied.length} applied, ${r.skipped.length} already applied${seed ? `, seed ${r.seeded ? "applied" : "already applied"}` : ""}.`,
  );
} catch (e) {
  console.error(`Migration failed: ${(e as Error).message}`);
  process.exit(1);
}
