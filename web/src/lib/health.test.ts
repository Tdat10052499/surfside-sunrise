import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { checkHealth } from "./health";

const now = new Date("2026-11-22T12:00:00Z");
const fakeDb = (execute: () => Promise<unknown>) => () => ({ execute }) as unknown as Db;

describe("checkHealth", () => {
  it("is ok when config and database answer", async () => {
    const h = await checkHealth({
      config: () => ({}),
      db: fakeDb(async () => [{ "?column?": 1 }]),
      version: "abc1234",
      now,
    });
    expect(h).toEqual({
      status: "ok",
      checks: { config: "ok", database: "ok" },
      version: "abc1234",
      time: "2026-11-22T12:00:00.000Z",
    });
  });

  it("skips the database when config is invalid", async () => {
    let called = false;
    const h = await checkHealth({
      config: () => {
        throw new Error("DATABASE_URL is not set");
      },
      db: fakeDb(async () => {
        called = true;
      }),
      now,
    });
    expect(h.status).toBe("degraded");
    expect(h.checks).toEqual({ config: "error", database: "skipped" });
    expect(called).toBe(false);
    expect(JSON.stringify(h)).not.toContain("DATABASE_URL");
  });

  it("reports a database error without its message", async () => {
    const h = await checkHealth({
      config: () => ({}),
      db: fakeDb(async () => {
        throw new Error("password authentication failed for user secret_user");
      }),
      now,
    });
    expect(h.checks.database).toBe("error");
    expect(JSON.stringify(h)).not.toContain("secret_user");
  });
});
