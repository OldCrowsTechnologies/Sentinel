/**
 * dsp.test.mjs -- unit tests for the self-contained DSP helpers.
 * Run: npm test  (node --experimental-strip-types --test tests/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highPassInPlace, estimateDominantHz, meanPowerSpectrum } from '../lib/dsp.ts';

const SR = 16000;
const N = 16000;
const CFG = { sampleRate: SR, nfft: 512, hop: 256, nMels: 20, bandRatios: [], melFilterbank: [] };

function sine(freq, n = N, amp = 0.5) {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return x;
}
function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

test('high-pass attenuates 50 Hz, passes 1500 Hz', () => {
  const lo = sine(50);
  const loIn = rms(lo);
  highPassInPlace(lo, lo.length, 400, SR);
  assert.ok(rms(lo) < 0.3 * loIn, 'low freq should be strongly attenuated');

  const hi = sine(1500);
  const hiIn = rms(hi);
  highPassInPlace(hi, hi.length, 400, SR);
  assert.ok(rms(hi) > 0.7 * hiIn, 'high freq should pass largely intact');
});

test('estimateDominantHz finds a 1000 Hz tone within a bin', () => {
  const hz = estimateDominantHz(sine(1000), CFG);
  assert.ok(Math.abs(hz - 1000) < 60, `expected ~1000 Hz, got ${hz}`);
});

test('meanPowerSpectrum peaks at the tone bin', () => {
  const p = meanPowerSpectrum(sine(800), CFG);
  let peak = 0;
  for (let k = 1; k < p.length; k++) if (p[k] > p[peak]) peak = k;
  const nyq = SR / 2;
  const freq = (peak * nyq) / (p.length - 1);
  assert.ok(Math.abs(freq - 800) < 60, `peak at ${freq} Hz`);
});
