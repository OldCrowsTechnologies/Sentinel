/**
 * mesh.test.mjs -- Phase 3 mesh: contact-report codec round-trips + validates,
 * and the transport receive path (ingestRaw) decodes, dedups, and emits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MESH_PROTO_VERSION,
  reportFromDetection,
  encodeReport,
  decodeReport,
} from '../lib/meshTypes.ts';
import { ingestRaw, resetMesh, startMesh, broadcastReport } from '../lib/meshTransport.ts';

// A representative local Detection (shape from threatTracker.Detection).
function sampleDetection(over = {}) {
  return {
    label: 'Skydio X2',
    confidence: 91,
    distance: 210,
    bearing: -1,
    timestamp: 1751490000000,
    lat: 40.6895,
    lon: -74.1745,
    locationAccuracy: 6,
    isUnknownBuild: false,
    estFundamentalHz: 118,
    sizeClass: 'small',
    oodScore: 0.12,
    voicePresent: false,
    ...over,
  };
}

test('reportFromDetection maps a Detection into a versioned report', () => {
  const r = reportFromDetection(sampleDetection(), 'a3f1', 7);
  assert.equal(r.v, MESH_PROTO_VERSION);
  assert.equal(r.nodeId, 'a3f1');
  assert.equal(r.seq, 7);
  assert.equal(r.type, 'Skydio X2');
  assert.equal(r.conf, 91); // 0-100 preserved, no lossy rescale
  assert.equal(r.rangeFt, 210);
  assert.equal(r.bearing, -1);
  assert.equal(r.kind, 'acoustic');
  assert.equal(r.rangeSd, null); // until range calibration exists
});

test('encode -> decode round-trips exactly', () => {
  const r = reportFromDetection(sampleDetection(), 'a3f1', 7);
  const back = decodeReport(encodeReport(r));
  assert.deepEqual(back, r);
});

test('decode rejects malformed JSON and wrong proto version', () => {
  assert.equal(decodeReport('not json{'), null);
  assert.equal(decodeReport('42'), null);
  const r = reportFromDetection(sampleDetection(), 'a3f1', 7);
  const bumped = { ...r, v: MESH_PROTO_VERSION + 1 };
  assert.equal(decodeReport(JSON.stringify(bumped)), null);
});

test('decode rejects missing/mistyped required fields', () => {
  const r = reportFromDetection(sampleDetection(), 'a3f1', 7);
  for (const bad of [
    { ...r, nodeId: '' },
    { ...r, seq: -1 },
    { ...r, seq: 1.5 },
    { ...r, conf: 'high' },
    { ...r, kind: 'radar' },
    { ...r, unknownBuild: 'yes' },
    { ...r, lat: 'x' },
  ]) {
    assert.equal(decodeReport(JSON.stringify(bad)), null, `should reject ${JSON.stringify(bad).slice(0, 40)}`);
  }
});

test('null GPS survives the round-trip (offline / GPS-denied node)', () => {
  const r = reportFromDetection(
    sampleDetection({ lat: null, lon: null, locationAccuracy: null }),
    'b2c4',
    1
  );
  const back = decodeReport(encodeReport(r));
  assert.equal(back.lat, null);
  assert.equal(back.lon, null);
  assert.equal(back.posAcc, null);
});

test('ingestRaw decodes, emits to the sink, and dedups replays', () => {
  resetMesh();
  const got = [];
  // startMesh returns false while slaved off, but registers the sink so the
  // receive path is live and testable.
  startMesh((r, peer) => got.push({ r, peer }));

  const wire = encodeReport(reportFromDetection(sampleDetection(), 'a3f1', 7));
  const first = ingestRaw(wire, 'peerX');
  const dup = ingestRaw(wire, 'peerX'); // flood duplicate / replay
  const bad = ingestRaw('garbage', 'peerX');

  assert.ok(first, 'first frame accepted');
  assert.equal(dup, null, 'duplicate nodeId:seq dropped');
  assert.equal(bad, null, 'malformed frame dropped');
  assert.equal(got.length, 1, 'sink fired exactly once');
  assert.equal(got[0].r.nodeId, 'a3f1');
  assert.equal(got[0].peer, 'peerX');
  resetMesh();
});

test('broadcastReport is inert while the transport is slaved off', () => {
  const r = reportFromDetection(sampleDetection(), 'a3f1', 7);
  assert.equal(broadcastReport(r), false); // no transmit until native transport lands
});
