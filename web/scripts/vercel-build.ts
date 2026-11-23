// Vercel runs `npm run vercel-build` instead of `build` when this script exists.
// Production deployments (the main branch) migrate the database first, so a merged
// migration reaches Supabase without anyone opening a SQL console. Preview builds
// never touch the database: unmerged migrations must not reach a shared database.
// A failed migration fails the build, and Vercel keeps serving the previous deployment.
import { execFileSync } from "node:child_process";

const run = (args: string[]) => execFileSync("npm", ["run", ...args], { stdio: "inherit" });

if (process.env.VERCEL_ENV === "production") {
  run(["db:migrate", "--", "--seed"]);
  // Creates the first admin once, from ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD if set.
  run(["admin:bootstrap"]);
} else {
  console.log(`Skipping database migration (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}).`);
}
run(["build"]);
