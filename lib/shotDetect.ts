/**
 * shotDetect.ts -- impulse / onset detector for acoustic gunshot detection.
 * STAGE 1 of the two-stage gate in docs/SENTINEL-SHOTS-FIRED.md §10:
 *
 *     [shotDetect: is this an impulse at all?] -> [classifier: is it a GUNSHOT?]
 *
 * This stage is deliberately PERMISSIVE. Its job is to reject the 99.99% of a
 * 24/7 audio stream that is wind, traffic, speech and rain -- cheaply, without
 * waking the model -- and to hand anything impulse-shaped downstream. It does
 * NOT try to tell a gunshot from a firework or a door slam. That is the
 * classifier's job and it is the hard part of the whole product (§2.2); a
 * trigger that tries to do it here just loses recall on real shots.
 *
 * WHY THIS IS NOT THE DRONE FRONT-END
 * -----------------------------------
 * Reusing lib/dsp.ts wholesale would actively suppress gunshots. Measured
 * against the real drone config (tests/shotDetect.test.mjs pins this):
 *
 *  - The STATIONARITY GATE in dsp.ts/corvus_features.py scores each frequency
 *    bin by median/mean across frames, so steady rotor combs survive and bursty
 *    energy is attenuated. A gunshot is the burstiest signal there is, so the
 *    gate treats it as the crowd noise it was built to kill: it costs a gunshot
 *    ~2.95 dB but a sustained tone only ~1.2 dB. With the gate on, a gunshot's
 *    mel_mean reads BELOW silence. The gate must be OFF on this path.
 *
 *  - dsp.ts features are mean+std of log-mel ACROSS the clip. A 2 ms event in a
 *    1 s window is ~1 frame in 62, so mel_mean barely moves (0.174 vs 1.866 for
 *    a tone). Averaging is the wrong representation for a transient; the time
 *    axis has to survive. That is a classifier-side concern
 *    (training/shot_features.py), noted here so nobody "optimizes" this module
 *    back into extractFeatures().
 *
 * WHAT DOES CARRY OVER: the high-pass. We import the SAME parity-proven IIR
 * recurrence dsp.ts uses -- just at a much higher corner. The drone path runs
 * 40 Hz to preserve combustion-engine fundamentals; a fixed outdoor node fights
 * WIND, which is broadband energy down low. High-passing the TRIGGER buys wind
 * immunity for free. The classifier still sees full-band audio, because muzzle
 * blast has real low-frequency content we must not throw away.
 *
 * NOTE ON VOICE: unlike the drone path, this must NOT suppress on voice
 * presence. Screaming and shouting are EXPECTED context in a real shooting --
 * a front-end that ducks on speech would duck hardest during exactly the
 * incidents that matter. vad.ts stays useful as a classifier feature, never as
 * a gain reduction here.
 *
 * PURE + self-contained (one type-only-adjacent import of a pure function), so
 * it unit-tests with no transport, hardware, or React Native runtime -- same
 * discipline as loraDetect.ts / rfEnergyDetect.ts.
 */

// Explicit .ts extension (tsconfig allowImportingTsExtensions) so this module
// resolves under `node --experimental-strip-types` in tests, not just Metro.
import { highPassInPlace } from './dsp.ts';

export interface ShotOptions {
  /** Trigger-path high-pass corner (Hz). Wind lives below this. */
  highPassHz?: number;
  /** Envelope frame length (ms). Must be short enough to resolve a ~1-3 ms blast. */
  frameMs?: number;
  /** Peak-over-floor (dB) required to trigger. */
  thresholdDb?: number;
  /** Reject onsets slower than this (ms) -- wind gusts, engine rev, music swells. */
  maxAttackMs?: number;
  /** Minimum gap between separately-counted shots (ms). Bounds burst counting. */
  refractoryMs?: number;
}

export interface ShotCandidate {
  /** Seconds from the start of the buffer to the energy peak. */
  onsetSec: number;
  /** Peak frame energy over the robust noise floor (dB). Muzzle-blast energy proxy. */
  peakDb: number;
  /** Rise time from floor+6 dB to peak (ms). Gunshots are ~sub-ms. */
  attackMs: number;
  /** Fall time from peak to -20 dB (ms). Short blast, then room/terrain tail. */
  decayMs: number;
  /**
   * Peak |sample| / RMS over the event window. REPORTED, NOT GATED -- see the
   * note on gating below. Handed downstream as a classifier feature.
   */
  crest: number;
}

export interface ShotDetection {
  /** True if at least one impulse cleared every gate. */
  present: boolean;
  /** Impulses found, in time order. */
  candidates: ShotCandidate[];
  /** Count of distinct impulses (rounds in a burst) -> detections.shot_count. */
  shotCount: number;
  /** Absolute robust noise floor (10log10 of median frame energy; uncalibrated). */
  floorDb: number;
}

const EMPTY: ShotDetection = { present: false, candidates: [], shotCount: 0, floorDb: -120 };

/**
 * Find impulse candidates in a mono buffer (~[-1,1]).
 * Hardware-independent; fed by audioCapture on the edge node.
 */
export function detectShots(
  samples: ArrayLike<number>,
  sampleRate: number,
  opts: ShotOptions = {}
): ShotDetection {
  const highPassHz = opts.highPassHz ?? 300;
  const frameMs = opts.frameMs ?? 1;
  const thresholdDb = opts.thresholdDb ?? 15;
  const maxAttackMs = opts.maxAttackMs ?? 5;
  const refractoryMs = opts.refractoryMs ?? 40;

  const len = samples.length;
  const frameLen = Math.max(1, Math.round((frameMs / 1000) * sampleRate));
  if (len < frameLen * 8 || sampleRate <= 0) return EMPTY;

  // DC removal, then the SAME high-pass recurrence as the drone path (parity
  // -proven), at a wind-rejecting corner.
  const x = new Float64Array(len);
  let mean = 0;
  for (let i = 0; i < len; i++) mean += samples[i];
  mean /= len;
  for (let i = 0; i < len; i++) x[i] = samples[i] - mean;
  highPassInPlace(x, len, highPassHz, sampleRate);

  // Short-time energy envelope (mean square per frame).
  const nFrames = Math.floor(len / frameLen);
  const env = new Float64Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let s = 0;
    const base = f * frameLen;
    for (let i = 0; i < frameLen; i++) {
      const v = x[base + i];
      s += v * v;
    }
    env[f] = s / frameLen;
  }

  // Robust noise floor = median frame energy. A shot occupies a handful of
  // frames out of hundreds, so the median is the background even during a
  // burst -- same trick rfEnergyDetect uses against the RF floor.
  const sorted = Float64Array.from(env).sort();
  const floor = sorted[nFrames >> 1] + 1e-12;
  const floorDb = 10 * Math.log10(floor);

  const trigger = floor * Math.pow(10, thresholdDb / 10);
  const attackRef = floor * 3.981; // floor + 6 dB: where the rise is deemed to start
  const msPerFrame = (frameLen / sampleRate) * 1000;
  const refractoryFrames = Math.max(1, Math.round(refractoryMs / msPerFrame));

  const candidates: ShotCandidate[] = [];
  let f = 0;
  while (f < nFrames) {
    if (env[f] < trigger) { f++; continue; }

    // Walk to the local peak of this excursion.
    let peakF = f;
    let g = f;
    while (g < nFrames && env[g] >= trigger) {
      if (env[g] > env[peakF]) peakF = g;
      g++;
    }
    const peak = env[peakF];

    // Attack: back from the peak to the last frame under floor+6 dB.
    let a = peakF;
    while (a > 0 && env[a - 1] >= attackRef && peakF - a < 200) a--;
    const attackMs = (peakF - a) * msPerFrame;

    // Decay: forward from the peak until 20 dB down.
    const decayRef = peak * 0.01;
    let d = peakF;
    while (d + 1 < nFrames && env[d + 1] > decayRef && d - peakF < 2000) d++;
    const decayMs = (d - peakF) * msPerFrame;

    // Crest factor over the event window (peak sample vs RMS).
    const s0 = a * frameLen;
    const s1 = Math.min(len, (d + 1) * frameLen);
    let pk = 0;
    let sq = 0;
    for (let i = s0; i < s1; i++) {
      const v = Math.abs(x[i]);
      if (v > pk) pk = v;
      sq += x[i] * x[i];
    }
    const rms = Math.sqrt(sq / Math.max(1, s1 - s0)) + 1e-12;
    const crest = pk / rms;

    // GATING POLICY: peak-over-floor + attack time ONLY.
    //
    // Crest was a gate here and was removed on evidence. A broadband muzzle
    // blast measured over its own tight event window has the crest factor of
    // white noise (~3.3-5.6 across 5 synthetic rounds), so a plausible-looking
    // `minCrest: 4` silently threw away 3 of 5 REAL shots. Meanwhile wind,
    // speech and the bare noise floor are all still rejected with crest gating
    // off -- the high-pass and the attack gate were doing all the work
    // (tests/shotDetect.test.mjs). A gate that can veto a real shot has to earn
    // its place; this one didn't. Crest is still reported for the classifier.
    //
    // Recall is the whole point of stage 1: a missed shot is unrecoverable,
    // a false trigger just costs the classifier a few milliseconds.
    const peakDb = 10 * Math.log10(peak / floor);
    if (attackMs <= maxAttackMs) {
      candidates.push({ onsetSec: (peakF * frameLen) / sampleRate, peakDb, attackMs, decayMs, crest });
    }

    // Refractory from the PEAK, so a long reverb tail doesn't mask the next
    // round in a burst -- shot_count depends on this.
    f = Math.max(g, peakF + refractoryFrames);
  }

  return {
    present: candidates.length > 0,
    candidates,
    shotCount: candidates.length,
    floorDb,
  };
}
