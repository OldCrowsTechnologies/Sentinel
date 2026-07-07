/**
 * findingsSync.ts -- the INTERNET tier of fleet sync. Offline-first: local
 * contact findings queue on-device and, whenever a device has a network, they
 * auto-publish to a shared endpoint and this node pulls peers' findings so every
 * device converges on the same picture.
 *
 * This complements lib/meshTransport.ts (the OFFLINE peer-to-peer tier, which
 * needs a native P2P module and is slaved off today). Both feed the SAME sink:
 * pulled reports go through meshTransport.ingestRaw() -> the mesh receive
 * callback -> meshFusion, so a finding from any tier is deduped + fused
 * identically. No sign-in, no gate -- purely opportunistic.
 *
 * Endpoint via EXPO_PUBLIC_CORVUS_FINDINGS_URL (mirrors specimenSync's library
 * URL). Until that receiver is stood up on the OCWS site, findings simply queue
 * locally -- nothing is lost, and a pure air-gapped deployment (no reachable
 * endpoint) just no-ops.
 */

import * as Network from 'expo-network';
import { encodeReport, type ContactReport } from './meshTypes';
import { ingestRaw } from './meshTransport';

const DEFAULT_FINDINGS_URL = 'https://www.oldcrowswireless.com/api/corvus/findings';
const FINDINGS_URL = process.env.EXPO_PUBLIC_CORVUS_FINDINGS_URL || DEFAULT_FINDINGS_URL;

// Offline-first outbound queue of locally-detected findings awaiting publish.
const outbox: ContactReport[] = [];
const OUTBOX_CAP = 1000; // bound memory if we stay offline a long time
let lastPullT = 0; // high-water mark (report.t) for incremental peer pulls

export function findingsConfigured(): boolean {
  return FINDINGS_URL.length > 0;
}

export async function isOnline(): Promise<boolean> {
  try {
    const s = await Network.getNetworkStateAsync();
    return !!s.isConnected && s.isInternetReachable !== false;
  } catch {
    return false;
  }
}

/** Queue one local finding for publish. Call alongside meshTransport.broadcastReport. */
export function queueFinding(r: ContactReport): void {
  outbox.push(r);
  if (outbox.length > OUTBOX_CAP) outbox.splice(0, outbox.length - OUTBOX_CAP);
}

export function pendingFindings(): number {
  return outbox.length;
}

/**
 * Publish queued findings + pull peers' findings. Best-effort and idempotent, so
 * it's safe to call on connectivity, on a timer, or on demand. No-ops offline or
 * when no endpoint is configured (the queue just waits for the next network).
 *
 * @param selfNodeId this node's id, so echoed-back own reports are skipped.
 */
export async function syncFindings(
  selfNodeId?: string
): Promise<{ published: number; received: number }> {
  if (!findingsConfigured() || !(await isOnline())) {
    return { published: 0, received: 0 };
  }

  // 1) PUBLISH: flush the outbox as a single batch.
  let published = 0;
  if (outbox.length > 0) {
    const batch = outbox.slice();
    try {
      const res = await fetch(FINDINGS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reports: batch.map(encodeReport) }),
      });
      if (res.ok) {
        outbox.splice(0, batch.length); // only drop what we actually sent
        published = batch.length;
      }
    } catch {
      // network dropped mid-publish -- leave the outbox for the next attempt
    }
  }

  // 2) PULL: fetch peers' findings since our high-water mark and fuse them.
  let received = 0;
  try {
    const sep = FINDINGS_URL.includes('?') ? '&' : '?';
    const res = await fetch(`${FINDINGS_URL}${sep}since=${lastPullT}`, { method: 'GET' });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const items: unknown[] = Array.isArray(data?.reports) ? data.reports : [];
      for (const item of items) {
        const raw = typeof item === 'string' ? item : JSON.stringify(item);
        // ingestRaw decodes + validates + dedups (nodeId:seq) and emits to the
        // mesh sink -> fusion. Skip our own echoed reports (already fused locally).
        const r = ingestRaw(raw);
        if (r) {
          if (selfNodeId && r.nodeId === selfNodeId) continue;
          received++;
          if (r.t > lastPullT) lastPullT = r.t;
        }
      }
    }
  } catch {
    // pull failed -- non-fatal; we'll catch up next sync
  }

  return { published, received };
}

/** Reset outbox + pull cursor (session reset / testing). */
export function resetFindingsSync(): void {
  outbox.length = 0;
  lastPullT = 0;
}
