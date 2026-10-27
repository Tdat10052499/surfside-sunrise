# Seathesunrise web app

Next.js app for the Seathesunrise booking site: public pages, booking API, Stripe webhook and the owner dashboard. The static site in the repository root keeps running on GitHub Pages until the new app goes live.

Architecture and the reasons behind it: [proposal doc](https://claude.ai/artifact/WqWmHTUecE4hzkWpQZ656d) (Vercel + Supabase + Stripe Checkout + Resend).

## Layout

```
supabase/migrations/   SQL schema, the source of truth (constraints, triggers)
supabase/seed.sql      development data (only confirmed facts; unknowns are TODO)
src/db/                Drizzle schema mirror and database client (server only)
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
