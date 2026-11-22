# Seathesunrise web app

Next.js app for the Seathesunrise booking site: public pages, booking API, Stripe webhook and the owner dashboard. The static site in the repository root keeps running on GitHub Pages until the new app goes live.

Architecture and the reasons behind it: [proposal doc](https://claude.ai/artifact/WqWmHTUecE4hzkWpQZ656d) (Vercel + Supabase + Stripe Checkout + Resend).

## Layout

```
supabase/migrations/   SQL schema, the source of truth (constraints, triggers)
supabase/seed.sql      development data (only confirmed facts; unknowns are TODO)
src/db/                Drizzle schema mirror, database client and migration runner (server only)
src/lib/env.ts         server configuration, checked when the server starts
src/app/api/health/    health check for uptime monitors
src/lib/dates.ts       stay dates, half-open [check-in, check-out)
src/lib/money.ts       integer cents helpers
src/lib/pricing/       server-side quote: nightly rates, fees, taxes
src/lib/booking/       booking codes and the hold that reserves nights
```

## Rules the code relies on

- **No double bookings:** every taken night lives in `occupancy`, guarded by a Postgres exclusion constraint. Triggers keep it in step with `bookings` and `calendar_blocks`; never write to it directly.
- **Prices are computed on the server** by `quoteStay()`. Never trust an amount from the browser.
- **Money is integer cents.**
- **Payments are recorded only from signed Stripe webhooks** (added in the payment step).
- **Card details never touch this app** (Stripe Checkout redirect).

## Develop

Requires Node 22+.

```bash
cp .env.example .env.local
npm install
npm run dev
```

For a local Supabase stack (Postgres, Auth, Storage in Docker) use the [Supabase CLI](https://supabase.com/docs/guides/local-development): `supabase start` applies `supabase/migrations` and `supabase/seed.sql`.

## Database migrations

`npm run db:migrate` applies the files in `supabase/migrations` in name order, each once, and records them in `public.schema_migrations`. Add `-- --seed` to load `supabase/seed.sql` (once). It reads the first of `MIGRATION_DATABASE_URL`, `POSTGRES_URL_NON_POOLING` and `DATABASE_URL` that is set. On Supabase use the session pooler or direct connection for migrations; the app itself uses the transaction pooler.

## Configuration and health

The server checks its environment when it starts (`src/instrumentation.ts`). A missing or malformed variable stops it with the variable's name; values are never printed. `GET /api/health` returns `200` with `{"status":"ok"}` when the configuration is valid and the database answers within 3 seconds, otherwise `503` with which check failed. It never returns error details.

## Deploy (preview)

Vercel project settings: Root Directory `web`, framework Next.js, default build command. Connect the Supabase integration to the project (it sets `POSTGRES_URL`, which the app uses when `DATABASE_URL` is unset), run `npm run db:migrate -- --seed` against the database once, then open `/api/health` on the deployment.

## Test

```bash
npm test                  # unit: pricing, dates, money
npm run test:integration  # real Postgres: double-booking guarantees
```

Integration tests **wipe** the database in `TEST_DATABASE_URL` and refuse any host other than localhost. Any Postgres 16+ with the `btree_gist` extension (part of `postgresql-contrib`) works:

```bash
createdb ssr_test
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ssr_test npm run test:integration
```

CI (`.github/workflows/web.yml`) runs formatting, lint, typecheck, both test suites and a production build on every pull request.

## Open items (owner to confirm)

Nightly/weekend/seasonal rates, taxes, deposit, minimum nights, pet limit, hold length (assumed 30 minutes), which nights count as weekend (assumed Friday and Saturday), cancellation and refund policy.
