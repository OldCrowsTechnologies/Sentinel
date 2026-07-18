/**
 * cloudSync.ts -- the C2 cloud tier: streams this deputy's positions + detections
 * to a multi-tenant Supabase backend and subscribes to the live fleet picture for
 * their agency (org). Row-Level Security (see supabase/migrations/0001_c2_core.sql)
 * guarantees a device only ever sees its own agency's data.
 *
 * Deployment model: sell SEAT CODES per agency; a deputy enrolls once with a code
 * (enrollWithCode) -> anonymous auth + redeem_seat_code -> joined to the org. From
 * then on positions upsert and detections insert, and every app + the C2 dashboard
 * in that org see them in real time. Detections reach C2 the instant they insert,
 * independent of any push notification.
 *
 * Config (anon key is PUBLIC-SAFE by design -- RLS is the guard; the service_role
 * key must NEVER be bundled, per [[no-client-bundled-secrets]]):
 *   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY
 * Unset -> every function here is an inert no-op and the app behaves as it does
 * today (offline/standalone). Requires the native dev/standalone build.
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { ContactReport } from './meshTypes';
import type { GeoFix } from './locationService';
import type { RfLinkDetection } from './rfSensorService';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export interface FleetPosition {
  user_id: string;
  org_id: string;
  call_sign: string | null;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  ts: string;
}

export function cloudConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

// ---- session persistence (file-backed; RN has no localStorage) -------------
const AUTH_FILE = (FileSystem.documentDirectory || '') + 'corvus-cloud-auth.json';
async function readAuth(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(AUTH_FILE));
  } catch {
    return {};
  }
}
const fileStorage = {
  getItem: async (k: string) => (await readAuth())[k] ?? null,
  setItem: async (k: string, v: string) => {
    const o = await readAuth();
    o[k] = v;
    await FileSystem.writeAsStringAsync(AUTH_FILE, JSON.stringify(o));
  },
  removeItem: async (k: string) => {
    const o = await readAuth();
    delete o[k];
    await FileSystem.writeAsStringAsync(AUTH_FILE, JSON.stringify(o));
  },
};

// ---- lazy client (defensive: absent native module / unconfigured -> null) --
let supa: any = null;
let userId: string | null = null;
let orgId: string | null = null;
let orgName: string | null = null;
let callSign: string | null = null; // this device's unit label, shown in C2

function loadClient(): any {
  if (supa || !cloudConfigured()) return supa;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require('@supabase/supabase-js');
    supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storage: fileStorage as any, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  } catch {
    supa = null;
  }
  return supa;
}

/** Restore an existing session (call at startup). Returns the org id if enrolled. */
export async function initCloud(): Promise<string | null> {
  const c = loadClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  if (!data?.session) return null;
  userId = data.session.user?.id ?? null;
  callSign = await fileStorage.getItem('call_sign');
  const { data: rows } = await c.from('org_members').select('org_id, call_sign').eq('active', true).limit(1);
  orgId = rows?.[0]?.org_id ?? null;
  if (!callSign && rows?.[0]?.call_sign) callSign = rows[0].call_sign;
  if (orgId) {
    const { data: o } = await c.from('orgs').select('name').eq('id', orgId).single();
    orgName = o?.name ?? null;
  }
  return orgId;
}

export function isEnrolled(): boolean {
  return !!orgId && !!userId;
}
export function currentOrg(): string | null {
  return orgId;
}

/** Enroll this device with an agency seat code + call sign (one-time). */
export async function enrollWithCode(
  code: string,
  cs?: string
): Promise<{ orgId: string; orgName: string | null; callSign: string | null }> {
  const c = loadClient();
  if (!c) throw new Error('cloud not configured');
  const sess = await c.auth.getSession();
  if (!sess.data?.session) {
    const { error } = await c.auth.signInAnonymously();
    if (error) throw error;
  }
  const who = await c.auth.getUser();
  userId = who.data?.user?.id ?? null;
  const trimmed = cs?.trim() || null;
  const { data, error } = await c.rpc('redeem_seat_code', { p_code: code.trim(), p_call_sign: trimmed });
  if (error) throw error;
  orgId = data as string;
  if (trimmed) {
    callSign = trimmed;
    await fileStorage.setItem('call_sign', trimmed);
  }
  const { data: o } = await c.from('orgs').select('name').eq('id', orgId).single();
  orgName = o?.name ?? null;
  return { orgId: orgId!, orgName, callSign };
}

/** Snapshot of C2 link state for the Settings UI. */
export function getEnrollment(): {
  configured: boolean;
  enrolled: boolean;
  orgId: string | null;
  orgName: string | null;
  callSign: string | null;
} {
  return { configured: cloudConfigured(), enrolled: isEnrolled(), orgId, orgName, callSign };
}

/** Unlink this device from C2 (demo re-enroll / hand-off to another agency). */
export async function signOutCloud(): Promise<void> {
  const c = loadClient();
  if (c) { try { await c.auth.signOut(); } catch { /* already gone */ } }
  userId = orgId = orgName = callSign = null;
  await fileStorage.removeItem('call_sign');
}

/** Upsert this deputy's live position. No-op until enrolled. */
export async function pushPosition(fix: GeoFix, cs?: string): Promise<void> {
  const c = loadClient();
  if (!c || !orgId || !userId) return;
  await c.from('positions').upsert({
    user_id: userId,
    org_id: orgId,
    call_sign: cs ?? callSign ?? null,
    lat: fix.lat,
    lon: fix.lon,
    accuracy_m: fix.accuracy ?? null,
    ts: new Date().toISOString(),
  });
}

/** Publish a detection to C2. Idempotent via (org_id,node_id,seq). No-op until enrolled. */
export async function pushDetection(r: ContactReport): Promise<void> {
  const c = loadClient();
  if (!c || !orgId || !userId) return;
  await c.from('detections').upsert(
    {
      org_id: orgId,
      user_id: userId,
      node_id: r.nodeId,
      seq: r.seq,
      kind: r.kind,
      label: r.type,
      confidence: r.conf,
      band: null,
      peak_db: null,
      lat: r.lat,
      lon: r.lon,
      pos_acc: r.posAcc,
      range_ft: r.rangeFt,
      bearing: r.bearing,
      unknown_build: r.unknownBuild,
      ts: new Date(r.t || Date.now()).toISOString(),
    },
    { onConflict: 'org_id,node_id,seq', ignoreDuplicates: true }
  );
}

/** Human-readable call-out per RF control-link kind (shown on the C2 log/map). */
const RF_KIND_LABEL: Record<RfLinkDetection['kind'], string> = {
  lora: 'LoRa link',
  elrs: 'ExpressLRS',
  ocusync: 'OcuSync',
  'control-link': 'Control link',
  unknown: 'RF link',
};

/**
 * Publish an RF control-link detection (ELRS / LoRa / etc., sniffed by the SDR
 * dongle) to C2 so command sees sub-GHz control links the instant they're heard.
 * Presence-only: range_ft = 0 and bearing = -1 unless a directional antenna gave
 * one (the dongle can't range or (mono) bearing). Rides the same `detections`
 * table + (org,node,seq) dedup as acoustic contacts. No-op until enrolled.
 */
export async function pushRfLink(
  link: RfLinkDetection,
  fix: GeoFix | null,
  nodeId: string,
  seq: number
): Promise<void> {
  const c = loadClient();
  if (!c || !orgId || !userId) return;
  await c.from('detections').upsert(
    {
      org_id: orgId,
      user_id: userId,
      node_id: nodeId,
      seq,
      kind: link.kind,
      label: RF_KIND_LABEL[link.kind] ?? 'RF link',
      // score is a dB strength (peak-over-floor), not a %; C2 shows band + peak_db
      // for RF rows. Stored clamped so the numeric column stays sane.
      confidence: Math.round(Math.max(0, Math.min(100, link.score))),
      band: link.band,
      peak_db: Math.round(link.peakDb),
      lat: fix?.lat ?? null,
      lon: fix?.lon ?? null,
      pos_acc: fix?.accuracy ?? null,
      range_ft: 0,
      bearing: link.bearing ?? -1,
      unknown_build: false,
      ts: new Date(link.timestamp || Date.now()).toISOString(),
    },
    { onConflict: 'org_id,node_id,seq', ignoreDuplicates: true }
  );
}

export interface FleetHandlers {
  onPosition?: (p: FleetPosition) => void;
  onDetection?: (d: Record<string, unknown>) => void;
}

/**
 * Subscribe to the live fleet: initial snapshot + Realtime deltas for this org
 * (RLS-scoped). Returns an unsubscribe fn. No-op (returns () => {}) until enrolled.
 */
export function subscribeFleet(h: FleetHandlers): () => void {
  const c = loadClient();
  if (!c || !orgId) return () => {};

  // initial snapshot
  void (async () => {
    const { data: pos } = await c.from('positions').select('*');
    pos?.forEach((p: FleetPosition) => h.onPosition?.(p));
    const { data: det } = await c.from('detections').select('*').order('ts', { ascending: false }).limit(100);
    det?.forEach((d: Record<string, unknown>) => h.onDetection?.(d));
  })();

  const channel = c
    .channel(`fleet:${orgId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'positions' }, (payload: any) =>
      h.onPosition?.(payload.new as FleetPosition)
    )
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'detections' }, (payload: any) =>
      h.onDetection?.(payload.new as Record<string, unknown>)
    )
    .subscribe();

  return () => {
    try {
      c.removeChannel(channel);
    } catch {
      /* already gone */
    }
  };
}

/** Register/refresh this device's Expo push token so C2 can alert it. */
export async function registerPushToken(token: string, platform: string): Promise<void> {
  const c = loadClient();
  if (!c || !orgId || !userId) return;
  await c.from('devices').upsert(
    { user_id: userId, org_id: orgId, push_token: token, platform, last_seen: new Date().toISOString() },
    { onConflict: 'user_id,push_token' }
  );
}
