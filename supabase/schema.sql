-- ============================================================================
--  Bulka — Supabase schema
--  Paste this whole file into: Supabase project -> SQL Editor -> New query -> Run.
--  Safe to run more than once (uses IF NOT EXISTS / idempotent policies).
--
--  Security note: this is a coordination tool for one dormitory cell, not a
--  bank. Access is gated by a shared "join code" plus admin verification, and
--  the tables are readable/writable with the public anon key. Secret keys
--  (the AI key, the web-push private key) never live here or in the app — they
--  stay in Supabase Edge Function secrets. See docs/SETUP.md.
-- ============================================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1) Shared application state (rota, completions, expenses, points, members).
--    The app syncs this single JSON document across all phones.
-- ----------------------------------------------------------------------------
create table if not exists bulka_state (
  id         text primary key,           -- always 'shared'
  data       jsonb,
  updated_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 2) Cell configuration: the join code and who the admin is.
-- ----------------------------------------------------------------------------
create table if not exists cell_config (
  id         text primary key default 'main',
  join_code  text,                        -- roommates type this to get in
  admin_name text,                        -- who approves new members
  updated_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 3) Membership + verification. A new person is 'pending' until the admin
--    marks them 'verified'; only verified members enter the rota.
-- ----------------------------------------------------------------------------
create table if not exists members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  room       text check (room in ('A','B')),
  status     text not null default 'pending'
             check (status in ('pending','verified','rejected')),
  device_id  text,                        -- random per-device id of requester
  created_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 4) Receipts. When a purchase photo is added we try to parse it with AI.
--    On success -> receipt_items below. On failure (or AI offline) the raw
--    photo is kept in Storage for a few days so it can be retried / checked,
--    then auto-deleted. `expires_at` drives the cleanup job.
-- ----------------------------------------------------------------------------
create table if not exists receipts (
  id           uuid primary key default gen_random_uuid(),
  expense_id   text,                      -- optional link to an expense in the blob
  payer        text,
  amount       numeric,
  storage_path text,                      -- path in the 'receipts' Storage bucket
  status       text not null default 'pending'
               check (status in ('pending','parsed','failed')),
  ai_error     text,
  created_at   timestamptz default now(),
  expires_at   timestamptz default (now() + interval '7 days')
);

-- ----------------------------------------------------------------------------
-- 5) Parsed line items from a receipt (kept long-term, even after the photo
--    is deleted). This is the "table with name / quantity / price".
-- ----------------------------------------------------------------------------
create table if not exists receipt_items (
  id         uuid primary key default gen_random_uuid(),
  receipt_id uuid references receipts(id) on delete cascade,
  name       text,
  qty        numeric,
  unit_price numeric,
  total      numeric,
  created_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- 5b) Debt-repayment proofs. When someone repays by BANK TRANSFER they can
--     attach a photo of the confirmation; the `verify-transfer` Edge Function
--     asks AI whether it looks genuine and matches the expected amount.
--     `settlement_id` links to the settlement inside the shared JSON blob.
--     The raw photo is kept in the `receipts` bucket until `expires_at`.
-- ----------------------------------------------------------------------------
create table if not exists transfers (
  id            uuid primary key default gen_random_uuid(),
  settlement_id text,                     -- id of the settlement in the blob
  amount        numeric,
  currency      text,
  storage_path  text,                     -- path in the 'receipts' Storage bucket
  status        text not null default 'pending'
                check (status in ('pending','verified','rejected','unclear','failed')),
  ai_reason     text,                     -- short explanation from the AI check
  created_at    timestamptz default now(),
  expires_at    timestamptz default (now() + interval '30 days')
);

-- ----------------------------------------------------------------------------
-- 6) Web-push subscriptions (one per device that opts in to notifications).
-- ----------------------------------------------------------------------------
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  member_name text,
  endpoint    text unique,
  p256dh      text,
  auth        text,
  created_at  timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- Row Level Security: enable, then allow the anon key to read/write.
-- (Coordination-level trust, gated by the join code in the app.)
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'bulka_state','cell_config','members','receipts','receipt_items','transfers','push_subscriptions'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$
      drop policy if exists "anon all" on %I;
      create policy "anon all" on %I
        for all to anon using (true) with check (true);
    $p$, t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- TTL cleanup of expired receipt rows. (Deleting the Storage FILE for each is
-- done by the scheduled Edge Function in docs/SETUP.md — pg_cron only removes
-- the rows here. If pg_cron is unavailable on your plan, the Edge Function
-- handles both rows and files.)
-- ----------------------------------------------------------------------------
-- Uncomment if the pg_cron extension is enabled for your project:
-- create extension if not exists pg_cron;
-- select cron.schedule('bulka-receipt-ttl', '0 3 * * *',
--   $$ delete from receipts where expires_at < now() and status <> 'parsed'; $$);
