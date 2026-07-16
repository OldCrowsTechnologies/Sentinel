/**
 * shotDetect.test.mjs -- stage-1 impulse trigger for gunshot detection.
 *
 * Two things are pinned here:
 *  1. The trigger fires on impulses and ignores the 24/7 background (wind,
 *     speech, noise) -- and DELIBERATELY still fires on a door slam, because
 *     discriminating that is the classifier's job, not the trigger's.
 *  2. The measured reason the drone front-end can't be reused (see the header
 *     of lib/shotDetect.ts). If someone re-enables the stationarity gate on the
 *     gunshot path, test 6 fails and says why.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectShots } from '../lib/shotDetect.ts';
import { extractFeatures } from '../lib/dsp.ts';

const SR = 48000;
const N = SR; // 1 second

// Deterministic RNG so tests never flake.
function mkRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1;
  };
}

/** Mic noise floor -- never digital silence. */
function bed(rng, amp = 0.002, n = N) {
  return Float64Array.from({ length: n }, () => amp * rng());
}

/** A muzzle-blast-like transient: ~2 ms broadband burst + short room tail. */
function addShot(buf, at, rng, amp = 0.9, durMs = 2) {
  const dur = Math.round((durMs / 1000) * SR);
  for (let i = 0; i < dur; i++) buf[at + i] += amp * rng() * Math.exp(-i / (dur / 3));
  const tail = Math.round(0.08 * SR); // 80 ms reverb tail
  for (let i = 0; i < tail && at + dur + i < buf.length; i++) {
    buf[at + dur + i] += amp * 0.06 * rng() * Math.exp(-i / (tail / 4));
  }
  return buf;
}

test('fires on a gunshot-like impulse', () => {
  const rng = mkRng(7);
  const x = addShot(bed(rng), N >> 1, rng);
  const d = detectShots(x, SR);
  assert.ok(d.present, 'gunshot impulse should trigger');
  assert.equal(d.shotCount, 1, `expected 1 shot, got ${d.shotCount}`);
  const c = d.candidates[0];
  assert.ok(c.peakDb > 25, `muzzle blast should tower over the floor, got ${c.peakDb.toFixed(1)} dB`);
  assert.ok(c.attackMs <= 5, `attack should be near-instant, got ${c.attackMs.toFixed(2)} ms`);
  assert.ok(Math.abs(c.onsetSec - 0.5) < 0.01, `onset ~0.5s, got ${c.onsetSec.toFixed(3)}`);
});

test('does NOT fire on the bare noise floor', () => {
  const d = detectShots(bed(mkRng(99)), SR);
  assert.equal(d.present, false, `noise floor triggered with ${d.shotCount} candidate(s)`);
});

test('does NOT fire on wind (low-frequency gust, slow attack)', () => {
  // Wind is broadband energy down low with a gust envelope over ~200 ms. It is
  // LOUD -- far louder than the noise bed -- so the 300 Hz trigger high-pass is
  // what has to save us here, not amplitude.
  const rng = mkRng(21);
  const x = bed(rng);
  for (let n = 0; n < N; n++) {
    const gust = Math.exp(-(((n - N / 2) / (0.2 * SR)) ** 2)); // smooth 200 ms swell
    let v = 0;
    for (const f of [12, 28, 47, 63, 85]) v += Math.sin((2 * Math.PI * f * n) / SR + f);
    x[n] += 0.6 * gust * (v / 5 + 0.3 * rng());
  }
  const d = detectShots(x, SR);
  assert.equal(d.present, false, `wind gust triggered with ${d.shotCount} candidate(s)`);
});

test('does NOT fire on speech', () => {
  // 180 Hz fundamental + formants, syllable-rate amplitude envelope.
  const rng = mkRng(5);
  const x = bed(rng);
  for (let n = 0; n < N; n++) {
    const t = n / SR;
    const syll = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t); // ~4 Hz syllables
    let v = 0;
    for (const [f, a] of [[180, 1], [360, 0.5], [700, 0.6], [1220, 0.4], [2600, 0.2]]) {
      v += a * Math.sin((2 * Math.PI * f * n) / SR);
    }
    x[n] += 0.25 * syll * (v / 2.7);
  }
  const d = detectShots(x, SR);
  assert.equal(d.present, false, `speech triggered with ${d.shotCount} candidate(s)`);
});

test('counts rounds in a burst', () => {
  const rng = mkRng(11);
  const x = bed(rng);
  const gapMs = 150;
  for (let k = 0; k < 5; k++) addShot(x, Math.round((0.1 + (k * gapMs) / 1000) * SR), rng);
  const d = detectShots(x, SR);
  assert.equal(d.shotCount, 5, `expected 5 rounds, got ${d.shotCount}`);
});

test('every real shot survives -- no gate may veto one on crest', () => {
  // Regression pin. A `minCrest: 4` gate looked reasonable and silently dropped
  // 3 of these 5 REAL shots, because a broadband blast measured over its own
  // event window just has white-noise crest (3.36 - 5.60 here). Wind/speech are
  // rejected without it (tests above), so the gate cost recall and bought
  // nothing. If crest -- or any new spikiness heuristic -- becomes a gate again,
  // this fails.
  const rng = mkRng(11);
  const x = bed(rng);
  for (let k = 0; k < 5; k++) addShot(x, Math.round((0.1 + (k * 150) / 1000) * SR), rng);
  const d = detectShots(x, SR);
  assert.equal(d.shotCount, 5, `stage 1 must not drop real shots, got ${d.shotCount}`);
  const crests = d.candidates.map((c) => c.crest);
  assert.ok(
    Math.min(...crests) < 4,
    `this fixture is only meaningful while some real shot has crest < 4 ` +
      `(got min ${Math.min(...crests).toFixed(2)}) -- it exists to prove such a shot is NOT dropped`
  );
});

test('STILL fires on a door slam -- the trigger must not discriminate', () => {
  // A door slam is impulse-shaped and SHOULD reach the classifier. This test
  // exists so nobody "fixes" the trigger into rejecting confounders: doing that
  // trades away recall on real shots. Gunshot-vs-slam is the classifier's job
  // (docs/SENTINEL-SHOTS-FIRED.md §2.2) and the reason the confounder corpus
  // matters at all.
  const rng = mkRng(3);
  const x = addShot(bed(rng), N >> 1, rng, 0.5, 6); // duller, longer than a shot
  const d = detectShots(x, SR);
  assert.ok(d.present, 'door slam should reach the classifier, not be gated out here');
});

test('the drone stationarity gate suppresses gunshots -- keep it OFF here', () => {
  // Pins the measurement in lib/shotDetect.ts's header. The gate scores bins by
  // median/mean across frames, so it attenuates the burstiest signal hardest --
  // exactly backwards for an impulse. If this ever fails, the gate got turned on
  // for the gunshot path, or its floor changed; do not "fix" it by loosening the
  // assert.
  const SR16 = 16000, N16 = SR16;
  const rng = mkRng(13);

  const nMels = 20, nfft = 512;
  const nBins = nfft / 2 + 1;
  const hz2mel = (f) => 2595 * Math.log10(1 + f / 700);
  const mel2hz = (m) => 700 * (10 ** (m / 2595) - 1);
  const freqs = Array.from({ length: nBins }, (_, k) => (k * SR16) / 2 / (nBins - 1));
  const [mmin, mmax] = [hz2mel(50), hz2mel(8000)];
  const pts = Array.from({ length: nMels + 2 }, (_, i) => mel2hz(mmin + ((mmax - mmin) * i) / (nMels + 1)));
  const melFilterbank = [];
  for (let m = 1; m <= nMels; m++) {
    const [l, c, r] = [pts[m - 1], pts[m], pts[m + 1]];
    melFilterbank.push(freqs.map((f) =>
      f >= l && f <= c && c > l ? (f - l) / (c - l) : f > c && f <= r && r > c ? (r - f) / (r - c) : 0));
  }
  const base = {
    sampleRate: SR16, nfft, hop: 256, nMels,
    bandRatios: [[40, 200], [700, 1500]], melFilterbank,
    highPass: { enabled: true, fc: 40, order: 1 },
  };
  const ON = { ...base, stationarity: { enabled: true, eps: 1e-10, minFrames: 4, floor: 0.5 } };
  const OFF = { ...base, stationarity: { enabled: false, eps: 1e-10, minFrames: 4, floor: 0.5 } };

  const shot = Float64Array.from({ length: N16 }, () => 0.002 * rng());
  const dur = Math.round(0.002 * SR16);
  for (let i = 0; i < dur; i++) shot[(N16 >> 1) + i] += 0.9 * rng() * Math.exp(-i / (dur / 3));

  const tone = Float64Array.from({ length: N16 }, (_, n) => 0.002 * rng() + 0.3 * Math.sin((2 * Math.PI * 1000 * n) / SR16));

  const meanOf = (f) => { let s = 0; for (let m = 0; m < nMels; m++) s += f[m]; return s / nMels; };
  // log-mel features: the difference IS the log-domain gain the gate applied.
  const dbCost = (sig) => (10 / Math.LN10) * (meanOf(extractFeatures(sig, ON)) - meanOf(extractFeatures(sig, OFF)));

  const shotCost = dbCost(shot);
  const toneCost = dbCost(tone);
  assert.ok(shotCost < -2, `gate should measurably suppress the gunshot, got ${shotCost.toFixed(2)} dB`);
  assert.ok(
    shotCost < toneCost - 1,
    `gate must hurt the gunshot MORE than the tone it protects ` +
      `(shot ${shotCost.toFixed(2)} dB vs tone ${toneCost.toFixed(2)} dB) -- this is why the gate is off on the gunshot path`
  );
});
