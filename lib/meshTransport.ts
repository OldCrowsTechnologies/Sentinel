/**
 * meshTransport.ts -- offline node-to-node mesh transport (Phase 3) scaffold.
 *
 * SLAVED OFF until a native P2P transport is integrated. Sentinel deploys
 * COMPLETELY OFFLINE (no internet/cell), so node discovery and message passing
 * must be infrastructure-free: Android Nearby Connections / Wi-Fi Aware for the
 * short-range/high-bandwidth tier, LoRa for the long-range/low-bandwidth tier
 * (see docs/PHASE3-MESH.md). None of those exist in Expo Go, so today this
 * module reports "no transport" and broadcasts are no-ops.
 *
 * This is the integration seam, modeled exactly on rfSensorService.ts:
 *   - flip MESH_TRANSPORT_AVAILABLE + implement startMesh/broadcastReport when a
 *     native transport module lands;
 *   - a native receive callback pushes raw frames into `ingestRaw()`.
 * `ingestRaw()` is the analog of rfSensorService.processIqFrame(): it is FULLY
 * IMPLEMENTED and unit-tested (decode -> dedup -> emit) and works the moment real
 * frames arrive. Nothing here transmits while slaved off.
 */

// Explicit .ts extension (unlike other lib files) so this module resolves under
// `node --experimental-strip-types --test` as well as Metro/tsc -- it lets the
// receive path (ingestRaw) be unit-tested. Enabled by allowImportingTsExtensions
// in tsconfig.json (safe under the base config's noEmit).
import { decodeReport, encodeReport, type ContactReport } from './meshTypes.ts';

export type MeshTransportKind = 'nearby' | 'wifi-aware' | 'lora' | 'none';

export interface MeshStatus {
  available: boolean;
  transport: MeshTransportKind;
  peers: number;
  note: string;
}

/** Hard gate: no field transport until a native P2P module is integrated. */
const MESH_TRANSPORT_AVAILABLE = false;

// Bounded replay/dup guard. Mesh floods deliver the same report by multiple
// paths and out of order; drop anything we've already emitted, keyed nodeId:seq.
const SEEN_CAP = 512;
const seen = new Set<string>();
const seenOrder: string[] = [];

let onReport: ((r: ContactReport, fromPeer?: string) => void) | null = null;

function markSeen(key: string): void {
  seen.add(key);
  seenOrder.push(key);
  if (seenOrder.length > SEEN_CAP) {
    const evicted = seenOrder.shift();
    if (evicted !== undefined) seen.delete(evicted);
  }
}

export function getMeshStatus(): MeshStatus {
  return {
    available: false,
    transport: 'none',
    peers: 0,
    note: 'No mesh transport connected. Offline node-to-node linking is disabled.',
  };
}

/**
 * Register the sink for reports received from peers and start the transport.
 * Returns false while slaved off (no native transport yet), but the sink is set
 * so the receive path (ingestRaw) is live and testable immediately -- same shape
 * as rfSensorService.startLinkScan.
 */
export async function startMesh(
  cb: (r: ContactReport, fromPeer?: string) => void
): Promise<boolean> {
  onReport = cb;
  if (!MESH_TRANSPORT_AVAILABLE) return false;
  // TODO(native): start Nearby Connections / Wi-Fi Aware (and/or LoRa) advertise
  // + discover; on each received frame, call ingestRaw(frame, peerId).
  return false;
}

export function stopMesh(): void {
  onReport = null;
}

/**
 * Broadcast one local report to peers. Encodes to the Tier-S wire format and
 * hands it to the native transport. No-op while slaved off (returns false) --
 * the exterior links stay inert, matching the offline-by-default posture.
 */
export function broadcastReport(r: ContactReport): boolean {
  const wire = encodeReport(r);
  if (!MESH_TRANSPORT_AVAILABLE) return false;
  // TODO(native): hand `wire` to the transport's send (flood to connected peers).
  void wire;
  return true;
}

/**
 * Ingest one raw frame received from a peer. Decodes + validates, drops replays
 * and self-echoes via the nodeId:seq guard, and emits to the registered sink.
 * THIS is where the native receive callback pushes bytes; it is fully
 * implemented + unit-tested and works the instant real frames arrive.
 *
 * @returns the accepted report, or null if malformed or a duplicate.
 */
export function ingestRaw(raw: string, fromPeer?: string): ContactReport | null {
  const r = decodeReport(raw);
  if (!r) return null; // malformed / wrong version -- treat as noise
  const key = `${r.nodeId}:${r.seq}`;
  if (seen.has(key)) return null; // already handled (flood dup / replay)
  markSeen(key);
  onReport?.(r, fromPeer);
  return r;
}

/** Clear sink + dedup state (test isolation / session reset). */
export function resetMesh(): void {
  onReport = null;
  seen.clear();
  seenOrder.length = 0;
}
