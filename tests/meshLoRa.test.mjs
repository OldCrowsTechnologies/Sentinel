import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  packReport, unpackReport, FRAME_BYTES, KIND, LABEL,
  RANGE_UNKNOWN, BEARING_NONE, toMeshSec, fromMeshSec, MESH_PROTO_VERSION,
} from '../lib/meshLoRa.ts';

const base = {
  nodeId: 4, seq: 1024, tSec: toMeshSec(1_752_000_000_000),
  lat: 30.42131, lon: -87.21694,
  kind: KIND.gunshot, label: LABEL.rifle, conf: 72, peakDb: 44,
  shotCount: 3, rangeFt: RANGE_UNKNOWN, bearing: BEARING_NONE,
};

test('frame is exactly 26 bytes -- fits a LoRa payload', () => {
  assert.equal(packReport(base).length, FRAME_BYTES);
  assert.ok(FRAME_BYTES <= 40, 'must fit under ~40 B with room for the 8 B auth tag');
});

test('round-trips every field', () => {
  const r = unpackReport(packReport(base));
  assert.ok(r);
  assert.equal(r.nodeId, base.nodeId);
  assert.equal(r.seq, base.seq);
  assert.equal(r.tSec, base.tSec);
  assert.equal(r.kind, KIND.gunshot);
  assert.equal(r.label, LABEL.rifle);
  assert.equal(r.conf, 72);
  assert.equal(r.peakDb, 44);
  assert.equal(r.shotCount, 3);
  assert.equal(r.rangeFt, RANGE_UNKNOWN);
  assert.equal(r.bearing, BEARING_NONE);
  // lat/lon survive at 1e7 fixed-point (~1 cm)
  assert.ok(Math.abs(r.lat - base.lat) < 1e-6, `lat ${r.lat}`);
  assert.ok(Math.abs(r.lon - base.lon) < 1e-6, `lon ${r.lon}`);
});

test('null position round-trips as null (never 0,0)', () => {
  const r = unpackReport(packReport({ ...base, lat: null, lon: null }));
  assert.equal(r.lat, null);
  assert.equal(r.lon, null);
});

test('negative peakDb (quiet shot below the working point) survives as signed', () => {
  const r = unpackReport(packReport({ ...base, peakDb: -12 }));
  assert.equal(r.peakDb, -12);
});

test('clamps out-of-range values instead of overflowing the field', () => {
  const r = unpackReport(packReport({ ...base, conf: 250, shotCount: 99999 }));
  assert.equal(r.conf, 100); // conf capped at 100
  assert.equal(r.shotCount, 255); // u8 ceiling
});

test('rejects a short buffer and a wrong-version frame', () => {
  assert.equal(unpackReport(new Uint8Array(10)), null);
  const bad = packReport(base);
  bad[0] = (bad[0] & 0x0f) | ((MESH_PROTO_VERSION + 1) << 4); // bump version nibble
  assert.equal(unpackReport(bad), null);
});

test('mesh-seconds clock is stable to the second', () => {
  const ms = 1_752_000_123_456;
  assert.ok(Math.abs(fromMeshSec(toMeshSec(ms)) - ms) < 1000);
});
