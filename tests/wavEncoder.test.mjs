/**
 * wavEncoder.test.mjs -- verify the WAV header + data are well-formed so the
 * Python trainer (scipy.io.wavfile) can read captured training clips.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWavBase64 } from '../lib/wavEncoder.ts';
import { base64ToBytes } from '../lib/openDroneId.ts';

function str(b, off, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i]);
  return s;
}
function u32(b, off) {
  return b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24);
}
function u16(b, off) {
  return b[off] | (b[off + 1] << 8);
}

test('encodes a valid 16-bit mono WAV header', () => {
  const n = 100;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = Math.sin(i);
  const bytes = base64ToBytes(encodeWavBase64(samples, 16000));

  assert.equal(str(bytes, 0, 4), 'RIFF');
  assert.equal(str(bytes, 8, 4), 'WAVE');
  assert.equal(str(bytes, 12, 4), 'fmt ');
  assert.equal(u16(bytes, 20), 1, 'PCM format');
  assert.equal(u16(bytes, 22), 1, 'mono');
  assert.equal(u32(bytes, 24), 16000, 'sample rate');
  assert.equal(u16(bytes, 34), 16, 'bits per sample');
  assert.equal(str(bytes, 36, 4), 'data');
  assert.equal(u32(bytes, 40), n * 2, 'data chunk size = samples*2');
  assert.equal(bytes.length, 44 + n * 2, 'total file size');
});

test('clamps and converts full-scale samples', () => {
  const bytes = base64ToBytes(encodeWavBase64(Float32Array.from([1, -1, 2, -2]), 16000));
  const d0 = (bytes[44] | (bytes[45] << 8)) << 16 >> 16; // int16 LE
  const d1 = (bytes[46] | (bytes[47] << 8)) << 16 >> 16;
  assert.equal(d0, 0x7fff, '+1 -> max positive');
  assert.equal(d1, -0x8000, '-1 -> max negative');
});
