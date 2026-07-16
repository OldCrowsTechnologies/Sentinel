/**
 * meshTypes.ts -- the mesh contact-report message and its wire codec (Phase 3).
 *
 * A ContactReport is what one Sentinel node tells the others: "I detected this,
 * here, now." It mirrors threatTracker.Detection almost field-for-field, plus a
 * node id, a per-node sequence number (dedup / loss detection), and a sensor
 * `kind` so the same pipe carries acoustic AND RF (Remote ID / LoRa / Wi-Fi)
 * detections -- mesh fusion and sensor fusion become one mechanism.
 *
 * This module is PURE and self-contained (type-only import) so it unit-tests
 * without any transport, hardware, or React Native runtime -- same discipline as
 * loraDetect.ts. The wire format here is JSON (Tier S / high-bandwidth links,
 * e.g. Nearby Connections). A compact binary packing for Tier L (LoRa, ~40-byte
 * payloads) is a later, separate codec over the SAME fields -- see PHASE3-MESH.md.
 *
 * See docs/PHASE3-MESH.md for the network architecture this feeds.
 */

import type { Detection } from './threatTracker';

/** Bump when the wire shape changes incompatibly. */
export const MESH_PROTO_VERSION = 1;

/**
 * Which sensor produced the report (acoustic today; RF tiers per PHASE2-RF.md;
 * `gunshot` per SENTINEL-SHOTS-FIRED.md).
 *
 * `gunshot` is a SENSOR TYPE, not a second product: a shot rides the same pipe,
 * the same fusion, the same per-agency RLS and the same C2 map/log/alerting as a
 * drone contact. Adding a kind is the whole integration -- that unified pane is
 * the point. See docs/SENTINEL-SHOTS-FIRED.md §0.
 */
export type ContactKind = 'acoustic' | 'rid' | 'lora' | 'wifi' | 'gunshot';

export interface ContactReport {
  v: number; // proto version (MESH_PROTO_VERSION)
  nodeId: string; // stable per-device short id
  seq: number; // monotonic per node (dedup / loss detection)
  t: number; // GPS-based epoch ms (shared clock); ordering key
  // Reporting node's own position + accuracy at detection (meters). Null when
  // GPS is unavailable or denied -- fusion must treat null honestly, not as 0.
  lat: number | null;
  lon: number | null;
  posAcc: number | null;
  type: string; // classifier label (e.g. "Skydio X2", "Unknown")
  conf: number; // 0-100, matches Detection.confidence (no lossy 0..1 rescale)
  rangeFt: number; // node's range estimate to the contact
  rangeSd: number | null; // 1σ on rangeFt; null until per-device range calibration
  bearing: number; // degrees, or -1 = none (mono mic)
  unknownBuild: boolean; // open-set "possible homemade" flag (the differentiator)
  kind: ContactKind;
  // Extended acoustic fields -- OPTIONAL, carried on Tier S (JSON) only; omitted
  // from compact Tier-L packing. Useful for cross-node track merge + detail card.
  estFundamentalHz?: number | null;
  sizeClass?: 'small' | 'medium' | 'large' | null;
  oodScore?: number | null;
}

const KINDS: ReadonlySet<string> = new Set(['acoustic', 'rid', 'lora', 'wifi', 'gunshot']);

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function isNumOrNull(x: unknown): x is number | null {
  return x === null || isNum(x);
}

/**
 * Build a broadcastable report from a local Detection. The caller owns the
 * node's stable `nodeId` and its monotonic `seq` (both are node-lifecycle
 * concerns, wired in App.tsx). `kind` defaults to acoustic.
 */
export function reportFromDetection(
  d: Detection,
  nodeId: string,
  seq: number,
  kind: ContactKind = 'acoustic'
): ContactReport {
  return {
    v: MESH_PROTO_VERSION,
    nodeId,
    seq,
    t: d.timestamp || 0,
    lat: d.lat ?? null,
    lon: d.lon ?? null,
    posAcc: d.locationAccuracy ?? null,
    type: d.label,
    conf: d.confidence,
    rangeFt: d.distance,
    rangeSd: null, // populated once refRms/refDistanceFeet calibration exists
    bearing: d.bearing,
    unknownBuild: d.isUnknownBuild ?? false,
    kind,
    estFundamentalHz: d.estFundamentalHz ?? null,
    sizeClass: d.sizeClass ?? null,
    oodScore: d.oodScore ?? null,
  };
}

/** Serialize a report for a Tier-S (JSON) link. */
export function encodeReport(r: ContactReport): string {
  return JSON.stringify(r);
}

/**
 * Parse + VALIDATE a received report. Returns null on anything malformed --
 * this is a network boundary, so treat bad input as noise, never as a throw.
 * A wrong-version report is rejected too (null) so a peer can't corrupt state
 * with a shape we don't understand.
 */
export function decodeReport(raw: string): ContactReport | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof o !== 'object' || o === null) return null;
  const r = o as Record<string, unknown>;

  if (r.v !== MESH_PROTO_VERSION) return null;
  if (typeof r.nodeId !== 'string' || r.nodeId.length === 0) return null;
  if (!isNum(r.seq) || r.seq < 0 || !Number.isInteger(r.seq)) return null;
  if (!isNum(r.t)) return null;
  if (!isNumOrNull(r.lat) || !isNumOrNull(r.lon) || !isNumOrNull(r.posAcc)) return null;
  if (typeof r.type !== 'string' || r.type.length === 0) return null;
  if (!isNum(r.conf)) return null;
  if (!isNum(r.rangeFt)) return null;
  if (!isNumOrNull(r.rangeSd)) return null;
  if (!isNum(r.bearing)) return null;
  if (typeof r.unknownBuild !== 'boolean') return null;
  if (typeof r.kind !== 'string' || !KINDS.has(r.kind)) return null;

  const out: ContactReport = {
    v: r.v,
    nodeId: r.nodeId,
    seq: r.seq,
    t: r.t,
    lat: r.lat as number | null,
    lon: r.lon as number | null,
    posAcc: r.posAcc as number | null,
    type: r.type,
    conf: r.conf,
    rangeFt: r.rangeFt,
    rangeSd: r.rangeSd as number | null,
    bearing: r.bearing,
    unknownBuild: r.unknownBuild,
    kind: r.kind as ContactKind,
  };
  // Extended optional fields: keep only if the right shape; ignore junk.
  if (isNumOrNull(r.estFundamentalHz)) out.estFundamentalHz = r.estFundamentalHz as number | null;
  if (r.sizeClass === 'small' || r.sizeClass === 'medium' || r.sizeClass === 'large' || r.sizeClass === null) {
    out.sizeClass = r.sizeClass;
  }
  if (isNumOrNull(r.oodScore)) out.oodScore = r.oodScore as number | null;
  return out;
}
