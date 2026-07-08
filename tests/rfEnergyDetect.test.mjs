/**
 * rfEnergyDetect.test.mjs -- energy/peak-over-floor presence detector. Mirrors
 * the real-capture result (tools/test_energy): a narrowband tone clears the
 * floor and is flagged; noise-only does not; the DC/center spike is ignored.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEnergy } from '../lib/rfEnergyDetect.ts';

const Fs = 1_024_000;
const N = 32768;

// Deterministic Gaussian noise (seeded LCG + Box-Muller) so tests don't flake.
function mkRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
function gauss(rng) {
  const u = Math.max(1e-9, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function frame({ tone = null, amp = 0, sigma = 0.03, seed = 7 }) {
  const rng = mkRng(seed);
  const I = new Float64Array(N), Q = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    I[n] = sigma * gauss(rng);
    Q[n] = sigma * gauss(rng);
    if (tone != null) {
      const ph = 2 * Math.PI * tone * (n / Fs);
      I[n] += amp * Math.cos(ph);
      Q[n] += amp * Math.sin(ph);
    }
  }
  return { I, Q };
}

test('flags a narrowband tone well above the noise floor', () => {
  const { I, Q } = frame({ tone: 120_000, amp: 0.25, sigma: 0.03 });
  const d = detectEnergy(I, Q, Fs);
  assert.ok(d.present, 'tone should be present');
  assert.ok(d.peakDb > 15, `peakDb should be high, got ${d.peakDb}`);
  assert.ok(Math.abs(d.peakOffsetHz - 120_000) < 1000, `offset ~120kHz, got ${d.peakOffsetHz}`);
});

test('does NOT flag noise only (0% false alarm)', () => {
  const { I, Q } = frame({ tone: null, sigma: 0.05, seed: 99 });
  const d = detectEnergy(I, Q, Fs);
  assert.equal(d.present, false, `noise flagged present with peakDb ${d.peakDb}`);
  assert.ok(d.peakDb < 9, `noise peakDb should stay under threshold, got ${d.peakDb}`);
});

test('ignores the DC / center spike', () => {
  // Strong tone at exactly 0 Hz (DC) -- the RTL center spike -- must be excluded.
  const { I, Q } = frame({ tone: 0, amp: 0.5, sigma: 0.03, seed: 3 });
  const d = detectEnergy(I, Q, Fs);
  assert.equal(d.present, false, 'DC spike must not count as a detection');
});

test('detects a weaker tone near the real-signal margin', () => {
  // ~10 dB-ish case like the real drone link (median peakDb ~11).
  const { I, Q } = frame({ tone: -200_000, amp: 0.09, sigma: 0.05, seed: 42 });
  const d = detectEnergy(I, Q, Fs);
  assert.ok(d.present, `weak-but-real tone should be flagged, peakDb ${d.peakDb}`);
});
