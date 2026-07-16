import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseShots, makeEventId, eventSeq, haversineM } from '../lib/shotFusion.ts';

const t0 = 1_752_000_000_000;
// three nodes ~30-60 m apart around a shot (a school C-wing)
const obs = (nodeId, lat, lon, conf, peak, dt, shots = 3, label = 0) =>
  ({ nodeId, tMs: t0 + dt, lat, lon, conf, peakDb: peak, shotCount: shots, label });

test('three nodes hearing one shot fuse to ONE located event', () => {
  const ev = fuseShots([
    obs(1, 30.4210, -87.2170, 60, 40, 0),
    obs(4, 30.4213, -87.2166, 72, 45, 120),
    obs(6, 30.4211, -87.2172, 51, 33, 260),
  ]);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].quality, 'coarse-region');
  assert.equal(ev[0].hearingNodes.length, 3);
  assert.ok(ev[0].radiusM > 0 && ev[0].radiusM < 500, `radius ${ev[0].radiusM}`);
  assert.equal(ev[0].shotCount, 3); // same rounds heard 3x -> max, not sum
});

test('events separated in time stay separate', () => {
  const ev = fuseShots([
    obs(1, 30.4210, -87.2170, 60, 40, 0),
    obs(9, 30.4300, -87.2000, 40, 28, 6000),
  ]);
  assert.equal(ev.length, 2);
});

test('a single node is quality=single with no fabricated radius', () => {
  const ev = fuseShots([obs(1, 30.4210, -87.2170, 60, 40, 0)]);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].quality, 'single');
  assert.equal(ev[0].radiusM, null); // AT the node +/- acoustic range, not a pin
});

test('the centroid is pulled toward the loudest / most-confident node', () => {
  // node 4 is far more confident; the fused point should sit closer to it than
  // a plain average of the three positions.
  const ev = fuseShots([
    obs(1, 30.4200, -87.2180, 30, 30, 0),
    obs(4, 30.4230, -87.2140, 95, 48, 100),
    obs(6, 30.4205, -87.2178, 30, 30, 200),
  ])[0];
  const plainLat = (30.4200 + 30.4230 + 30.4205) / 3;
  assert.ok(ev.lat > plainLat, `weighted lat ${ev.lat} should exceed plain mean ${plainLat}`);
});

test('two simultaneous shootings far apart split spatially', () => {
  // same 2 s window, but two clusters ~1 km apart
  const ev = fuseShots([
    obs(1, 30.4210, -87.2170, 60, 40, 0),
    obs(2, 30.4212, -87.2168, 55, 38, 100),
    obs(7, 30.4300, -87.2050, 60, 41, 150), // ~1.5 km away
    obs(8, 30.4302, -87.2048, 58, 39, 200),
  ]);
  assert.equal(ev.length, 2);
});

test('eventId is stable regardless of observation order -> cross-gateway dedup', () => {
  const a = fuseShots([
    obs(1, 30.4210, -87.2170, 60, 40, 0),
    obs(4, 30.4213, -87.2166, 72, 45, 120),
    obs(6, 30.4211, -87.2172, 51, 33, 260),
  ])[0];
  // gateway B saw a DIFFERENT subset (node 6 out of range) but the same shot
  const b = fuseShots([
    obs(4, 30.4213, -87.2166, 72, 45, 120),
    obs(1, 30.4210, -87.2170, 60, 40, 0),
  ])[0];
  assert.equal(a.eventId, b.eventId, 'same shot via different gateways must share an id');
  assert.equal(eventSeq(a.eventId), eventSeq(b.eventId));
});

test('haversine sanity: ~111 m per 0.001 deg latitude', () => {
  const d = haversineM(30.4210, -87.2170, 30.4220, -87.2170);
  assert.ok(Math.abs(d - 111) < 5, `got ${d} m`);
});
