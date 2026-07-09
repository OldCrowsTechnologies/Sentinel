-- Corvus Sentinel C2 — multi-tenant core schema (Supabase / Postgres)
-- ---------------------------------------------------------------------------
-- Model: each AGENCY is an org (tenant). Deputies join an org by redeeming a
-- SEAT CODE (how licenses are sold/distributed). Every position + detection is
-- tagged with org_id, and Row-Level Security guarantees a user only ever sees
-- their own org's data (Escambia SO cannot see Santa Rosa SO, enforced in the
-- database — not the client). Positions + detections are Realtime-published so
-- every app + the C2 dashboard in an org see the live picture instantly.
--
-- Apply: supabase db push  (or paste into the SQL editor). Idempotent-ish; drop
-- and re-run in dev.

-- ---- extensions ----
create extension if not exists pgcrypto;

-- ---- enums ----
do $$ begin
  create type member_role as enum ('deputy', 'command', 'admin');
exception when duplicate_object then null; end $$;

-- ---- tenants ----
create table if not exists orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,                 -- "Escambia County Sheriff's Office"
  slug       text unique not null,          -- "escambia-so"
  created_at timestamptz not null default now()
);

-- ---- membership (a "seat" that's been claimed) ----
create table if not exists org_members (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       member_role not null default 'deputy',
  call_sign  text,                          -- "ADAM-12" etc.
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists org_members_user_idx on org_members(user_id) where active;

-- ---- seat codes (licensing: sell N seats to an agency) ----
create table if not exists seat_codes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  code       text unique not null,          -- share with the agency; deputies redeem it
  role       member_role not null default 'deputy',
  max_uses   int not null default 25,       -- number of seats sold
  uses       int not null default 0,
  expires_at timestamptz,                    -- optional deployment window
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---- device registry (push notification targets) ----
create table if not exists devices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_id     uuid not null references orgs(id) on delete cascade,
  label      text,
  push_token text,                           -- Expo push token
  platform   text,
  last_seen  timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, push_token)
);

-- ---- live positions (latest per user; upserted) ----
create table if not exists positions (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid not null references orgs(id) on delete cascade,
  call_sign  text,
  lat        double precision,
  lon        double precision,
  accuracy_m real,
  heading    real,
  speed      real,
  ts         timestamptz not null default now()
);
create index if not exists positions_org_idx on positions(org_id);

-- ---- detections (append-only event log; mirrors lib/meshTypes ContactReport) ----
create table if not exists detections (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  node_id       text,                        -- ContactReport.nodeId
  seq           int,                         -- ContactReport.seq
  kind          text not null,               -- acoustic|rid|lora|control-link|wifi
  label         text,
  confidence    real,
  band          text,                        -- RF: 433MHz|868MHz|915MHz
  peak_db       real,                        -- RF energy detector: peak over floor
  lat           double precision,
  lon           double precision,
  pos_acc       real,
  range_ft      real,
  bearing       real,                        -- -1 = none (omni)
  unknown_build boolean,
  ts            timestamptz not null,
  created_at    timestamptz not null default now(),
  unique (org_id, node_id, seq)              -- idempotent: dedup re-sent reports
);
create index if not exists detections_org_ts_idx on detections(org_id, ts desc);

-- ---------------------------------------------------------------------------
-- Row-Level Security: a user sees ONLY their org's rows.
-- ---------------------------------------------------------------------------
alter table orgs         enable row level security;
alter table org_members  enable row level security;
alter table seat_codes   enable row level security;
alter table devices      enable row level security;
alter table positions    enable row level security;
alter table detections   enable row level security;

-- helper: org ids the caller belongs to (SECURITY DEFINER to avoid RLS recursion)
create or replace function my_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select org_id from org_members where user_id = auth.uid() and active
$$;
grant execute on function my_org_ids() to authenticated;

-- orgs: read your own org(s)
drop policy if exists orgs_read on orgs;
create policy orgs_read on orgs for select to authenticated
  using (id in (select my_org_ids()));

-- members: read co-members of your org(s)
drop policy if exists members_read on org_members;
create policy members_read on org_members for select to authenticated
  using (org_id in (select my_org_ids()));

-- devices: read your org; write only your own rows
drop policy if exists devices_read on devices;
create policy devices_read on devices for select to authenticated
  using (org_id in (select my_org_ids()));
drop policy if exists devices_write on devices;
create policy devices_write on devices for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and org_id in (select my_org_ids()));

-- positions: read your org; upsert only your own
drop policy if exists positions_read on positions;
create policy positions_read on positions for select to authenticated
  using (org_id in (select my_org_ids()));
drop policy if exists positions_write on positions;
create policy positions_write on positions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and org_id in (select my_org_ids()));

-- detections: read your org; insert only your own
drop policy if exists detections_read on detections;
create policy detections_read on detections for select to authenticated
  using (org_id in (select my_org_ids()));
drop policy if exists detections_insert on detections;
create policy detections_insert on detections for insert to authenticated
  with check (user_id = auth.uid() and org_id in (select my_org_ids()));

-- seat_codes: NO direct client access (managed by service role / admin dashboard).
-- Redemption goes through the SECURITY DEFINER function below only.

-- ---------------------------------------------------------------------------
-- Seat-code redemption: deputy enters a code -> joins the agency org.
-- ---------------------------------------------------------------------------
create or replace function redeem_seat_code(p_code text, p_call_sign text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid;
  v_role member_role;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select org_id, role into v_org, v_role
  from seat_codes
  where code = p_code and active and uses < max_uses
    and (expires_at is null or expires_at > now())
  for update;

  if v_org is null then raise exception 'invalid or exhausted seat code'; end if;

  insert into org_members (org_id, user_id, role, call_sign)
  values (v_org, auth.uid(), v_role, p_call_sign)
  on conflict (org_id, user_id)
    do update set active = true,
                  call_sign = coalesce(excluded.call_sign, org_members.call_sign);

  -- only count a fresh seat toward the license, not a re-login of an existing member
  if (select created_at from org_members where org_id = v_org and user_id = auth.uid()) > now() - interval '5 seconds' then
    update seat_codes set uses = uses + 1 where code = p_code;
  end if;

  return v_org;
end $$;
grant execute on function redeem_seat_code(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: publish live tables so apps + C2 dashboard get instant updates.
-- ---------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table positions;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table detections;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- DEMO SEED (safe to delete): one test agency + a 25-seat deputy code so the
-- app can enroll immediately. Deputies enroll in the app with code OCWS-DEMO-25.
-- ---------------------------------------------------------------------------
insert into orgs (name, slug) values ('OCWS Test Agency', 'ocws-test')
  on conflict (slug) do nothing;
insert into seat_codes (org_id, code, role, max_uses)
  select id, 'OCWS-DEMO-25', 'deputy', 25 from orgs where slug = 'ocws-test'
  on conflict (code) do nothing;
