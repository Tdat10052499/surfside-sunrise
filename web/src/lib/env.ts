// Server-side configuration. Every secret the app reads is declared and checked here,
// so a missing or mistyped value fails at startup with its name instead of mid-request.
import { z } from "zod";

const postgresUrl = z
  .string()
  .trim()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), "must start with postgres:// or postgresql://");

/** An empty string in a .env file means "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

const prefixed = (...prefixes: string[]) =>
  z
    .string()
    .trim()
    .refine((v) => prefixes.some((p) => v.startsWith(p)), `must start with ${prefixes.join(" or ")}`);

export const serverEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
  // Added by later build steps; checked for shape as soon as they are set.
  STRIPE_SECRET_KEY: optional(prefixed("sk_test_", "sk_live_", "rk_test_", "rk_live_")),
  STRIPE_WEBHOOK_SECRET: optional(prefixed("whsec_")),
  RESEND_API_KEY: optional(prefixed("re_")),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid server configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvError";
  }
}

/**
 * Parses a set of variables. Error messages name the variable but never echo its value.
 * DATABASE_URL falls back to POSTGRES_URL, the pooled connection string that the
 * Supabase integration on Vercel sets, so no secret has to be copied by hand.
 */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const blank = (v: string | undefined) => v === undefined || v.trim() === "";
  const input = blank(source.DATABASE_URL) ? { ...source, DATABASE_URL: source.POSTGRES_URL } : source;
  const result = serverEnvSchema.safeParse(input);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join(".");
    return issue.code === "invalid_type" && blank(input[name]) ? `${name} is not set` : `${name} ${issue.message}`;
  });
  throw new EnvError(problems);
}

let cached: ServerEnv | undefined;

/** The validated environment of this server process. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
