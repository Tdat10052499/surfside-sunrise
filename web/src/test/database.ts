// Integration-test helpers. They wipe the database they point at, so they only
// accept TEST_DATABASE_URL and refuse anything that looks like a hosted database.

import postgres from "postgres";
import { applyMigrations } from "@/db/migrations";

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Integration tests need a disposable Postgres (see web/README.md).");
  }
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "postgres"].includes(host)) {
    throw new Error(`Refusing to reset a non-local database (${host}).`);
  }
  return url;
}

/** Drops everything in the public schema and re-applies every migration in order. */
export async function resetDatabase(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("drop schema if exists public cascade; create schema public;");
    await sql.unsafe("drop extension if exists btree_gist cascade;");
  } finally {
    await sql.end();
  }
  await applyMigrations(url);
}
