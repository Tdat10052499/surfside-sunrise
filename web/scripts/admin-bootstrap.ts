// Usage: npm run admin:bootstrap [-- --reset]
// Creates the first admin from ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD. The password is
// temporary: the admin must replace it at first sign-in. Once any admin exists this does
// nothing, so it is safe on every production deploy (scripts/vercel-build.ts).
// --reset sets ADMIN_EMAIL's password back to ADMIN_INITIAL_PASSWORD (forgotten password).
// Never prints the password.
import { PASSWORD_MIN_LENGTH } from "../src/lib/auth/password-rules.ts";
import { bootstrapAdmin } from "../src/lib/auth/bootstrap.ts";

const email = process.env.ADMIN_EMAIL?.trim();
const password = process.env.ADMIN_INITIAL_PASSWORD ?? "";
const url = process.env.MIGRATION_DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
const reset = process.argv.includes("--reset");

if (!email || !password) {
  console.log("Skipping admin bootstrap: ADMIN_EMAIL or ADMIN_INITIAL_PASSWORD is not set.");
  process.exit(reset ? 1 : 0);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("ADMIN_EMAIL is not an email address.");
  process.exit(1);
}
if (password.length < PASSWORD_MIN_LENGTH) {
  console.error(`ADMIN_INITIAL_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  process.exit(1);
}
if (!url) {
  console.error("Set MIGRATION_DATABASE_URL or DATABASE_URL first (see web/.env.example).");
  process.exit(1);
}

try {
  const result = await bootstrapAdmin(url, { email, password, reset });
  console.log(
    {
      created: "Admin created. It must change the temporary password at first sign-in.",
      exists: "An admin already exists; nothing changed.",
      reset: "Admin password reset to the temporary one; all its sessions were signed out.",
    }[result],
  );
} catch (e) {
  console.error(`Admin bootstrap failed: ${(e as Error).message}`);
  process.exit(1);
}
