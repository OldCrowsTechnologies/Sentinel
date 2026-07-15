# Corvus Sentinel — C2 (ECSO Blue Angels demo)

Live command-and-control for the demo: phones/tablets run Sentinel and stream
positions + drone detections over **cell** to a Supabase backend; this dashboard
(run on the C2 **laptop**, any browser) shows the live fleet, detections, and
**multilaterated fused tracks** with an uncertainty ellipse.

The demo tenant is **hard-capped to 30 days** — after that the database denies all
access for the org and everything goes dark until a contract renews it.

## Codes (share with ECSO)

| Code | Role | Where it's entered | Seats |
|------|------|--------------------|-------|
| `ECSO-BA-DEPUTY` | deputy | in the **app** (enroll) on each phone/tablet | **unlimited** |
| `ECSO-BA-CMD` | command | in **this dashboard** to log in | unlimited |

## One-time deploy (does the whole thing)

1. **Create a Supabase project** (supabase.com → New project). Free tier is fine for
   a 30-day active demo.
2. **Run the schema:** open **SQL Editor**, paste all of
   [`../supabase/DEPLOY_ECSO_DEMO.sql`](../supabase/DEPLOY_ECSO_DEMO.sql), **Run**.
   This creates the C2 schema + the ECSO org (30-day window) + both codes.
   > The 30-day clock starts the moment you Run it.
3. **Grab keys:** Project Settings → **API** → copy the **Project URL** and the
   **anon public** key. (The anon key is safe to ship — Row-Level Security is the
   guard. Never put the *service_role* key in the app or this page.)
4. **Build the APK** (feeds the phones):
   - Put the two keys into `eas.json` → `build.demo.env`
     (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`).
   - `npx eas build --platform android --profile demo`
   - EAS returns an install URL + **QR** — that's what ECSO scans to install.
5. **Publish this dashboard:**
   - Replace `__SUPABASE_URL__` / `__SUPABASE_ANON__` in `index.html`, **or** set
     `window.CORVUS_SUPABASE_URL` / `window.CORVUS_SUPABASE_ANON` before the module.
   - It's a single static file — host on Vercel / Netlify / the OCWS site, or open
     locally. Give ECSO the URL + the `ECSO-BA-CMD` code.

## Notes
- **Fusion:** a fused drone fix needs **≥3 positioned units** in range of the same
  contact; fewer shows range rings only (ported from `lib/meshFusion.ts`).
- **Map tiles** come from OpenStreetMap (needs internet — fine on the C2 laptop's
  cell/wifi). The detection stream itself is independent of the basemap.
- **Renewing past 30 days:** re-run step 2 (refreshes `expires_at` to now + 30d) or,
  under contract, set the org's `expires_at` to `null` for no expiry.
