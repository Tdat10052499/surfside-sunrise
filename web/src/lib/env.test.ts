import { describe, expect, it } from "vitest";
import { EnvError, parseServerEnv } from "./env";

const db = "postgres://user:pw@db.example.com:6543/postgres";

function problems(source: Record<string, string | undefined>): string[] {
  try {
    parseServerEnv(source);
  } catch (e) {
    if (e instanceof EnvError) return e.problems;
    throw e;
  }
  return [];
}

describe("parseServerEnv", () => {
  it("accepts a database URL alone", () => {
    expect(parseServerEnv({ DATABASE_URL: db })).toEqual({ DATABASE_URL: db });
  });

  it("names a missing database URL", () => {
    expect(problems({})).toEqual(["DATABASE_URL is not set"]);
  });

  it("rejects a URL that is not Postgres", () => {
    expect(problems({ DATABASE_URL: "mysql://x" })).toEqual([
      "DATABASE_URL must start with postgres:// or postgresql://",
    ]);
  });

  it("treats empty optional keys as unset", () => {
    expect(parseServerEnv({ DATABASE_URL: db, STRIPE_SECRET_KEY: "", RESEND_API_KEY: " " })).toEqual({
      DATABASE_URL: db,
    });
  });

  it("checks the shape of keys that are set", () => {
    expect(
      problems({
        DATABASE_URL: db,
        STRIPE_SECRET_KEY: "pk_test_123",
        STRIPE_WEBHOOK_SECRET: "abc",
        RESEND_API_KEY: "x",
      }),
    ).toEqual([
      "STRIPE_SECRET_KEY must start with sk_test_ or sk_live_ or rk_test_ or rk_live_",
      "STRIPE_WEBHOOK_SECRET must start with whsec_",
      "RESEND_API_KEY must start with re_",
    ]);
  });

  it("never puts a secret value in the error", () => {
    const secret = "pk_live_do_not_print_me";
    const err = (() => {
      try {
        parseServerEnv({ DATABASE_URL: db, STRIPE_SECRET_KEY: secret });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err?.message).not.toContain(secret);
  });
});
