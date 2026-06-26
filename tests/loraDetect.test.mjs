/**
 * loraDetect.test.mjs -- verify the LoRa chirp-presence detector flags a
 * synthetic chirp and rejects noise.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLora, loraCandidateSlopes } from '../lib/loraDetect.ts';

const FS = 1e6;
const N = 4096;

// Deterministic PRNG (avoid Math.random for repeatability).
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Smallest candidate slope keeps the chirp within Nyquist over the frame.
const slopes = loraCandidateSlopes();
const k0 = slopes[0];

test('detects a synthetic LoRa-style chirp at the matching slope', () => {
  const I = new Float64Array(N);
  const Q = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const t = n / FS;
    const phi = Math.PI * k0 * t * t; // linear chirp: inst. freq = k0*t
    I[n] = Math.cos(phi);
    Q[n] = Math.sin(phi);
  }
  const d = detectLora(I, Q, FS);
  assert.equal(d.present, true, `chirp should be detected (score ${d.score.toFixed(1)})`);
  assert.equal(d.slopeHzPerS, k0, 'best slope should be the chirp slope');
  assert.ok(d.score > 200, `matched PAPR should be large, got ${d.score.toFixed(1)}`);
});

test('rejects white noise (no chirp present)', () => {
  const rnd = lcg(12345);
  const I = new Float64Array(N);
  const Q = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    I[n] = rnd() * 2 - 1;
    Q[n] = rnd() * 2 - 1;
  }
  const d = detectLora(I, Q, FS);
  assert.equal(d.present, false, `noise must not trigger (score ${d.score.toFixed(1)})`);
});
