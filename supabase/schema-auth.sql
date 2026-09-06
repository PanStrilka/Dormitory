-- ============================================================================
--  Bulka — accounts + multi-cell schema (Supabase Auth)
--  This is the foundation for real logins, many buňky (cells), rooms A/B,
--  and enforced roles (superadmin / cell_admin / member).
--
--  Run this ONLY after enabling Email auth — see docs/SETUP.md "Stage 5".
--  Safe to re-run (idempotent). It does NOT touch the current single-cell
--  tables, so the live app keeps working until we switch the client to auth.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---- profiles: one row per authenticated user --------------------------------
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  is_superadmin boolean not null default false,
  created_at    timestamptz default now()
);

-- ---- cells (buňky) -----------------------------------------------------------
create table if not exists cells (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,          -- e.g. "Buňka 2"
  code       text,                   -- join code shown to roommates
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- ---- membership: a user in a cell, with room / role / approval status --------
create table if not exists memberships (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  cell_id      uuid not null references cells(id) on delete cascade,
  room         text check (room in ('A','B')),
  role         text not null default 'member'  check (role in ('member','cell_admin')),
  status       text not null default 'pending' check (status in ('pending','verified','rejected')),
  display_name text,
  created_at   timestamptz default now(),
  unique (user_id, cell_id)
);

-- ---- per-cell app state (rota, completions, expenses, shopping, ...) ----------
--  Same JSON document as today's bulka_state, but one row per cell.
create table if not exists cell_state (
  cell_id    uuid primary key references cells(id) on delete cascade,
  data       jsonb,
  updated_at timestamptz default now()
);

-- ---- helper functions (SECURITY DEFINER avoids RLS recursion) ----------------
create or replace function is_superadmin() returns boolean
  language sql security definer stable set search_path = public as $$
  select coalesce((select p.is_superadmin from profiles p where p.id = auth.uid()), false);
$$;

create or replace function is_verified_member(c uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from memberships m
    where m.cell_id = c and m.user_id = auth.uid() and m.status = 'verified')
    or is_superadmin();
$$;

create or replace function is_cell_admin(c uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists(select 1 from memberships m
    where m.cell_id = c and m.user_id = auth.uid()
      and m.status = 'verified' and m.role = 'cell_admin')
    or is_superadmin();
$$;

-- ---- prevent users from making themselves superadmin -------------------------
create or replace function guard_superadmin() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  -- No auth context (SQL editor / service role) may set superadmin freely —
  -- that's how you bootstrap the first admin. End-user requests always have
  -- auth.uid(), so only they are guarded against self-promotion.
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.is_superadmin and not is_superadmin() then new.is_superadmin := false; end if;
  else
    if new.is_superadmin is distinct from old.is_superadmin and not is_superadmin() then
      new.is_superadmin := old.is_superadmin;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_superadmin on profiles;
create trigger trg_guard_superadmin before insert or update on profiles
  for each row execute function guard_superadmin();

-- ---- Row Level Security ------------------------------------------------------
alter table profiles    enable row level security;
alter table cells       enable row level security;
alter table memberships enable row level security;
alter table cell_state  enable row level security;

-- profiles: any signed-in user can read names; you manage your own row
drop policy if exists p_prof_sel on profiles;
create policy p_prof_sel on profiles for select to authenticated using (true);
drop policy if exists p_prof_ins on profiles;
create policy p_prof_ins on profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists p_prof_upd on profiles;
create policy p_prof_upd on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- cells: signed-in users can see cells (to pick one to join); only a
-- superadmin creates them; superadmin or that cell's admin can edit.
drop policy if exists p_cell_sel on cells;
create policy p_cell_sel on cells for select to authenticated using (true);
drop policy if exists p_cell_ins on cells;
create policy p_cell_ins on cells for insert to authenticated with check (is_superadmin());
drop policy if exists p_cell_upd on cells;
create policy p_cell_upd on cells for update to authenticated using (is_cell_admin(id)) with check (is_cell_admin(id));
drop policy if exists p_cell_del on cells;
create policy p_cell_del on cells for delete to authenticated using (is_superadmin());

-- memberships: you see your own + (admins see their cell's); you may request
-- to join (own row, pending, member); admins approve/edit/remove.
drop policy if exists p_mem_sel on memberships;
create policy p_mem_sel on memberships for select to authenticated
  using (user_id = auth.uid() or is_cell_admin(cell_id));
drop policy if exists p_mem_ins on memberships;
create policy p_mem_ins on memberships for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and role = 'member');
drop policy if exists p_mem_upd on memberships;
create policy p_mem_upd on memberships for update to authenticated
  using (is_cell_admin(cell_id)) with check (is_cell_admin(cell_id));
drop policy if exists p_mem_del on memberships;
create policy p_mem_del on memberships for delete to authenticated
  using (is_cell_admin(cell_id) or user_id = auth.uid());

-- cell_state: only a verified member (or admin) of that cell can read/write it.
drop policy if exists p_state_sel on cell_state;
create policy p_state_sel on cell_state for select to authenticated using (is_verified_member(cell_id));
drop policy if exists p_state_ins on cell_state;
create policy p_state_ins on cell_state for insert to authenticated with check (is_verified_member(cell_id));
drop policy if exists p_state_upd on cell_state;
create policy p_state_upd on cell_state for update to authenticated using (is_verified_member(cell_id)) with check (is_verified_member(cell_id));

-- ============================================================================
--  After running this and logging in once, mark yourself superadmin:
--    update profiles set is_superadmin = true
--    where id = (select id from auth.users where email = 'YOUR-EMAIL-HERE');
--  Then create your first cell (Buňka 2) and make yourself its cell_admin.
--  The app's admin panel will do the rest once the client is switched on.
-- ============================================================================
