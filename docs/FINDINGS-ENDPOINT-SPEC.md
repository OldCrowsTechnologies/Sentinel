# Spec: Sentinel Findings Sync Endpoint (`/api/corvus/findings`)

The server receiver that `lib/findingsSync.ts` talks to. When a Sentinel device
has a network it POSTs its queued contact findings and GETs peers' since a
cursor, so a whole deployment converges on one tactical picture. Offline-first,
**no user sign-in** (Sentinel is contract-deployed) — auth is a shared app token
plus a per-deployment **fleet id** for isolation.

Lives in **ocws-site** (Next.js App Router) as `app/api/corvus/findings/route.ts`,
reusing the existing `lib/redis.ts` (Upstash) and `lib/abuseGuard.ts` helpers.
Mirrors the conventions of `app/api/mobile/corvus-chat/route.ts`.

---

## 1. Design constraints

| Constraint | Consequence |
|---|---|
| No user accounts (contract product) | Auth = shared `x-app-token`; **not** per-user. Rotatable via Vercel env. |
| Multiple independent deployments | **Fleet isolation** via `x-fleet-id` — one customer's findings never reach another's. |
| Offline-first, opportunistic sync | Endpoint is a dumb shared store; the client owns queueing/retry. Best-effort. |
| Tactical, ephemeral data | **TTL retention** (~6 h rolling) + size cap. Not a permanent record. |
| Public internet surface | Rate-limit + payload caps + server-side validation (never trust the wire). Fail-open (a backstop must not be a SPOF). |
| Sentinel model = **the calling client is the security boundary** | The endpoint stores/relays validated reports; it does not authenticate operators. Anyone with the app token + fleet id can read/write that fleet's window — acceptable for a closed contract fleet, but see §7 hardening. |

---

## 2. Auth & scoping

- **`x-app-token`** (required) must equal server env `CORVUS_SENTINEL_APP_TOKEN`
  (fallback `EXPO_PUBLIC_CORVUS_APP_TOKEN`, matching the chat route). Missing/wrong → **401**.
- **`x-fleet-id`** (optional, default `"default"`) scopes storage. Validated to
  `^[A-Za-z0-9_-]{1,64}$`; anything else collapses to `"default"`. Set per
  deployment via `EXPO_PUBLIC_CORVUS_FLEET_ID` in the build.

The app token is baked into the APK (non-secret by design — it only gates a
low-value relay, not spend or PII). Rotate via Vercel env if abused.

---

## 3. Endpoint contract

### `POST /api/corvus/findings`
Publish this node's queued findings.

- Headers: `x-app-token`, `x-fleet-id`, `Content-Type: application/json`
- Body: `{ "reports": string[] }` — each string is an **encoded `ContactReport`**
  (`meshTypes.encodeReport`, i.e. `JSON.stringify(report)`).
- Limits: ≤ `MAX_BATCH` (200) reports, ≤ `MAX_BODY_BYTES` (512 KB).
- Response: `200 { "accepted": <n> }` (n = reports that passed validation + stored).
- Errors: `401` auth · `413` body/batch too large · `400` bad JSON · `429` rate-limited · `502` store failure.

### `GET /api/corvus/findings?since=<ms>`
Pull peers' findings newer than a cursor.

- Headers: `x-app-token`, `x-fleet-id`
- Query: `since` = epoch ms high-water mark (client's `lastPullT`; `0` = all retained).
- Response: `200 { "reports": string[] }` — encoded `ContactReport`s with `t > since`,
  oldest→newest, capped at `MAX_PULL` (500).
- Errors: `401` · `429`. Storage errors degrade to `{ "reports": [] }` (fail-open).

### `OPTIONS` → `204` (CORS preflight; native fetch usually skips it, but harmless).

The client (`findingsSync.ts`) already speaks exactly this shape:
`POST { reports }` then `GET ?since=<lastPullT>` → `{ reports }`, feeding each
through `ingestRaw` (dedup by `nodeId:seq`) into fusion.

---

## 4. Storage schema (Upstash Redis)

One sorted set per fleet, scored by report time:

```
KEY    corvus:findings:<fleet>      (ZSET)
SCORE  report.t                     (epoch ms)
MEMBER <encoded ContactReport>      (the JSON string; identical members dedup)
```

- **Publish**: `ZADD` each validated report `{score: r.t, member: raw}`. Identical
  strings collapse (idempotent retries). Then:
  - `EXPIRE key RETENTION_SEC` — rolling 6 h TTL (refreshed on every write).
  - `ZREMRANGEBYSCORE key 0 (now-RETENTION)` — drop stale.
  - `ZREMRANGEBYRANK key 0 -(SET_CAP+1)` — keep newest `SET_CAP` (5000) to bound memory.
- **Pull**: `ZRANGE key (since +inf BYSCORE LIMIT 0 MAX_PULL` — exclusive of `since`
  so the boundary report isn't re-sent (harmless if it is — client dedups).

Dedup by exact member is sufficient because `encodeReport` is deterministic and
`seq` is monotonic per node. (If you later want strict `nodeId:seq` dedup,
key members as `${nodeId}:${seq}` in a companion hash → payload.)

Constants: `RETENTION_SEC=21600`, `SET_CAP=5000`, `MAX_BATCH=200`,
`MAX_BODY_BYTES=512000`, `MAX_PULL=500`.

---

## 5. Abuse backstops (reuse `lib/abuseGuard.ts`)

- **Rate limit per (fleet, IP)**: `rateLimited('corvus:findings:rl:<fleet>:<ip>', 120, 60)`
  on POST; `240/60` on GET. Fail-open.
- **Payload caps**: batch count + body bytes (above) — a device reports a handful
  of contacts per minute, so 200/batch is generous.
- **Validation**: server mirrors `meshTypes.decodeReport` field-by-field; malformed
  members are dropped, never stored.
- **No Anthropic/spend** on this path, so no daily-budget ceiling needed (unlike chat).

---

## 6. Reference implementation (drop-in `app/api/corvus/findings/route.ts`)

```ts
// app/api/corvus/findings/route.ts
// Sentinel fleet findings sync — offline-first devices publish/pull contact
// findings so a deployment converges. No user sign-in: shared app token + a
// per-deployment fleet id. See docs/FINDINGS-ENDPOINT-SPEC.md (Sentinel repo).
export const runtime = "nodejs";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import redis from "@/lib/redis";
import { rateLimited, clientIp } from "@/lib/abuseGuard";

const APP_TOKEN =
  process.env.CORVUS_SENTINEL_APP_TOKEN ?? process.env.EXPO_PUBLIC_CORVUS_APP_TOKEN ?? "";

const MAX_BATCH = 200;
const MAX_BODY_BYTES = 512_000;
const MAX_PULL = 500;
const RETENTION_SEC = 6 * 60 * 60;
const SET_CAP = 5000;
const KINDS = new Set(["acoustic", "rid", "lora", "wifi"]);

const authed = (req: Request) => !!APP_TOKEN && req.headers.get("x-app-token") === APP_TOKEN;
const fleetOf = (req: Request) => {
  const f = (req.headers.get("x-fleet-id") ?? "default").trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(f) ? f : "default";
};
const key = (fleet: string) => `corvus:findings:${fleet}`;

// Server-side mirror of meshTypes.decodeReport — never trust the wire.
function validReport(raw: string): { ok: boolean; t?: number } {
  let o: any;
  try { o = JSON.parse(raw); } catch { return { ok: false }; }
  if (typeof o !== "object" || o === null) return { ok: false };
  const num = (x: any) => typeof x === "number" && Number.isFinite(x);
  const nn = (x: any) => x === null || num(x);
  if (o.v !== 1) return { ok: false };
  if (typeof o.nodeId !== "string" || !o.nodeId) return { ok: false };
  if (!num(o.seq) || o.seq < 0 || !Number.isInteger(o.seq)) return { ok: false };
  if (!num(o.t)) return { ok: false };
  if (!nn(o.lat) || !nn(o.lon) || !nn(o.posAcc)) return { ok: false };
  if (typeof o.type !== "string" || !o.type) return { ok: false };
  if (!num(o.conf) || !num(o.rangeFt) || !nn(o.rangeSd) || !num(o.bearing)) return { ok: false };
  if (typeof o.unknownBuild !== "boolean") return { ok: false };
  if (typeof o.kind !== "string" || !KINDS.has(o.kind)) return { ok: false };
  return { ok: true, t: o.t };
}

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const fleet = fleetOf(req);
  if (await rateLimited(`corvus:findings:rl:${fleet}:${clientIp(req)}`, 120, 60))
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES)
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  let body: any;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const reports: unknown[] = Array.isArray(body?.reports) ? body.reports : [];
  if (reports.length > MAX_BATCH)
    return NextResponse.json({ error: "batch_too_large", max: MAX_BATCH }, { status: 413 });

  const members = reports
    .filter((r): r is string => typeof r === "string")
    .map((r) => ({ raw: r, v: validReport(r) }))
    .filter((x) => x.v.ok)
    .map((x) => ({ score: x.v.t as number, member: x.raw }));
  if (members.length === 0) return NextResponse.json({ accepted: 0 });

  try {
    const k = key(fleet);
    // @upstash/redis zadd: zadd(key, {score,member}, {score,member}, ...)
    await redis.zadd(k, members[0], ...members.slice(1));
    await redis.expire(k, RETENTION_SEC);
    await redis.zremrangebyscore(k, 0, Date.now() - RETENTION_SEC * 1000);
    await redis.zremrangebyrank(k, 0, -(SET_CAP + 1));
  } catch {
    return NextResponse.json({ error: "store_failed" }, { status: 502 });
  }
  return NextResponse.json({ accepted: members.length });
}

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const fleet = fleetOf(req);
  if (await rateLimited(`corvus:findings:rlget:${fleet}:${clientIp(req)}`, 240, 60))
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const since = Number(new URL(req.url).searchParams.get("since") ?? "0") || 0;
  try {
    const reports = (await redis.zrange(key(fleet), `(${since}`, "+inf", {
      byScore: true, offset: 0, count: MAX_PULL,
    })) as string[];
    return NextResponse.json({ reports: reports ?? [] });
  } catch {
    return NextResponse.json({ reports: [] });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
```

> ⚠️ Verify the `zadd`/`zrange` call shapes against the installed `@upstash/redis`
> version — the byScore `zrange` options object and multi-member `zadd` signature
> are stable in v1.x but worth a quick check. Everything else is version-agnostic.

---

## 7. Required client change (Sentinel `lib/findingsSync.ts`)

Today the client sends no auth. Add the two headers on both calls (values from
env, inert when unset):

```ts
const APP_TOKEN = process.env.EXPO_PUBLIC_CORVUS_APP_TOKEN || '';
const FLEET_ID  = process.env.EXPO_PUBLIC_CORVUS_FLEET_ID  || 'default';
const authHeaders = { 'x-app-token': APP_TOKEN, 'x-fleet-id': FLEET_ID };
// POST: headers: { 'Content-Type': 'application/json', ...authHeaders }
// GET:  fetch(url, { headers: authHeaders })
```

This is a small, safe edit (headers are ignored by a missing endpoint). Ships in
the next APK build.

---

## 8. Environment

**ocws-site (Vercel):**
- `CORVUS_SENTINEL_APP_TOKEN` — shared app token (or reuse `EXPO_PUBLIC_CORVUS_APP_TOKEN`).
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — already set for chat.

**Sentinel APK (build-time `EXPO_PUBLIC_*`):**
- `EXPO_PUBLIC_CORVUS_FINDINGS_URL=https://www.oldcrowswireless.com/api/corvus/findings`
- `EXPO_PUBLIC_CORVUS_APP_TOKEN=<token>`
- `EXPO_PUBLIC_CORVUS_FLEET_ID=<per-deployment id>`

Leave `FINDINGS_URL` blank for a fully air-gapped deployment → client no-ops, findings stay local / P2P-only.

---

## 9. Retention & privacy
- Findings carry GPS + classifier labels → treat as sensitive operational data.
  6 h TTL means the store self-empties; nothing is a permanent record.
- Per-fleet isolation prevents cross-customer leakage.
- No PII, no user identity — only device `nodeId` (ephemeral, per-launch today).

## 10. Test (curl)
```bash
TOKEN=... URL=https://www.oldcrowswireless.com/api/corvus/findings
# publish
curl -s -XPOST "$URL" -H "x-app-token: $TOKEN" -H "x-fleet-id: demo" \
  -H 'content-type: application/json' \
  -d '{"reports":["{\"v\":1,\"nodeId\":\"n1\",\"seq\":0,\"t\":1751900000000,\"lat\":30.4,\"lon\":-87.2,\"posAcc\":5,\"type\":\"FPV racer\",\"conf\":88,\"rangeFt\":300,\"rangeSd\":null,\"bearing\":-1,\"unknownBuild\":false,\"kind\":\"acoustic\"}"]}'
# -> {"accepted":1}
# pull
curl -s "$URL?since=0" -H "x-app-token: $TOKEN" -H "x-fleet-id: demo"
# -> {"reports":["{...}"]}
```

## Effort
~1 route file (~90 lines) + 1 small client edit + 3 env vars. No new deps
(Upstash + abuseGuard already in ocws-site). Half a day incl. testing/deploy.
```
