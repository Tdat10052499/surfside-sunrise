-- Admin sign-in (step 2). Only accounts in admin_users can sign in; there is no sign-up.
-- The first account is created from ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD
-- (scripts/admin-bootstrap.ts) and must change that password at its first sign-in.

create table admin_users (
  id                    uuid primary key default gen_random_uuid(),
  email                 text not null unique check (email = lower(email) and email like '%@%'),
  -- scrypt hash in the form scrypt$N$r$p$salt$hash (src/lib/auth/password.ts).
  password_hash         text not null,
  must_change_password  boolean not null default true,
  failed_attempts       integer not null default 0 check (failed_attempts >= 0),
  locked_until          timestamptz,
  password_changed_at   timestamptz,
  last_login_at         timestamptz,
  created_at            timestamptz not null default now()
);

-- One row per signed-in browser. The cookie holds a random token; only its
-- SHA-256 is stored, so a leaked table row cannot be replayed as a cookie.
create table admin_sessions (
  token_hash  text primary key,
  admin_id    uuid not null references admin_users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index admin_sessions_admin on admin_sessions (admin_id);

alter table admin_users    enable row level security;
alter table admin_sessions enable row level security;
