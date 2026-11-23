// Creates the first admin (or resets its password). Run from scripts/admin-bootstrap.ts
// by plain Node, so it uses postgres.js and relative .ts imports instead of the "@/" alias.
import postgres from "postgres";
import { hashPassword } from "./password.ts";

export type BootstrapResult = "created" | "exists" | "reset";

/**
 * Creates the first admin with a temporary password that must be changed at first
 * sign-in. Does nothing once any admin exists, so redeploying never overwrites a
 * password the owner already chose. With `reset`, sets that email's password back
 * to the temporary one and signs it out everywhere (forgotten password, until
 * email reset exists).
 */
export async function bootstrapAdmin(
  url: string,
  input: { email: string; password: string; reset?: boolean },
): Promise<BootstrapResult> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    if (input.reset) {
      const rows = await sql<{ id: string }[]>`
        update admin_users
           set password_hash = ${passwordHash}, must_change_password = true,
               failed_attempts = 0, locked_until = null
         where email = ${email}
     returning id`;
      if (rows.length === 0) throw new Error("No admin with that email.");
      await sql`delete from admin_sessions where admin_id = ${rows[0].id}`;
      return "reset";
    }
    return await sql.begin(async (tx) => {
      // Serialises two deploys bootstrapping at the same time.
      await tx`lock table admin_users in share row exclusive mode`;
      const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from admin_users`;
      if (count > 0) return "exists" as const;
      await tx`insert into admin_users (email, password_hash, must_change_password) values (${email}, ${passwordHash}, true)`;
      return "created" as const;
    });
  } finally {
    await sql.end();
  }
}
