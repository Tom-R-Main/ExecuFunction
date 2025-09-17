create extension if not exists pgcrypto;create extension if not exists citext;   -- case-insensitive strings

-- canonical email check (case-insensitive)
create domain email_citext as citext
  check (value ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- WAITLIST
create table if not exists waitlist_entries (
  id                 uuid primary key default gen_random_uuid(),
  email              email_citext not null unique,
  email_ci           text generated always as (lower(email::text)) stored, -- for joins/analytics
  first_name         text,
  last_name          text,
  utm_source         text,
  utm_medium         text,
  utm_campaign       text,
  tags               text[] not null default array[]::text[],
  outreach_status    text not null default 'pending',   -- pending|contacted|responded|converted|archived
  outreach_notes     text,
  last_outreach_date timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists idx_waitlist_created on waitlist_entries(created_at desc);
create index if not exists idx_waitlist_status  on waitlist_entries(outreach_status);

-- CONTACT MESSAGES
create table if not exists contact_messages (
  id         uuid primary key default gen_random_uuid(),
  email      email_citext not null,
  message    text not null check (length(message) >= 5),
  created_at timestamptz not null default now()
);
create index if not exists idx_contact_email on contact_messages(email);

-- USERS (future WinonaOS accounts; link to waitlist if applicable)
create table if not exists users (
  id                 uuid primary key default gen_random_uuid(),
  email              email_citext not null unique,
  google_id          text unique,
  first_name         text,
  last_name          text,
  profile_picture_url text,
  created_at         timestamptz not null default now(),
  last_login_at      timestamptz,
  is_active          boolean not null default true,
  waitlist_entry_id  uuid unique references waitlist_entries(id)
);
create index if not exists idx_users_google_id on users(google_id);

-- OUTREACH AUDIT LOG (lightweight CRM trail)
create table if not exists outreach_events (
  id                 uuid primary key default gen_random_uuid(),
  waitlist_entry_id  uuid not null references waitlist_entries(id) on delete cascade,
  kind               text not null,  -- signup|repeat_signup|emailed|called|replied|converted|note
  details            jsonb not null default '{}'::jsonb, -- e.g., {"subject":"...", "channel":"email"}
  created_at         timestamptz not null default now()
);
create index if not exists idx_outreach_entry on outreach_events(waitlist_entry_id);
create index if not exists idx_outreach_kind  on outreach_events(kind);

-- CONSENT (privacy/legal)
create table if not exists consents (
  id            uuid primary key default gen_random_uuid(),
  person_email  email_citext not null,
  doc_version   text not null,
  granted_at    timestamptz not null default now(),
  withdrawn_at  timestamptz
);

-- SYSTEM LOGS (keep table minimal; use it across services)
create table if not exists system_logs (
  id         uuid primary key default gen_random_uuid(),
  actor      text,           -- e.g., 'exf-api', 'appsheet', 'admin@'
  operation  text not null,  -- e.g., 'join-waitlist', 'send-email'
  details    jsonb,
  created_at timestamptz not null default now()
);