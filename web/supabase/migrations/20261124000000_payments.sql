-- Step 4: Stripe Checkout and the "Connections" page.

-- Keys the owner pastes in the dashboard (Connections). Secrets are AES-256-GCM
-- encrypted by the server (src/lib/secrets.ts) before they reach this table;
-- meta holds only what the page may show: last 4 characters, test/live, account name.
create table service_credentials (
  service     text primary key check (service in ('stripe', 'resend')),
  secret_enc  text not null,
  -- a second secret the service hands back, e.g. Stripe's webhook signing secret
  extra_enc   text,
  meta        jsonb not null default '{}'::jsonb,
  updated_by  uuid references admin_users (id) on delete set null,
  updated_at  timestamptz not null default now()
);
create trigger service_credentials_updated_at before update on service_credentials
  for each row execute function set_updated_at();
alter table service_credentials enable row level security;

-- The Checkout Session a web booking pays through, and the PaymentIntent behind it
-- (filled in by the webhook in step 5).
alter table bookings
  add column stripe_checkout_session_id text unique,
  add column stripe_payment_intent_id   text unique;
