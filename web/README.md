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

## Booking and payment (steps 4–6)

- `POST /api/bookings` with `{slug, checkIn, checkOut, guests, pets, guestName, guestEmail, guestPhone, message?, acceptPolicies: true}` quotes again on the server, holds the nights (`createHold`) and returns `{code, checkoutUrl}` for Stripe Checkout. The Checkout Session only authorises the card (`capture_method: manual`); the host's approval captures it (step 6). Checkout closes after 31 minutes (Stripe's minimum is 30) and the nights stay held for 35, so a last-second payment still finds them. Errors: the quote errors above, `503 PAYMENTS_OFF` when Stripe isn't connected, `502 PAYMENT_ERROR` when Stripe fails (the hold is released).
- Stripe returns the guest to `/book/done?session_id=…` or `/book/cancelled?session_id=…`. Cancelling frees the nights at once and expires the Checkout Session.
- `POST /api/bookings/lookup` with `{code, email}` returns the guest's own booking, without contact details. A wrong email and an unknown code get the same `404`.

### Connections (`/admin/connections`)

The owner connects Stripe by pasting one restricted key; nothing goes into Vercel by hand. The server checks the key by creating the webhook endpoint (`/api/stripe/webhook`, at `SITE_URL` or Vercel's production domain) with the events in `WEBHOOK_EVENTS`, then stores the key and the returned signing secret AES-256-GCM-encrypted with `SECRETS_KEY` (`src/lib/secrets.ts`) in `service_credentials`. Only the last 4 characters are shown again. Connecting a new key deletes the old endpoint. When nothing is stored, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` from the environment are used (development).

### Stripe webhook (step 5)

`POST /api/stripe/webhook` checks Stripe's signature on the raw body with the stored signing secret (`400` if it doesn't match or is older than 5 minutes; `503` until Stripe is connected, so Stripe retries). Each event id goes into `stripe_events` in the same transaction as its effect (`src/lib/payments/webhook.ts`), so a repeated event does nothing and a failed one is retried by Stripe after a `500`.

| Event                                      | Effect                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout.session.completed`               | Stores the PaymentIntent id on the booking.                                                                                                                                                                                                                                                                                           |
| `payment_intent.amount_capturable_updated` | `HOLD` (or a hold that ran out seconds earlier) becomes `AWAITING_APPROVAL`, only if the authorised amount and currency equal the stored quote. Otherwise, or if the nights went to someone else meanwhile, the authorisation is cancelled and the booking becomes `EXPIRED` with `status_reason` `AMOUNT_MISMATCH` or `DATES_TAKEN`. |
| `checkout.session.expired`                 | An unpaid `HOLD` becomes `EXPIRED` (`CHECKOUT_EXPIRED`), freeing the nights.                                                                                                                                                                                                                                                          |
| `payment_intent.succeeded`                 | `AWAITING_APPROVAL` becomes `CONFIRMED` when the captured amount equals the quote (a safety net: approving already sets it).                                                                                                                                                                                                          |
| `payment_intent.canceled`                  | `HOLD`/`AWAITING_APPROVAL` becomes `EXPIRED` (`PAYMENT_CANCELED`), e.g. an authorisation that ran out after 7 days.                                                                                                                                                                                                                   |
| `charge.refunded`                          | Keeps `refunded_cents` equal to Stripe's total (refunds made in the dashboard or straight in Stripe); a full refund of a `CONFIRMED` or `CANCELLED` booking makes it `REFUNDED`.                                                                                                                                                      |
| `payment_intent.payment_failed`            | Ignored: the guest can retry on the same Checkout page.                                                                                                                                                                                                                                                                               |

`/book/done` shows what the booking's status says: "confirming" (refreshing every 3 s while `HOLD`), "with the host", "confirmed", or "didn't go through".

To try it locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook` and put the printed `whsec_…` in `STRIPE_WEBHOOK_SECRET` with a test `STRIPE_SECRET_KEY`.

### Host decisions (step 6)

`/admin` shows how many requests need a decision, check-ins in the next 14 days and homes. `/admin/bookings` lists bookings (tabs: needs your decision, upcoming, all); `/admin/bookings/<code>` shows one booking with the guest's contact, the quote lines and the buttons below. Each button asks once more in plain words before it runs (`src/lib/booking/host.ts`, server actions in `src/app/admin/bookings/actions.ts`).

| Action         | From                             | Effect                                                                                                                                                                                                  |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approve        | `AWAITING_APPROVAL`              | `CONFIRMED`, then captures the authorised card.                                                                                                                                                         |
| Decline        | `AWAITING_APPROVAL`              | `REJECTED` (`HOST_DECLINED`), then cancels the authorisation; the guest pays nothing and the nights are free.                                                                                           |
| Cancel booking | `CONFIRMED`                      | `CANCELLED` (`HOST_CANCELLED`), with a refund from $0 up to what is left; refunding everything makes it `REFUNDED`. A booking entered by hand (Airbnb, phone) has no card here, so only $0 is accepted. |
| Change dates   | `AWAITING_APPROVAL`, `CONFIRMED` | Moves the stay; the occupancy constraint refuses nights held by anyone else.                                                                                                                            |

- Each action locks the booking row, writes the new status and calls Stripe last in the same transaction. If Stripe refuses, nothing changes and the page shows Stripe's message (keys scrubbed). A webhook arriving meanwhile waits for the lock and then sees the new status. Refunds carry an idempotency key, so a double click refunds once.
- **Approval deadline:** a request not answered within `approvalHours` of the card being authorised (stored in `site_settings` key `booking_policy`; ASSUMPTION 48 hours until the owner decides, capped at 144 because Stripe keeps an authorisation for about 7 days) becomes `EXPIRED` (`APPROVAL_TIMEOUT`) and the card is released. This runs whenever the bookings list opens and once a day from Vercel Cron (`vercel.json`, `GET /api/cron/daily`, 12:00 UTC), which also releases stale holds.
- `CRON_SECRET` (16+ characters, optional): Vercel sends it as a Bearer token to the cron route, which refuses other callers. Without it the route answers `503` and the bookings page still expires overdue requests.
- **Change dates** does not reprice or charge again (ASSUMPTION until the owner sets a rule): the host settles any difference with the guest and can write it in the note, which only the host sees.
- Times show in `America/Chicago` (the house's time zone, `src/app/admin/bookings/labels.ts`).

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

Nightly/weekend/seasonal rates, taxes, deposit, minimum nights, pet limit, hold length (assumed 35 minutes), how long the host has to answer a request (assumed 48 hours), whether changing dates reprices the stay (assumed not), which nights count as weekend (assumed Friday and Saturday), cancellation and refund policy.
