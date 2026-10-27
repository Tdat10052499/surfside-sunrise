-- Seathesunrise: initial schema.
-- Covers the booking core: homes, rates, fees, taxes, bookings, calendar blocks,
-- the occupancy ledger that prevents double bookings (§4), Stripe event log (§5),
-- email outbox (§6) and site settings (§2).
--
-- Money is stored as integer cents. Dates are property-local calendar dates;
-- a stay is the half-open range [check_in, check_out).

create extension if not exists btree_gist;

create type property_status as enum ('DRAFT', 'PUBLISHED', 'HIDDEN');
create type rate_kind as enum ('BASE', 'WEEKEND', 'SEASON', 'DATE');
create type booking_source as enum ('WEB', 'AIRBNB', 'MANUAL');
create type booking_status as enum (
  'HOLD',               -- dates held while the guest pays
  'AWAITING_APPROVAL',  -- card authorised, waiting for the owner
  'CONFIRMED',          -- owner approved and payment captured
  'EXPIRED',            -- hold or authorisation ran out
  'REJECTED',           -- owner declined, authorisation released
  'CANCELLED',
  'REFUNDED'
);
create type email_status as enum ('QUEUED', 'SENT', 'FAILED', 'BOUNCED');

create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Homes ---------------------------------------------------------------------

create table properties (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name               text not null,
  status             property_status not null default 'DRAFT',
  max_guests         integer not null check (max_guests > 0),
  -- null = the owner has not set a limit yet (TODO: owner to confirm)
  max_pets           integer check (max_pets >= 0),
  min_nights         integer not null default 1 check (min_nights >= 1),
  cleaning_fee_cents integer not null default 0 check (cleaning_fee_cents >= 0),
  pet_fee_cents      integer not null default 0 check (pet_fee_cents >= 0),
  currency           char(3) not null default 'USD',
  timezone           text not null default 'America/Chicago',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger properties_updated_at before update on properties
  for each row execute function set_updated_at();

-- Nightly rates. Priority when pricing a night: DATE > SEASON > WEEKEND > BASE.
create table rate_rules (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties (id) on delete cascade,
  kind         rate_kind not null,
  nightly_cents integer not null check (nightly_cents >= 0),
  during       daterange,
  label        text,
  created_at   timestamptz not null default now(),
  constraint rate_rules_range_by_kind check (
    (kind in ('BASE', 'WEEKEND') and during is null)
    or (kind in ('SEASON', 'DATE') and during is not null and not isempty(during))
  ),
  constraint rate_rules_date_is_one_night check (
    kind <> 'DATE' or upper(during) = lower(during) + 1
  ),
  -- two seasons (or two date overrides) may not cover the same night
  constraint rate_rules_no_overlap exclude using gist (
    property_id with =, kind with =, during with &&
  ) where (during is not null)
);
create unique index rate_rules_one_base on rate_rules (property_id) where kind = 'BASE';
create unique index rate_rules_one_weekend on rate_rules (property_id) where kind = 'WEEKEND';

-- Taxes are configured per home; rates are TODO until the owner confirms them.
create table tax_rates (
  id                  uuid primary key default gen_random_uuid(),
  property_id         uuid not null references properties (id) on delete cascade,
  name                text not null,
  rate_basis_points   integer not null check (rate_basis_points between 0 and 10000),
  applies_to_nightly  boolean not null default true,
  applies_to_cleaning boolean not null default false,
  applies_to_pet      boolean not null default false,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Bookings and the calendar ------------------------------------------------

create table bookings (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  property_id      uuid not null references properties (id),
  source           booking_source not null default 'WEB',
  status           booking_status not null,
  check_in         date not null,
  check_out        date not null,
  guests           integer not null check (guests > 0),
  pets             integer not null default 0 check (pets >= 0),
  guest_name       text,
  guest_email      text,
  guest_phone      text,
  message          text,
  -- server-computed quote at booking time (line items in cents)
  quote            jsonb,
  total_cents      integer check (total_cents >= 0),
  policy_version   text,
  hold_expires_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint bookings_dates check (check_out > check_in),
  constraint bookings_hold_has_expiry check (status <> 'HOLD' or hold_expires_at is not null)
);
create index bookings_property_dates on bookings (property_id, check_in);
create index bookings_holds on bookings (hold_expires_at) where status = 'HOLD';
create trigger bookings_updated_at before update on bookings
  for each row execute function set_updated_at();

-- Nights the owner closes by hand (§7).
create table calendar_blocks (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties (id) on delete cascade,
  during      daterange not null check (not isempty(during)),
  reason      text,
  created_at  timestamptz not null default now()
);

-- Every night that is taken, whatever took it. The exclusion constraint is the
-- single guard against double bookings (§4). Rows are kept in sync by triggers,
-- so application code cannot forget to write them.
create table occupancy (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties (id) on delete cascade,
  during      daterange not null check (not isempty(during)),
  booking_id  uuid unique references bookings (id) on delete cascade,
  block_id    uuid unique references calendar_blocks (id) on delete cascade,
  active      boolean not null default true,
  constraint occupancy_one_owner check (num_nonnulls(booking_id, block_id) = 1),
  constraint occupancy_no_overlap exclude using gist (
    property_id with =, during with &&
  ) where (active)
);

create function booking_holds_dates(s booking_status) returns boolean
language sql immutable as $$
  select s in ('HOLD', 'AWAITING_APPROVAL', 'CONFIRMED');
$$;

create function sync_booking_occupancy() returns trigger
language plpgsql as $$
begin
  insert into occupancy (property_id, during, booking_id, active)
  values (new.property_id, daterange(new.check_in, new.check_out),
          new.id, booking_holds_dates(new.status))
  on conflict (booking_id) do update
    set property_id = excluded.property_id,
        during      = excluded.during,
        active      = excluded.active;
  return new;
end;
$$;
create trigger bookings_occupancy after insert or update of property_id, check_in, check_out, status
  on bookings for each row execute function sync_booking_occupancy();

create function sync_block_occupancy() returns trigger
language plpgsql as $$
begin
  insert into occupancy (property_id, during, block_id, active)
  values (new.property_id, new.during, new.id, true)
  on conflict (block_id) do update
    set property_id = excluded.property_id,
        during      = excluded.during;
  return new;
end;
$$;
create trigger calendar_blocks_occupancy after insert or update on calendar_blocks
  for each row execute function sync_block_occupancy();

-- Expire holds whose time is up. Called inside the transaction that creates a
-- new hold (so a stale hold never blocks a guest) and by the cron job.
create function release_expired_holds(p_property_id uuid default null) returns integer
language sql as $$
  with expired as (
    update bookings
       set status = 'EXPIRED'
     where status = 'HOLD'
       and hold_expires_at <= now()
       and (p_property_id is null or property_id = p_property_id)
    returning 1
  )
  select count(*)::integer from expired;
$$;

-- Payments and email ---------------------------------------------------------

-- Stripe events already processed; the primary key makes webhook handling idempotent (§5).
create table stripe_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);

create table email_outbox (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid references bookings (id) on delete set null,
  template     text not null,
  to_address   text not null,
  payload      jsonb not null default '{}'::jsonb,
  status       email_status not null default 'QUEUED',
  attempts     integer not null default 0,
  last_error   text,
  provider_id  text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index email_outbox_pending on email_outbox (created_at) where status in ('QUEUED', 'FAILED');

-- Key/value settings edited in the dashboard, e.g. host contact details (§2).
create table site_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
create trigger site_settings_updated_at before update on site_settings
  for each row execute function set_updated_at();

-- The browser never talks to the database: RLS is on with no policies, so the
-- public anon key reads nothing. The server connects as the table owner.
alter table properties      enable row level security;
alter table rate_rules      enable row level security;
alter table tax_rates       enable row level security;
alter table bookings        enable row level security;
alter table calendar_blocks enable row level security;
alter table occupancy       enable row level security;
alter table stripe_events   enable row level security;
alter table email_outbox    enable row level security;
alter table site_settings   enable row level security;
