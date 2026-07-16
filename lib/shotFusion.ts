/**
 * shotFusion.ts -- collapse many nodes' reports of ONE shot into ONE located
 * event. This is the "centralized fusion" step of SENTINEL-SHOTS-FIRED-ARCH.md
 * §3/§4: nodes each report independently; fusion (at the gateway or C2) decides
 * they're the same event and produces the located alert.
 *
 * This implements the COARSE rung of the localization ladder (§4): the shot is
 * located to the region the hearing nodes cover -- a confidence-weighted centroid
 * of the nodes that heard it, with an honest uncertainty radius. It is NOT TDOA;
 * it needs no clock sync beyond "same ~2 s". Range-only (Method A) and TDOA
 * (Method B) refine the SAME event object later without changing this interface.
 *
 * PURE + self-contained -- unit-tests with no transport. Same discipline as the
 * rest of lib/.
 *
 * Honesty rules baked in:
 *  - one node = NOT a location, it's "at this node ± acoustic range". Flagged
 *    `single`, never dressed up as a fix.
 *  - the event carries a radius, so the UI shows a region/ellipse, never a false pin.
 *  - two nodes agreeing raises corroboration -- the multi-listener FP kill from
 *    PHASE3-MESH -- but confidence is reported honestly, not inflated to 100.
 */

export interface ShotObservation {
  nodeId: number | string;
  tMs: number; // wall-clock ms (use fromMeshSec() if it arrived over LoRa)
  lat: number | null;
  lon: number | null;
  conf: number; // 0..100
  peakDb: number;
  shotCount: number;
  label: number; // LABEL enum (0 = unclassified)
}

export interface ShotEvent {
  eventId: string; // stable across gateways -> C2 dedup key
  tMs: number; // earliest observation
  lat: number | null; // coarse location (weighted centroid), or the lone node
  lon: number | null;
  radiusM: number | null; // uncertainty radius (null = single node, unknown)
  quality: 'single' | 'coarse-region';
  hearingNodes: (number | string)[];
  corroboration: number; // how many nodes heard it (== hearingNodes.length)
  shotCount: number; // best estimate (max across nodes)
  label: number; // majority vote
  conf: number; // 0..100, honest (max node conf; NOT summed)
  peakDb: number; // loudest node's muzzle-blast energy over floor
}

export interface FusionOptions {
  windowMs?: number; // max time spread within one event (default 2000)
  maxSeparationM?: number; // split a time-cluster if nodes are farther apart (default 1500)
}

const R_EARTH_M = 6371000;
export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Group observations into events and locate each. Order-independent: the same
 * set of observations yields the same events with the same eventIds regardless
 * of arrival order -- required so two gateways forwarding overlapping views of
 * one shot dedup to a single row at C2.
 */
export function fuseShots(obs: ShotObservation[], opts: FusionOptions = {}): ShotEvent[] {
  const windowMs = opts.windowMs ?? 2000;
  const maxSep = opts.maxSeparationM ?? 1500;
  if (obs.length === 0) return [];

  const sorted = [...obs].sort((a, b) => a.tMs - b.tMs);

  // 1) time-cluster: a new cluster starts when the gap from the cluster's FIRST
  //    observation exceeds the window. One shot reaches every node within
  //    propagation + clock skew (<~2 s); events further apart split naturally.
  const timeClusters: ShotObservation[][] = [];
  for (const o of sorted) {
    const cur = timeClusters[timeClusters.length - 1];
    if (cur && o.tMs - cur[0].tMs <= windowMs) cur.push(o);
    else timeClusters.push([o]);
  }

  // 2) spatial split: two simultaneous shootings far apart share a time cluster
  //    but not a place. Split greedily by proximity to an existing subcluster.
  const clusters: ShotObservation[][] = [];
  for (const tc of timeClusters) {
    const subs: ShotObservation[][] = [];
    for (const o of tc) {
      if (o.lat == null || o.lon == null) {
        // No position -> can't spatially place it; attach to the first sub
        // (it still corroborates timing + shot count).
        if (subs.length === 0) subs.push([]);
        subs[0].push(o);
        continue;
      }
      let placed = false;
      for (const s of subs) {
        const ref = s.find((x) => x.lat != null && x.lon != null);
        if (!ref || haversineM(ref.lat as number, ref.lon as number, o.lat, o.lon) <= maxSep) {
          s.push(o);
          placed = true;
          break;
        }
      }
      if (!placed) subs.push([o]);
    }
    clusters.push(...subs);
  }

  return clusters.map(locate);
}

function locate(group: ShotObservation[]): ShotEvent {
  const positioned = group.filter((o) => o.lat != null && o.lon != null);
  const tMs = Math.min(...group.map((o) => o.tMs));
  const hearingNodes = group.map((o) => o.nodeId);
  const shotCount = Math.max(...group.map((o) => o.shotCount));
  const conf = Math.max(...group.map((o) => o.conf));
  const peakDb = Math.max(...group.map((o) => o.peakDb));

  // majority-vote the weapon label (P2; all 0 in P1)
  const votes = new Map<number, number>();
  for (const o of group) votes.set(o.label, (votes.get(o.label) ?? 0) + 1);
  let label = 0;
  let best = -1;
  for (const [lab, n] of votes) if (n > best) ((best = n), (label = lab));

  let lat: number | null = null;
  let lon: number | null = null;
  let radiusM: number | null = null;
  let quality: ShotEvent['quality'] = 'single';

  if (positioned.length >= 1) {
    // confidence-weighted centroid: loudest/most-confident node ~ closest ~ best
    // guess of where the shot was. Honest, coarse.
    let wSum = 0;
    let latSum = 0;
    let lonSum = 0;
    for (const o of positioned) {
      const w = Math.max(1, o.conf);
      wSum += w;
      latSum += (o.lat as number) * w;
      lonSum += (o.lon as number) * w;
    }
    lat = latSum / wSum;
    lon = lonSum / wSum;
    if (positioned.length >= 2) {
      quality = 'coarse-region';
      radiusM = Math.max(
        ...positioned.map((o) => haversineM(lat as number, lon as number, o.lat as number, o.lon as number))
      );
    }
    // single positioned node stays quality='single', radiusM=null: it's AT that
    // node ± acoustic range, which we deliberately do not fabricate here.
  }

  return {
    eventId: makeEventId(tMs, lat, lon),
    tMs,
    lat,
    lon,
    radiusM,
    quality,
    hearingNodes,
    corroboration: hearingNodes.length,
    shotCount,
    label,
    conf,
    peakDb,
  };
}

/**
 * Stable spatio-temporal bucket id -- NOT keyed on the node set. Two gateways
 * that heard DIFFERENT subsets of the same shot (node 6 out of range of gateway
 * B) still land in the same ~2 s x ~110 m bucket -> same id -> C2 dedups them to
 * one row. Cost: two genuinely-distinct events within 2 s AND 110 m collide --
 * rare, and they are effectively the same incident anyway.
 */
export function makeEventId(tMs: number, lat: number | null, lon: number | null): string {
  const tBucket = Math.floor(tMs / 2000);
  if (lat == null || lon == null) return `evt-${tBucket}-nopos`;
  const la = Math.round(lat * 1000); // ~110 m
  const lo = Math.round(lon * 1000);
  return `evt-${tBucket}-${la}-${lo}`;
}

/** Map an eventId to a stable 31-bit int for the detections (org,node,seq) key. */
export function eventSeq(eventId: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < eventId.length; i++) {
    h ^= eventId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h & 0x7fffffff;
}
