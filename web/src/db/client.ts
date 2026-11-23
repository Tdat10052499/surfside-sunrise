import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  // prepare:false keeps us compatible with Supabase's transaction pooler.
  const client = postgres(url, { prepare: false, max: 5 });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

let shared: Db | undefined;

/** Server-only database handle. Never import this from a client component. */
export function getDb(): Db {
  if (!shared) {
    shared = createDb(serverEnv().DATABASE_URL).db;
  }
  return shared;
}
