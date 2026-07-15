-- Corvus Sentinel C2 — ECSO Blue Angels demo: 30-day deployment window + unlimited seats
-- ---------------------------------------------------------------------------
-- Adds a HARD, org-level expiry so this demo tenant auto-dies after 30 days
-- (after which every read/write for the org is denied at the database — the app
-- and the C2 dashboard simply stop seeing data until a contract renews it).
-- Also enables UNLIMITED seats (max_uses < 0) and seeds the Escambia County
-- Sheriff's Office org with a deputy code (phones) and a command code (C2 login).
--
-- Apply AFTER 0001_c2_core.sql. Idempotent — safe to re-run (refreshes the window).
-- ---------------------------------------------------------------------------

-- 1) Org-level deployment window. NULL = never expires (normal paying tenants).
alter table orgs add column if not exists expires_at timestamptz;

-- 2) THE KILL SWITCH. my_org_ids() is the single choke point every RLS policy
--    (read AND write) funnels through, so hiding an expired org here denies all
--    access to it everywhere at once — no per-table changes needed.
create or replace function my_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.org_id
  from org_members m
  join orgs o on o.id = m.org_id
  where m.user_id = auth.uid() and m.active
    and (o.expires_at is null or o.expires_at > now())
$$;
grant execute on function my_org_ids() to authenticated;

-- 3) Unlimited seats: treat max_uses < 0 as unlimited, and refuse redemption once
--    the seat code OR its org has expired. Only real (>=0) seat codes tick usage.
create or replace function redeem_seat_code(p_code text, p_call_sign text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid;
  v_role member_role;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  select s.org_id, s.role into v_org, v_role
  from seat_codes s
  join orgs o on o.id = s.org_id
  where s.code = p_code and s.active
    and (s.max_uses < 0 or s.uses < s.max_uses)
    and (s.expires_at is null or s.expires_at > now())
    and (o.expires_at is null or o.expires_at > now())
  for update of s;

  if v_org is null then raise exception 'invalid, exhausted, or expired seat code'; end if;

  insert into org_members (org_id, user_id, role, call_sign)
  values (v_org, auth.uid(), v_role, p_call_sign)
  on conflict (org_id, user_id)
    do update set active = true,
                  call_sign = coalesce(excluded.call_sign, org_members.call_sign);

  -- count a genuinely-new seat toward a metered license only (unlimited codes skip)
  if (select created_at from org_members where org_id = v_org and user_id = auth.uid())
       > now() - interval '5 seconds' then
    update seat_codes set uses = uses + 1 where code = p_code and max_uses >= 0;
  end if;

  return v_org;
end $$;
grant execute on function redeem_seat_code(text, text) to authenticated;

-- 4) Optional convenience: let an enrolled member read their org's expiry so the
--    app / dashboard can show a "demo ends in N days" banner. RLS already scopes
--    orgs_read to my_org_ids(); expires_at rides along on that same row.

-- ---------------------------------------------------------------------------
-- ECSO DEMO SEED — live for 30 days from when this runs, then auto-expires.
-- ---------------------------------------------------------------------------
insert into orgs (name, slug, expires_at)
values ('Escambia County Sheriff''s Office', 'escambia-so', now() + interval '30 days')
on conflict (slug) do update set expires_at = excluded.expires_at,
                                 name = excluded.name;

-- Deputy code — goes on every phone/tablet at the show. UNLIMITED seats (-1).
insert into seat_codes (org_id, code, role, max_uses, expires_at)
select id, 'ECSO-BA-DEPUTY', 'deputy', -1, now() + interval '30 days'
from orgs where slug = 'escambia-so'
on conflict (code) do update set max_uses = excluded.max_uses,
                                 expires_at = excluded.expires_at,
                                 active = true;

-- Command code — ECSO enters this in the C2 dashboard to log in and watch the fleet.
insert into seat_codes (org_id, code, role, max_uses, expires_at)
select id, 'ECSO-BA-CMD', 'command', -1, now() + interval '30 days'
from orgs where slug = 'escambia-so'
on conflict (code) do update set max_uses = excluded.max_uses,
                                 expires_at = excluded.expires_at,
                                 active = true;
