/**
 * meshFusion.test.mjs -- Phase 3 range-only multilateration: recovers a known
 * drone position from synthetic node geometry, degrades honestly when it can't.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fuseReports,
  toLocalMeters,
  localToLatLon,
  ellipseToPolygon,
} from '../lib/meshFusion.ts';

const FT_TO_M = 0.3048;
const BASE_LAT = 40.7;
const BASE_LON = -74.0;

// Deterministic PRNG (no Math.random, per repo convention).
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Build a report from a node at local (nx, ny) meters observing a drone at local
// (dx, dy) meters, with optional range noise (m).
function reportAt(nodeId, nx, ny, dx, dy, t, noiseM = 0, type = 'Skydio X2') {
  const { lat, lon } = localToLatLon(BASE_LAT, BASE_LON, nx, ny);
  const rangeM = Math.hypot(dx - nx, dy - ny) + noiseM;
  return {
    v: 1,
    nodeId,
    seq: 1,
    t,
    lat,
    lon,
    posAcc: 5,
    type,
    conf: 90,
    rangeFt: rangeM / FT_TO_M,
    rangeSd: null,
    bearing: -1,
    unknownBuild: false,
    kind: 'acoustic',
  };
}

function errorMeters(track, dx, dy) {
  const p = toLocalMeters(track.lat, track.lon, BASE_LAT, BASE_LON);
  return Math.hypot(p.x - dx, p.y - dy);
}

test('toLocalMeters and localToLatLon are inverses', () => {
  const { lat, lon } = localToLatLon(BASE_LAT, BASE_LON, 250, -400);
  const { x, y } = toLocalMeters(lat, lon, BASE_LAT, BASE_LON);
  assert.ok(Math.hypot(x - 250, y + 400) < 1e-6);
});

test('recovers a known drone position from 4 exact-range nodes', () => {
  const DX = 120, DY = 80; // drone truth (local meters)
  const reports = [
    reportAt('n1', -300, -300, DX, DY, 1000),
    reportAt('n2', 300, -300, DX, DY, 1000),
    reportAt('n3', 300, 300, DX, DY, 1000),
    reportAt('n4', -300, 300, DX, DY, 1000),
  ];
  const tracks = fuseReports(reports);
  assert.equal(tracks.length, 1);
  const tr = tracks[0];
  assert.equal(tr.fixQuality, 'ok');
  assert.equal(tr.nodeCount, 4);
  assert.ok(errorMeters(tr, DX, DY) < 5, `fix error ${errorMeters(tr, DX, DY).toFixed(2)} m should be small`);
  assert.ok(tr.ellipse && isFinite(tr.ellipse.semiMajorM), 'has a finite ellipse');
});

test('noisy ranges: fix stays near truth and reports an ellipse', () => {
  const rnd = lcg(9);
  const DX = -60, DY = 200;
  const nodes = [
    [-350, -200], [350, -220], [0, 380], [-200, 300],
  ];
  const reports = nodes.map(([nx, ny], i) =>
    reportAt(`n${i}`, nx, ny, DX, DY, 2000, (rnd() * 2 - 1) * 10)
  );
  const tr = fuseReports(reports)[0];
  assert.ok(errorMeters(tr, DX, DY) < 40, `noisy fix error ${errorMeters(tr, DX, DY).toFixed(1)} m`);
  assert.ok(tr.ellipse.semiMajorM > 0, 'ellipse has positive extent under noise');
});

test('fewer than 3 positioned nodes: no fix, honest reason', () => {
  const reports = [
    reportAt('n1', -200, 0, 50, 50, 3000),
    reportAt('n2', 200, 0, 50, 50, 3000),
  ];
  const tr = fuseReports(reports)[0];
  assert.equal(tr.fixQuality, 'none');
  assert.equal(tr.lat, null);
  assert.equal(tr.lon, null);
  assert.match(tr.degradedReason, /≥3 positioned nodes/);
});

test('GPS-denied (all nodes unpositioned): degraded, labeled', () => {
  const reports = [0, 1, 2].map((i) => {
    const r = reportAt(`n${i}`, i * 100, 0, 50, 50, 4000);
    r.lat = null;
    r.lon = null;
    return r;
  });
  const tr = fuseReports(reports)[0];
  assert.equal(tr.fixQuality, 'none');
  assert.equal(tr.nodeCount, 0);
  assert.match(tr.degradedReason, /GPS/);
});

test('clusters by type and by time window', () => {
  const drone = (id, nx, ny, t, type) => reportAt(id, nx, ny, 0, 0, t, 0, type);
  const reports = [
    // Skydio cluster A (t≈1000)
    drone('n1', -300, -300, 1000, 'Skydio X2'),
    drone('n2', 300, -300, 1001, 'Skydio X2'),
    drone('n3', 0, 300, 1002, 'Skydio X2'),
    // a DJI at the same time → separate track by type
    drone('n1', -300, -300, 1000, 'DJI Phantom'),
    drone('n2', 300, -300, 1001, 'DJI Phantom'),
    drone('n3', 0, 300, 1002, 'DJI Phantom'),
    // Skydio again much later → separate cluster by time
    drone('n1', -300, -300, 60000, 'Skydio X2'),
  ];
  const tracks = fuseReports(reports, { clusterWindowMs: 15000 });
  const skydio = tracks.filter((t) => t.type === 'Skydio X2');
  const dji = tracks.filter((t) => t.type === 'DJI Phantom');
  assert.equal(skydio.length, 2, 'two Skydio clusters (time-split)');
  assert.equal(dji.length, 1, 'one DJI cluster');
});

test('poor geometry (tight node cluster, distant target): weak fix, no NaN', () => {
  // Nodes within ~20 m of each other observing a drone ~400 m away → large GDOP:
  // all range directions nearly parallel, so the cross-range axis is unobservable.
  const reports = [
    reportAt('n1', 0, 0, 0, 400, 5000),
    reportAt('n2', 20, 0, 0, 400, 5000),
    reportAt('n3', 10, 15, 0, 400, 5000),
  ];
  const tr = fuseReports(reports)[0];
  assert.ok(Number.isFinite(tr.lat) && Number.isFinite(tr.lon), 'position is finite (no NaN)');
  assert.ok(tr.ellipse && Number.isFinite(tr.ellipse.semiMajorM), 'ellipse finite');
  assert.equal(tr.fixQuality, 'weak', 'bad GDOP surfaced as weak');
});

test('ellipseToPolygon returns a closed ring around the fix', () => {
  const reports = [
    reportAt('n1', -300, -300, 100, 100, 6000),
    reportAt('n2', 300, -300, 100, 100, 6000),
    reportAt('n3', 300, 300, 100, 100, 6000),
    reportAt('n4', -300, 300, 100, 100, 6000),
  ];
  const tr = fuseReports(reports)[0];
  const ring = ellipseToPolygon(tr, 32);
  assert.equal(ring.length, 33, 'points+1 closed ring');
  assert.ok(Math.abs(ring[0].lat - ring[32].lat) < 1e-9, 'ring closes');
  // Every vertex is a finite coordinate near the fix.
  for (const v of ring) assert.ok(Number.isFinite(v.lat) && Number.isFinite(v.lon));
});
