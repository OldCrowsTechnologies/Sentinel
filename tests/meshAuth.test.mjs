import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signFrame, verifyFrame, TAG_BYTES } from '../lib/meshAuth.ts';

const key = Buffer.from('escambia-so-agency-key-0001');
const frame = Uint8Array.from({ length: 26 }, (_, i) => (i * 7) & 0xff);

test('a frame signed with the agency key verifies and returns the payload', () => {
  const signed = signFrame(frame, key);
  assert.equal(signed.length, frame.length + TAG_BYTES);
  const out = verifyFrame(signed, key);
  assert.ok(out);
  assert.deepEqual([...out], [...frame]);
});

test('a tampered payload fails -- no forged SHOTS FIRED', () => {
  const signed = signFrame(frame, key);
  signed[3] ^= 0x01; // flip a bit in the payload
  assert.equal(verifyFrame(signed, key), null);
});

test('a tampered tag fails', () => {
  const signed = signFrame(frame, key);
  signed[signed.length - 1] ^= 0x01;
  assert.equal(verifyFrame(signed, key), null);
});

test('the wrong key fails -- a foreign radio cannot join', () => {
  const signed = signFrame(frame, key);
  assert.equal(verifyFrame(signed, Buffer.from('not-the-agency-key')), null);
});

test('a frame too short to hold a tag is rejected, not thrown', () => {
  assert.equal(verifyFrame(new Uint8Array(TAG_BYTES), key), null);
  assert.equal(verifyFrame(new Uint8Array(0), key), null);
});
