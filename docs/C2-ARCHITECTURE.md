# Corvus Sentinel — C2 cloud platform

Turns Sentinel from a standalone detector into a **fleet product**: deputies run
the app, it streams their position + drone detections to a cloud backend, and a
**C2 (command) dashboard** shows the whole agency's live picture. Sold per agency
by **seat code**.

## Deployment assumptions
- Deputies have **cell signal** during events → cloud is the primary data link
  (the offline LoRa peer-mesh in `docs/PHASE3-MESH.md` remains a *fallback tier*
  for comms-denied ops, not the day-one path).
- Each deputy carries the RF sensor (RTL-SDR + antenna) and the app; a LoRa/BLE
  companion feeds control-link IQ (see `docs/RF-SDR-BRINGUP.md`).

## Stack
- **Supabase** (Postgres + Row-Level Security + Realtime + Auth) — backend.
- **Mobile app** (this Expo repo) — `lib/cloudSync.ts` is the client tier.
- **C2 dashboard** — Next.js web app (`c2-dashboard/`), same Supabase project.

## Multi-tenancy (the core guarantee)
Every row is tagged `org_id` (one org = one agency). **RLS enforces, in the
database, that a user only ever reads their own org's rows** — Escambia SO cannot
see Santa Rosa SO even if the client is tampered with. Schema + policies:
`supabase/migrations/0001_c2_core.sql`.

Tables: `orgs`, `org_members` (claimed seats + role deputy/command/admin),
`seat_codes` (licensing), `devices` (push targets), `positions` (live, upserted),
`detections` (append-only, deduped by `org_id,node_id,seq`).

## Licensing / distribution
- Sell an agency **N seats** → create a `seat_codes` row (`max_uses = N`).
- Deputy installs the app, enters the code once → `redeem_seat_code()` joins them
  to the org (anonymous auth + membership). Re-logins don't burn a seat.
- Command staff get a `command` role and use the C2 dashboard.

## Data flow
```
deputy app (foreground service, minimized)
  ├─ position  → positions.upsert (org_id)        ┐
  └─ detection → detections.insert (org_id)        │ RLS-scoped
        │                                          ▼
        ├─ Supabase Realtime ── fan-out ──► every same-org app + C2 dashboard
        └─ trigger/Edge fn ──► Expo push ──► deputies' devices (alert)
```
Detections hit C2 the instant they insert — the push notification is a *secondary*
alert, never the delivery path. If the deputy ignores the push, C2 already has it.

## App client (`lib/cloudSync.ts`) — status: BUILT
`enrollWithCode` · `pushPosition` · `pushDetection` (reuses `ContactReport`) ·
`subscribeFleet` (Realtime) · `registerPushToken`. Inert until
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set (anon key is
public-safe by design; the service_role key is NEVER bundled). Wired in `App.tsx`:
acoustic detections + positions publish while monitoring.

## Triangulation / elevation
Fusion (`lib/meshFusion.ts`) is 2D (lat/lon + uncertainty ellipse) — with several
deputies detecting the same contact it yields an approximate location. **Elevation
is being dropped from the UI** for now (too inaccurate); horizontal triangulation
carries the location estimate.

## Build sequence
1. **Backend** — apply `0001_c2_core.sql` to a Supabase project. ✅ written
2. **App cloud tier** — `lib/cloudSync.ts` + `App.tsx` wiring. ✅ built (acoustic + position)
3. **App: enrollment UI** (seat-code screen) + **RF→C2** (map `RfLinkDetection`→detection) + **fleet on map** (`subscribeFleet`). ⏳ next
4. **Background service** hardening (always-on minimized) + **Expo push** on detection. ⏳
5. **C2 dashboard** (`c2-dashboard/`) — live map, detections feed, org-scoped. ⏳ in progress
6. **Play Store** closed-testing distribution + seat-code admin. ⏳

## Security notes (LE product)
- Anon key + RLS is the correct client pattern; **service_role key server-only**.
- Officer positions are sensitive — TLS throughout, auth-gated, org-isolated.
- Confirm each agency's data-handling / CJIS-adjacent requirements before contract.
