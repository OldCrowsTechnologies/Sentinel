/**
 * meshFusion.ts -- cross-node fusion: turn many ContactReports into located
 * tracks with an honest uncertainty ellipse (Phase 3, Method A: range-only
 * multilateration). See docs/PHASE3-MESH.md.
 *
 * Pipeline:
 *   1. CLUSTER reports into tracks (same type + contemporaneous). Generalizes
 *      threatTracker's single-node dedup (type + distance) to cross-node.
 *   2. MULTILATERATE each track from the nodes' known GPS positions + range
 *      estimates: find the point whose predicted ranges best fit the measured
 *      ones (weighted Gauss-Newton, grid-seeded to dodge the range-only mirror
 *      minimum). Weight by confidence and range uncertainty.
 *   3. ELLIPSE from the solver's covariance -- the fix is a region, never a bare
 *      pin. Quality degrades honestly: <3 positioned nodes = no fix.
 *
 * The engine is deliberately structured around per-node residuals so bearing
 * (AoA) and TDOA terms can be added later as extra rows without reworking the
 * solve -- the "same solver, different terms" rule from the design doc.
 *
 * Pure + dependency-free (type-only import, erased at runtime) so it unit-tests
 * with no transport/hardware/RN runtime -- same discipline as loraDetect.ts.
 */

import type { ContactReport } from './meshTypes';

const FT_TO_M = 0.3048;
const EARTH_R = 6378137; // WGS84 mean radius (m)

// Range-error model used when a report carries no calibrated rangeSd: RMS-based
// range gets rougher with distance, so 1σ scales with range (floored). Honest
// stand-in until refRms/refDistanceFeet calibration exists.
const RANGE_REL_SD = 0.3;
const MIN_SD_M = 15;

const GRID_N = 21; // coarse-search resolution per axis (seed for Gauss-Newton)
const GN_ITERS = 12;
const LM_DAMP = 1e-6; // tiny Levenberg damping for numerical stability

export type FixQuality = 'none' | 'weak' | 'ok';

export interface UncertaintyEllipse {
  semiMajorM: number; // 1σ
  semiMinorM: number; // 1σ
  orientationDeg: number; // bearing of the major axis (0 = north, CW)
}

export interface FusedTrack {
  type: string;
  lat: number | null; // fused position; null when no fix is possible
  lon: number | null;
  ellipse: UncertaintyEllipse | null;
  fixQuality: FixQuality;
  nodeCount: number; // distinct positioned nodes used in the solve
  contributingNodes: string[]; // all nodes that reported this track
  firstSeen: number;
  lastSeen: number;
  degradedReason?: string; // why the fix is absent/weak (shown honestly in UI)
}

export interface FuseOptions {
  clusterWindowMs?: number; // reports of a type within this gap = one track
}

// --- geo helpers (local equirectangular frame; flat-earth ok at AO scale) ---

const d2r = (d: number) => (d * Math.PI) / 180;
const r2d = (r: number) => (r * 180) / Math.PI;

/** lat/lon -> local meters (east, north) about a reference point. */
export function toLocalMeters(
  lat: number,
  lon: number,
  lat0: number,
  lon0: number
): { x: number; y: number } {
  const x = d2r(lon - lon0) * Math.cos(d2r(lat0)) * EARTH_R;
  const y = d2r(lat - lat0) * EARTH_R;
  return { x, y };
}

/** local meters (east, north) -> lat/lon about a reference point. */
export function localToLatLon(
  lat0: number,
  lon0: number,
  x: number,
  y: number
): { lat: number; lon: number } {
  const lat = lat0 + r2d(y / EARTH_R);
  const lon = lon0 + r2d(x / (EARTH_R * Math.cos(d2r(lat0))));
  return { lat, lon };
}

// --- clustering ---

function reduceToLatestPerNode(reports: ContactReport[]): ContactReport[] {
  const best = new Map<string, ContactReport>();
  for (const r of reports) {
    const cur = best.get(r.nodeId);
    if (!cur || r.t > cur.t || (r.t === cur.t && r.conf > cur.conf)) best.set(r.nodeId, r);
  }
  return Array.from(best.values());
}

/**
 * Group reports into per-track clusters: same `type`, split where the time gap
 * between consecutive same-type reports exceeds the window. Assumes at most one
 * contact of a given type in the AO at a time -- a Step-2 simplification stated
 * honestly (multiple same-type drones need a post-fix spatial split).
 */
function clusterReports(reports: ContactReport[], windowMs: number): ContactReport[][] {
  const byType = new Map<string, ContactReport[]>();
  for (const r of reports) {
    if (r.type === 'None') continue; // not a contact
    const arr = byType.get(r.type);
    if (arr) arr.push(r);
    else byType.set(r.type, [r]);
  }
  const clusters: ContactReport[][] = [];
  for (const arr of byType.values()) {
    arr.sort((a, b) => a.t - b.t);
    let cur: ContactReport[] = [];
    let last = -Infinity;
    for (const r of arr) {
      if (cur.length && r.t - last > windowMs) {
        clusters.push(cur);
        cur = [];
      }
      cur.push(r);
      last = r.t;
    }
    if (cur.length) clusters.push(cur);
  }
  return clusters;
}

// --- range-only multilateration ---

interface NodeRange {
  x: number;
  y: number;
  r: number; // range (m)
  w: number; // weight = conf / σ²
}

function nodeRangesFrom(reports: ContactReport[], lat0: number, lon0: number): NodeRange[] {
  const out: NodeRange[] = [];
  for (const rep of reports) {
    if (rep.lat == null || rep.lon == null) continue; // unpositioned node
    const { x, y } = toLocalMeters(rep.lat, rep.lon, lat0, lon0);
    const rM = rep.rangeFt * FT_TO_M;
    const sd = rep.rangeSd != null ? rep.rangeSd * FT_TO_M : Math.max(RANGE_REL_SD * rM, MIN_SD_M);
    const conf = Math.max(rep.conf, 1) / 100;
    out.push({ x, y, r: rM, w: conf / (sd * sd) });
  }
  return out;
}

function cost(nodes: NodeRange[], px: number, py: number): number {
  let c = 0;
  for (const n of nodes) {
    const d = Math.hypot(px - n.x, py - n.y);
    const e = d - n.r;
    c += n.w * e * e;
  }
  return c;
}

/** Coarse grid seed over the nodes' bounding box, expanded by the max range. */
function gridSeed(nodes: NodeRange[]): { x: number; y: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxR = 0;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    maxR = Math.max(maxR, n.r);
  }
  minX -= maxR; maxX += maxR; minY -= maxR; maxY += maxR;
  let best = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  let bestC = Infinity;
  for (let i = 0; i < GRID_N; i++) {
    const px = minX + ((maxX - minX) * i) / (GRID_N - 1);
    for (let j = 0; j < GRID_N; j++) {
      const py = minY + ((maxY - minY) * j) / (GRID_N - 1);
      const c = cost(nodes, px, py);
      if (c < bestC) { bestC = c; best = { x: px, y: py }; }
    }
  }
  return best;
}

interface SolveResult {
  x: number;
  y: number;
  cov: [number, number, number]; // [Cxx, Cxy, Cyy]
  ok: boolean;
}

/** Weighted Gauss-Newton on range residuals fᵢ = ‖p−xᵢ‖ − rᵢ. */
function multilaterate(nodes: NodeRange[]): SolveResult {
  let { x, y } = gridSeed(nodes);
  let H11 = 0, H12 = 0, H22 = 0;
  for (let it = 0; it < GN_ITERS; it++) {
    H11 = 0; H12 = 0; H22 = 0;
    let g1 = 0, g2 = 0;
    for (const n of nodes) {
      const dx = x - n.x, dy = y - n.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const jx = dx / d, jy = dy / d; // ∂f/∂p (unit vector)
      const f = d - n.r;
      H11 += n.w * jx * jx; H12 += n.w * jx * jy; H22 += n.w * jy * jy;
      g1 += n.w * jx * f; g2 += n.w * jy * f;
    }
    const damp = LM_DAMP * (H11 + H22 + 1e-9);
    const a = H11 + damp, c = H22 + damp, b = H12;
    const det = a * c - b * b;
    if (!isFinite(det) || Math.abs(det) < 1e-12) break;
    const dxs = -(c * g1 - b * g2) / det;
    const dys = -(a * g2 - b * g1) / det;
    x += dxs; y += dys;
    if (Math.hypot(dxs, dys) < 1e-4) break;
  }
  // Covariance ≈ H⁻¹ (Fisher information with 1/σ² weights).
  const det = H11 * H22 - H12 * H12;
  if (!isFinite(det) || Math.abs(det) < 1e-12) {
    return { x, y, cov: [Infinity, 0, Infinity], ok: false };
  }
  const cov: [number, number, number] = [H22 / det, -H12 / det, H11 / det];
  return { x, y, cov, ok: true };
}

/** 1σ error ellipse from covariance [Cxx, Cxy, Cyy]. */
function covToEllipse(cov: [number, number, number]): UncertaintyEllipse {
  const [cxx, cxy, cyy] = cov;
  const tr = (cxx + cyy) / 2;
  const diff = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy * cxy);
  const l1 = tr + diff; // larger eigenvalue
  const l2 = tr - diff;
  const semiMajorM = Math.sqrt(Math.max(l1, 0));
  const semiMinorM = Math.sqrt(Math.max(l2, 0));
  // Eigenvector of l1 → major-axis direction; report as a compass bearing.
  const angRad = 0.5 * Math.atan2(2 * cxy, cxx - cyy); // relative to +x (east)
  let orientationDeg = 90 - r2d(angRad); // east-CCW → north-CW compass
  orientationDeg = ((orientationDeg % 360) + 360) % 360;
  return { semiMajorM, semiMinorM, orientationDeg };
}

// --- public entry ---

/**
 * Fuse a window of contact reports into located tracks. One drone per (type,
 * time-cluster). A track gets a real fix only with ≥3 positioned nodes;
 * otherwise it's returned with fixQuality 'none' and an honest degradedReason
 * so the UI can fall back to range rings instead of inventing a pin.
 */
export function fuseReports(reports: ContactReport[], opts: FuseOptions = {}): FusedTrack[] {
  const windowMs = opts.clusterWindowMs ?? 15000;
  const clusters = clusterReports(reports, windowMs);
  const tracks: FusedTrack[] = [];

  for (const cluster of clusters) {
    const latest = reduceToLatestPerNode(cluster);
    const contributingNodes = latest.map((r) => r.nodeId);
    const firstSeen = Math.min(...cluster.map((r) => r.t));
    const lastSeen = Math.max(...cluster.map((r) => r.t));
    const type = cluster[0].type;

    const positioned = latest.filter((r) => r.lat != null && r.lon != null);

    if (positioned.length < 3) {
      tracks.push({
        type,
        lat: null,
        lon: null,
        ellipse: null,
        fixQuality: 'none',
        nodeCount: positioned.length,
        contributingNodes,
        firstSeen,
        lastSeen,
        degradedReason:
          positioned.length === 0
            ? 'no positioned node (GPS unavailable/denied) — showing range rings only'
            : `need ≥3 positioned nodes for a fix (have ${positioned.length})`,
      });
      continue;
    }

    // Reference frame at the positioned-nodes centroid (keeps coords small).
    const lat0 = positioned.reduce((s, r) => s + (r.lat as number), 0) / positioned.length;
    const lon0 = positioned.reduce((s, r) => s + (r.lon as number), 0) / positioned.length;
    const nodes = nodeRangesFrom(positioned, lat0, lon0);
    const sol = multilaterate(nodes);
    const { lat, lon } = localToLatLon(lat0, lon0, sol.x, sol.y);
    const ellipse = covToEllipse(sol.cov);

    // 'weak' if the fused ellipse isn't tighter than the smallest single range
    // ring (the fusion bought little), or the solve was degenerate.
    const minRangeM = Math.min(...nodes.map((n) => n.r));
    const quality: FixQuality =
      !sol.ok || !isFinite(ellipse.semiMajorM) || ellipse.semiMajorM > Math.max(minRangeM, MIN_SD_M)
        ? 'weak'
        : 'ok';

    tracks.push({
      type,
      lat,
      lon,
      ellipse,
      fixQuality: quality,
      nodeCount: positioned.length,
      contributingNodes,
      firstSeen,
      lastSeen,
      degradedReason:
        quality === 'weak' ? 'weak geometry — fix uncertainty exceeds a single range ring' : undefined,
    });
  }

  return tracks;
}

/**
 * Ellipse → closed ring of lat/lon vertices, ready for a MapLibre polygon on
 * MapScreen. Pure geometry so the map layer stays a thin renderer.
 */
export function ellipseToPolygon(track: FusedTrack, points = 48): { lat: number; lon: number }[] {
  if (track.lat == null || track.lon == null || !track.ellipse) return [];
  const { semiMajorM, semiMinorM, orientationDeg } = track.ellipse;
  const a = isFinite(semiMajorM) ? semiMajorM : 0;
  const b = isFinite(semiMinorM) ? semiMinorM : 0;
  const th = d2r(90 - orientationDeg); // compass bearing → math angle from +x
  const ct = Math.cos(th), st = Math.sin(th);
  const ring: { lat: number; lon: number }[] = [];
  for (let i = 0; i <= points; i++) {
    const t = (2 * Math.PI * i) / points;
    const ex = a * Math.cos(t); // along major axis
    const ey = b * Math.sin(t); // along minor axis
    const x = ex * ct - ey * st; // rotate into east/north
    const y = ex * st + ey * ct;
    ring.push(localToLatLon(track.lat, track.lon, x, y));
  }
  return ring;
}
