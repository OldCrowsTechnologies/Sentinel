/**
 * c2.mjs -- the sensor node's C2 uplink.
 *
 * A NODE IS A HEADLESS DEPUTY. It enrolls with a seat code exactly like a phone
 * does (anonymous auth -> redeem_seat_code -> joined to an org), then inserts
 * detections. That means "route the alert to the right agency" needs no new
 * backend at all: the seat code IS the routing, and per-agency RLS isolation
 * comes along for free. A school district node gets a district code; a patrol
 * car gets the SO's code. See lib/cloudSync.ts for the app-side twin.
 *
 * Plain fetch against Supabase's REST API -- no @supabase/supabase-js, no
 * expo-file-system, nothing that assumes React Native. Node 18+ has fetch.
 *
 * Retry safety is free: detections is unique(org_id, node_id, seq), so a node
 * that buffers through an outage and re-sends later dedups server-side instead
 * of double-alerting a dispatcher. That constraint already exists in
 * supabase/migrations/0001_c2_core.sql -- we just lean on it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = process.env.CORVUS_SESSION || path.join(HERE, '.session.json');

let state = { url: null, anonKey: null, accessToken: null, refreshToken: null, userId: null, orgId: null };

export function loadSession() {
  try {
    const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    state = { ...state, ...s };
    return s;
  } catch {
    return null;
  }
}
function saveSession() {
  // 0600: the refresh token is a credential. Don't leave it world-readable on a
  // box that lives in a school ceiling.
  fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function api(url, opts = {}, { auth = true } = {}) {
  const headers = {
    apikey: state.anonKey,
    'Content-Type': 'application/json',
    ...(auth && state.accessToken ? { Authorization: `Bearer ${state.accessToken}` } : {}),
    ...opts.headers,
  };
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401 && auth && state.refreshToken) {
    await refresh();
    return api(url, opts, { auth });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function refresh() {
  const r = await fetch(`${state.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: state.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: state.refreshToken }),
  });
  if (!r.ok) throw new Error(`token refresh failed: ${r.status}`);
  const j = await r.json();
  state.accessToken = j.access_token;
  state.refreshToken = j.refresh_token;
  saveSession();
}

/**
 * One-time: anonymous auth + redeem the agency seat code. Persists the session
 * so a power-cycled node comes back without re-enrolling.
 */
export async function enroll(url, anonKey, seatCode, callSign) {
  state.url = url;
  state.anonKey = anonKey;

  const signup = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!signup.ok) {
    const b = await signup.text().catch(() => '');
    throw new Error(`anonymous sign-in failed (${signup.status}). Is "Allow anonymous sign-ins" enabled in Supabase Auth? ${b.slice(0, 200)}`);
  }
  const s = await signup.json();
  state.accessToken = s.access_token;
  state.refreshToken = s.refresh_token;
  state.userId = s.user?.id ?? null;

  const orgId = await api(`${url}/rest/v1/rpc/redeem_seat_code`, {
    method: 'POST',
    body: JSON.stringify({ p_code: seatCode.trim(), p_call_sign: callSign || null }),
  });
  state.orgId = typeof orgId === 'string' ? orgId : orgId?.[0] ?? null;
  if (!state.orgId) throw new Error('seat code redeemed but no org returned');
  saveSession();
  return { orgId: state.orgId, userId: state.userId };
}

/**
 * Insert a detection. Mirrors lib/cloudSync.ts:pushDetection field-for-field so
 * a node row and a phone row are indistinguishable to the C2 -- which is the
 * point: one map, many sensor types.
 */
export async function pushDetection(r, extra = {}) {
  if (!state.url || !state.orgId) throw new Error('not enrolled');
  const row = {
    org_id: state.orgId,
    user_id: state.userId,
    node_id: r.nodeId,
    seq: r.seq,
    kind: r.kind, // 'gunshot'
    label: r.type,
    confidence: r.conf,
    band: null,
    peak_db: extra.peakDb ?? null, // muzzle-blast energy proxy (reuses the RF column)
    lat: r.lat,
    lon: r.lon,
    pos_acc: r.posAcc,
    range_ft: r.rangeFt,
    bearing: r.bearing,
    unknown_build: r.unknownBuild,
    ts: new Date(r.t || Date.now()).toISOString(),
  };
  return api(`${state.url}/rest/v1/detections`, {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
}
