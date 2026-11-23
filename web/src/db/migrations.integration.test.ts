// The migration runner against a real Postgres: applies every file once, then is a no-op.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, migrationFiles } from "@/db/migrations";
import { testDatabaseUrl } from "@/test/database";

const url = testDatabaseUrl();
const sql = postgres(url, { max: 1, onnotice: () => {} });

beforeAll(async () => {
  await sql.unsafe("drop schema if exists public cascade; create schema public;");
  await sql.unsafe("drop extension if exists btree_gist cascade;");
});
afterAll(() => sql.end());

describe("applyMigrations", () => {
  it("applies every migration and the seed on an empty database", async () => {
    const files = await migrationFiles();
    const r = await applyMigrations(url, { seed: true });
    expect(r.applied).toEqual(files);
    expect(r.seeded).toBe(true);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from properties`;
    expect(n).toBe(1);
  });

  it("does nothing the second time, so the seed is not inserted twice", async () => {
    const r = await applyMigrations(url, { seed: true });
    expect(r.applied).toEqual([]);
    expect(r.seeded).toBe(false);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from properties`;
    expect(n).toBe(1);
  });
});
