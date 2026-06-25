/**
 * vad.ts -- lightweight, dependency-free Voice Activity Detection.
 *
 * Runs on the RAW window (before the model's high-pass) so it can see the voice
 * fundamentals the filter strips. Heuristic, not a neural VAD: speech puts
 * strong energy in the 85-300 Hz fundamental band AND structured energy across
 * the 300-3400 Hz formant range, with lower spectral flatness than broadband
 * noise. Its only job is to flag `voicePresent` to nudge confidence -- a wrong
 * call just slightly adjusts a score, so a robust heuristic is sufficient. Swap
 * for Silero/WebRTC later if the mission logs justify it.
 */

import { meanPowerSpectrum } from './dsp';
import type { DspConfig } from './dsp';

export interface VadResult {
  voicePresent: boolean;
  voiceScore: number; // 0..1, rough speech-likeness
  fundamentalRatio: number;
  formantRatio: number;
}

// Tunable thresholds (A/B via mission logs).
const FUND_LO = 85;
const FUND_HI = 300;
const FORMANT_LO = 300;
const FORMANT_HI = 3400;
const FUND_RATIO_T = 0.06; // voice fundamental energy share
const FORMANT_RATIO_T = 0.35; // formant-band energy share
const SCORE_T = 0.5;

function bandEnergy(power: Float64Array, nyq: number, lo: number, hi: number): number {
  const nBins = power.length;
  let s = 0;
  for (let k = 0; k < nBins; k++) {
    const f = (k * nyq) / (nBins - 1);
    if (f >= lo && f < hi) s += power[k];
  }
  return s;
}

export function detectVoice(samples: ArrayLike<number>, cfg: DspConfig): VadResult {
  const power = meanPowerSpectrum(samples, cfg);
  const nyq = cfg.sampleRate / 2;
  let total = 1e-12;
  for (let k = 0; k < power.length; k++) total += power[k];

  const fundamentalRatio = bandEnergy(power, nyq, FUND_LO, FUND_HI) / total;
  const formantRatio = bandEnergy(power, nyq, FORMANT_LO, FORMANT_HI) / total;

  // Speech-likeness: meaningful fundamental presence + broad formant energy.
  const fundScore = Math.min(1, fundamentalRatio / FUND_RATIO_T);
  const formantScore = Math.min(1, formantRatio / FORMANT_RATIO_T);
  const voiceScore = 0.5 * fundScore + 0.5 * formantScore;

  const voicePresent =
    voiceScore >= SCORE_T &&
    fundamentalRatio >= FUND_RATIO_T * 0.6 &&
    formantRatio >= FORMANT_RATIO_T * 0.6;

  return { voicePresent, voiceScore, fundamentalRatio, formantRatio };
}
