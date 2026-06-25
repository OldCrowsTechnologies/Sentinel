/**
 * openDroneId.test.mjs -- unit tests for the ASTM F3411 Remote ID parser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64ToBytes, parseServiceData } from '../lib/openDroneId.ts';

function putI32LE(arr, off, val) {
  arr[off] = val & 0xff;
  arr[off + 1] = (val >> 8) & 0xff;
  arr[off + 2] = (val >> 16) & 0xff;
  arr[off + 3] = (val >> 24) & 0xff;
}
function putAscii(arr, off, s) {
  for (let i = 0; i < s.length; i++) arr[off + i] = s.charCodeAt(i);
}

test('base64ToBytes decodes known values', () => {
  assert.deepEqual([...base64ToBytes('AAAA')], [0, 0, 0]);
  assert.deepEqual([...base64ToBytes('TWFu')], [77, 97, 110]); // "Man"
});

test('parses a message-pack with Basic ID, Location, System, Operator ID', () => {
  const buf = new Uint8Array(5 + 4 * 25);
  buf[0] = 0x0d; // app code
  buf[1] = 0x00; // counter
  buf[2] = 0xf0; // message pack header
  buf[3] = 25;
  buf[4] = 4;
  let p = 5;
  buf[p] = 0x00; buf[p + 1] = 0x12; putAscii(buf, p + 2, 'TEST-SERIAL-123'); p += 25; // Basic ID
  buf[p] = 0x10; putI32LE(buf, p + 5, Math.round(37.7749e7)); putI32LE(buf, p + 9, Math.round(-122.4194e7)); p += 25; // Location
  buf[p] = 0x40; putI32LE(buf, p + 2, Math.round(37.77e7)); putI32LE(buf, p + 6, Math.round(-122.41e7)); p += 25; // System
  buf[p] = 0x50; buf[p + 1] = 0x00; putAscii(buf, p + 2, 'OP-FAA-9988'); p += 25; // Operator ID

  const r = parseServiceData(buf);
  assert.equal(r.uasId, 'TEST-SERIAL-123');
  assert.ok(Math.abs(r.droneLat - 37.7749) < 1e-4);
  assert.ok(Math.abs(r.droneLon - -122.4194) < 1e-4);
  assert.ok(Math.abs(r.operatorLat - 37.77) < 1e-4);
  assert.ok(Math.abs(r.operatorLon - -122.41) < 1e-4);
  assert.equal(r.operatorId, 'OP-FAA-9988');
});

test('rejects non-OpenDroneID service data', () => {
  assert.equal(parseServiceData(new Uint8Array([0x99, 0, 0])), null);
});
