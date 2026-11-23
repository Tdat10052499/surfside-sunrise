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

Vercel project settings: Root Directory `web`, framework Next.js, default build command. Connect the Supabase integration to the project (it sets `POSTGRES_URL`, which the app uses when `DATABASE_URL` is unset), then open `/api/health` on the deployment.

Vercel runs `npm run vercel-build` (`scripts/vercel-build.ts`). On production deployments, that is every merge to `main`, it runs `npm run db:migrate -- --seed` before `next build`; a failing migration fails the deploy and the previous one keeps serving. Preview deployments never migrate, so a migration in an open pull request never reaches the shared database. The seed contains only confirmed facts and is applied once.

## Public API

Read-only JSON for the public site. It only ever shows published homes, and it never returns guest data or why a night is taken.

| Route                                                         | Returns                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/homes`                                              | Published homes: slug, name, max guests and pets, minimum nights, currency, time zone, cleaning and pet fees (cents). Cached 60 s at the CDN.                                                                                                                     |
| `GET /api/homes/:slug`                                        | One published home, or `404 NOT_FOUND`.                                                                                                                                                                                                                           |
| `GET /api/homes/:slug/calendar?from=&to=`                     | Taken nights merged into ranges `[start, end)`. Defaults to the next 12 months from today in the home's time zone; at most 550 days. Bookings that hold dates, holds still running and owner blocks count; rejected bookings and holds whose time ran out do not. |
| `GET /api/homes/:slug/quote?checkIn=&checkOut=&guests=&pets=` | A server-side quote (`src/lib/pricing/quote.ts`) from the home's rates and active taxes, after checking the nights are free.                                                                                                                                      |

Quote errors: `400` for a malformed request (`INVALID_REQUEST`, `INVALID_DATES`, `PAST_DATES`, `TOO_FAR_AHEAD`, `TOO_LONG`, `MIN_NIGHTS`, `TOO_MANY_GUESTS`, `TOO_MANY_PETS`), `409 DATES_TAKEN` with the taken ranges, `422 RATE_MISSING` while the owner has not set a rate for a night (true for every night until prices are entered). Limits marked ASSUMPTION in `src/lib/public/homes.ts` (stay up to 60 nights, start up to 548 days ahead) wait for the owner. Availability and quotes are `no-store`.

## Admin sign-in

Only accounts in `admin_users` can sign in at `/admin/login`; there is no sign-up. The first account comes from `ADMIN_EMAIL` and `ADMIN_INITIAL_PASSWORD`: `npm run admin:bootstrap` creates it once (production deploys run it after migrating), and does nothing once any admin exists. That password is temporary: until the admin replaces it at `/admin/change-password`, every admin page redirects there.

- Passwords: scrypt hashes, at least 12 characters with letters and numbers (`src/lib/auth/password-rules.ts`).
- Five wrong passwords in a row lock the account for 15 minutes. An unknown email gets the same answer as a wrong password.
- Sessions: a random token in an `httpOnly` cookie (`ssr_admin`), stored as a SHA-256 hash, valid 7 days. Changing the password signs out every other browser.
- `src/proxy.ts` only redirects visitors without a cookie. Each admin page and action checks the session itself with `requireAdmin()` (`src/lib/auth/session.ts`).
- Forgotten password, until email reset exists: set `ADMIN_INITIAL_PASSWORD` to a new temporary value and run `npm run admin:bootstrap -- --reset` against the database.

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
