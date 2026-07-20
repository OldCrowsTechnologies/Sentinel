/**
 * mlClassifier.ts -- Corvus drone classifier (pure TypeScript inference).
 *
 * Loads the JSON "brain" produced by training/train_corvus.py and runs the
 * forward pass on-device. No TFLite, no tfjs runtime -- just standardization,
 * a small MLP, and softmax. Features come from lib/dsp.ts, whose math is
 * verified identical to the trainer (training/verify_parity.*).
 */

import { extractFeatures, estimateDominantHz, filteredPeak } from './dsp';
import type { DspConfig } from './dsp';
import { detectVoice } from './vad';
import { Config } from './config';

export interface CorvusLayer {
  W: number[][]; // (in, out)
  b: number[];
  activation: 'relu' | 'softmax';
}

export interface CorvusModel {
  version: number;
  format: string;
  labels: string[];
  dsp: {
    sampleRate: number;
    nfft: number;
    hop: number;
    nMels: number;
    clipSec: number;
    bandRatios: [number, number][];
    melFilterbank: number[][];
    highPass?: { enabled: boolean; fc: number; order: number };
    stationarity?: { enabled: boolean; eps: number; minFrames?: number; floor?: number };
    harmonics?: { enabled: boolean; band: [number, number]; lagHz: [number, number] };
  };
  featureDim: number;
  scaler: { mean: number[]; scale: number[] };
  mlp: { layers: CorvusLayer[] };
  openSet?: OpenSetConfig;
}

export interface OpenSetClassStat {
  label: string;
  count: number;
  centroid: number[]; // in standardized feature space
  variance: number[];
}

export interface OpenSetConfig {
  classStats: OpenSetClassStat[];
  noneIndex: number;
  unknownIndex: number;
  specificDroneIndices: number[];
  // Full-taxonomy grouping (v3+). Optional so pre-taxonomy models still load.
  nonThreatIndices?: number[]; // None, Bird, Manned rotorcraft, Manned fixed-wing
  threatIndices?: number[]; // any UAS (categories + models + Unknown)
  categoryIndices?: number[]; // acoustic TYPE fallback (Small/Med/Large multirotor, FPV, Fixed-wing UAS, Combustion UAS)
  thresholds: { droneGate: number; matchProb: number; oodDistance: number };
}

export const UNKNOWN_BUILD_LABEL = 'Unknown build';

export type DroneCategory = 'electric-multirotor' | 'unknown';
export type SizeClass = 'small' | 'medium' | 'large';

/** Open-set recognition result: is it a drone, and is it a KNOWN drone? */
export interface OpenSetVerdict {
  dronePresent: boolean;
  droneness: number; // 1 - sum P(non-threat classes)  (= total threat probability)
  isUnknownBuild: boolean; // drone present, but not a confident library match
  matchedModel: string | null; // known model label when matched
  oodScore: number; // nearest-known normalized distance (higher = more novel)
  category: DroneCategory;
  estFundamentalHz: number | null; // acoustic "possible spec" for unknown builds
  sizeClass: SizeClass | null; // coarse size from the rotor fundamental
  // Full-taxonomy call-outs: the single best human label for this contact.
  calloutLabel: string; // drone model/type when present, else the non-threat class
  nonThreatLabel: string; // best non-threat class (None/Bird/Helicopter/Jet) -- VAD fallback
}

export interface ClassificationResult {
  label: string;
  confidence: number; // 0-100, probability of top class
  classIdx: number;
  probs: number[];
  rms: number;
  distance: number; // rough point estimate, feet
  distanceMin: number; // lower bound of the (wide) range band, feet
  distanceMax: number; // upper bound of the (wide) range band, feet
  bearing: number; // -1 = unknown (single mic: no direction-finding)
  timestamp: number;
  openSet: OpenSetVerdict;
  // Noise-rejection outputs
  droneDetected: boolean; // after VAD confidence gating
  voicePresent: boolean; // VAD flagged speech in this window
  filteredAudioPeak: number; // peak |amp| of the high-passed signal
  confidenceAdjusted: boolean; // a VAD penalty/suppression was applied
}

/** Standardize a feature vector: (x - mean) / scale. */
export function standardize(feat: ArrayLike<number>, model: CorvusModel): Float64Array {
  const { mean, scale } = model.scaler;
  const out = new Float64Array(feat.length);
  for (let i = 0; i < feat.length; i++) out[i] = (feat[i] - mean[i]) / scale[i];
  return out;
}

/** Forward pass through the exported MLP. Returns class probabilities. */
export function forwardMLP(x: ArrayLike<number>, model: CorvusModel): number[] {
  let a: number[] = Array.from(x as number[]);
  for (const layer of model.mlp.layers) {
    const outDim = layer.b.length;
    const z = new Array<number>(outDim).fill(0);
    for (let o = 0; o < outDim; o++) {
      let s = layer.b[o];
      for (let i = 0; i < a.length; i++) s += a[i] * layer.W[i][o];
      z[o] = s;
    }
    if (layer.activation === 'relu') {
      for (let o = 0; o < outDim; o++) z[o] = z[o] > 0 ? z[o] : 0;
    } else {
      // softmax (numerically stable)
      let m = -Infinity;
      for (let o = 0; o < outDim; o++) if (z[o] > m) m = z[o];
      let sum = 0;
      for (let o = 0; o < outDim; o++) {
        z[o] = Math.exp(z[o] - m);
        sum += z[o];
      }
      for (let o = 0; o < outDim; o++) z[o] /= sum;
    }
    a = z;
  }
  return a;
}

// Best-effort per-platform reference loudness: the broadband RMS we'd expect
// from that drone at refDistanceFeet. These are UNCALIBRATED estimates ordered
// by rotor size/SPL (bigger props -> louder) until a measured flight refines
// them. Used only for the rough inverse-square range estimate.
const REF_RMS_BY_LABEL: Record<string, number> = {
  'DJI Phantom': 0.060, // large props, loudest
  'Skydio X2': 0.045,
  'Parrot Anafi': 0.035, // smaller/quieter
  Unknown: 0.050,
};
const DEFAULT_REF_RMS = 0.05;

export class DroneClassifier {
  private model: CorvusModel;
  private cfg: DspConfig;
  private confidenceThreshold = 0.7;
  // SPL calibration for the rough distance estimate
  private refDistanceFeet = 100;

  constructor(model: CorvusModel) {
    this.model = model;
    this.cfg = {
      sampleRate: model.dsp.sampleRate,
      nfft: model.dsp.nfft,
      hop: model.dsp.hop,
      nMels: model.dsp.nMels,
      bandRatios: model.dsp.bandRatios,
      melFilterbank: model.dsp.melFilterbank,
      highPass: model.dsp.highPass, // trained-in high-pass (parity-safe)
      stationarity: model.dsp.stationarity, // trained-in voice/crowd suppression
      harmonics: model.dsp.harmonics, // trained-in rotor-comb tonality features
    };
  }

  // Kept for API compatibility with the previous interface. Model is bundled,
  // so there is nothing async to load.
  async loadModel(): Promise<void> {
    return;
  }

  ready(): boolean {
    return !!this.model && this.model.mlp.layers.length > 0;
  }

  getLabels(): string[] {
    return this.model.labels;
  }

  setConfidenceThreshold(t: number): void {
    this.confidenceThreshold = Math.max(0.5, Math.min(1, t));
  }

  /** Classify a window of mono PCM samples (~[-1, 1]). */
  classifySamples(samples: Float32Array | number[]): ClassificationResult {
    const feat = extractFeatures(samples, this.cfg);
    const x = standardize(feat, this.model);
    const probs = forwardMLP(x, this.model);

    let classIdx = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[classIdx]) classIdx = i;
    const confidence = probs[classIdx] * 100;

    // RMS (for distance estimate + a "no drone" gate)
    let sq = 0;
    for (let i = 0; i < samples.length; i++) sq += (samples[i] as number) * (samples[i] as number);
    const rms = Math.sqrt(sq / Math.max(1, samples.length));

    const rawLabel = this.model.labels[classIdx];
    const verdict = this.openSetVerdict(x, probs, samples);

    // The reported label is the OPEN-SET call-out, which names the most specific
    // class the sound supports across the FULL taxonomy: a confident brand
    // (Skydio X2), else the acoustic TYPE (FPV racer / Combustion UAS / Medium
    // multirotor), else "Unknown build" for an uncategorizable UAS, else the
    // non-threat class positively called out (Bird / Manned rotorcraft / Manned
    // fixed-wing / None).
    const label = verdict.calloutLabel;
    const distance = this.estimateDistance(rms, verdict.matchedModel ?? rawLabel);

    // --- Noise rejection: VAD + confidence gating (runtime-safe) ---
    const voice = Config.ENABLE_VAD_CHECK ? detectVoice(samples, this.cfg) : null;
    const voicePresent = !!voice?.voicePresent;
    const fc = this.cfg.highPass?.enabled ? this.cfg.highPass.fc : Config.HIGH_PASS_FC;
    const filteredAudioPeak = filteredPeak(samples, fc, this.cfg.sampleRate);

    let adjConfidence = confidence;
    let droneDetected = verdict.dronePresent;
    let confidenceAdjusted = false;
    if (voicePresent && droneDetected) {
      if (confidence > 90) {
        // Strong signal survives noise -> no penalty.
      } else if (confidence > 85) {
        adjConfidence = confidence - Config.VAD_CONFIDENCE_PENALTY * 100;
        confidenceAdjusted = true;
      } else if (confidence < 70) {
        // Likely a false positive during speech -> ignore the detection.
        droneDetected = false;
        confidenceAdjusted = true;
      }
    }

    // Final call-out: a confirmed UAS shows its model/type; a UAS suppressed by
    // the voice gate falls back to the ambient (non-threat) readout; a genuine
    // non-threat (Bird/Helicopter/Jet/None) is called out positively.
    const reportedLabel = droneDetected
      ? label
      : verdict.dronePresent
        ? verdict.nonThreatLabel
        : label;

    return {
      label: reportedLabel,
      confidence: adjConfidence,
      classIdx,
      probs,
      rms,
      distance,
      // Acoustic range from loudness is inherently imprecise (drone throttle,
      // wind, and the phone's auto-gain all move RMS), so we report a wide band
      // rather than false precision. ~0.65x..1.55x of the point estimate.
      distanceMin: Math.max(30, Math.round(distance * 0.65)),
      distanceMax: Math.min(1500, Math.round(distance * 1.55)),
      bearing: -1, // single mic: no direction-finding
      timestamp: Date.now(),
      openSet: verdict,
      droneDetected,
      voicePresent,
      filteredAudioPeak,
      confidenceAdjusted,
    };
  }

  /**
   * Open-set recognition: decide whether a drone is present, whether it's a
   * confident match to a KNOWN library model, or a novel/"unknown build", and
   * attach a coarse acoustic "possible spec". Degrades gracefully on a model
   * with no openSet block (treats the raw argmax as the verdict).
   */
  private openSetVerdict(
    x: Float64Array,
    probs: number[],
    samples: Float32Array | number[]
  ): OpenSetVerdict {
    const labels = this.model.labels;
    let argmax = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[argmax]) argmax = i;

    const os = this.model.openSet;
    if (!os) {
      const lbl = labels[argmax];
      const present = lbl !== 'None';
      return {
        dronePresent: present,
        droneness: present ? probs[argmax] : 0,
        isUnknownBuild: lbl === 'Unknown',
        matchedModel: present && lbl !== 'Unknown' ? lbl : null,
        oodScore: 0,
        category: present ? 'electric-multirotor' : 'unknown',
        estFundamentalHz: null,
        sizeClass: null,
        calloutLabel: lbl,
        nonThreatLabel: present ? 'None' : lbl,
      };
    }

    const { noneIndex, specificDroneIndices, classStats, thresholds } = os;
    // Non-threat set: None + Bird + Manned rotorcraft + Manned fixed-wing.
    // droneness = total THREAT probability = 1 - sum(P over non-threat). This
    // replaces the old 1 - P(None), which wrongly treated a jet/bird as a drone.
    const nonThreat = os.nonThreatIndices ?? (noneIndex >= 0 ? [noneIndex] : []);
    const categoryIdx = os.categoryIndices ?? [];
    let nonThreatProb = 0;
    for (const i of nonThreat) nonThreatProb += probs[i];
    const droneness = nonThreat.length ? 1 - nonThreatProb : Math.max(...probs);
    const dronePresent = droneness >= thresholds.droneGate;

    // Best non-threat class label (for positive call-outs + VAD fallback).
    let bestNT = noneIndex >= 0 ? noneIndex : (nonThreat[0] ?? argmax);
    for (const i of nonThreat) if (probs[i] > probs[bestNT]) bestNT = i;
    const nonThreatLabel = labels[bestNT] ?? 'None';

    // Nearest known specific-MODEL class by variance-normalized distance (OOD).
    let oodScore = Infinity;
    let bestSpecific = -1;
    let bestSpecificProb = -1;
    for (const c of specificDroneIndices) {
      const st = classStats[c];
      let acc = 0;
      for (let i = 0; i < x.length; i++) {
        const d = x[i] - st.centroid[i];
        acc += (d * d) / st.variance[i];
      }
      const dist = Math.sqrt(acc / x.length);
      if (dist < oodScore) oodScore = dist;
      if (probs[c] > bestSpecificProb) {
        bestSpecificProb = probs[c];
        bestSpecific = c;
      }
    }
    if (!isFinite(oodScore)) oodScore = 999;

    let matchedModel: string | null = null;
    let isUnknownBuild = false;
    let calloutLabel: string;
    if (dronePresent) {
      const goodMatch =
        bestSpecific >= 0 &&
        bestSpecificProb >= thresholds.matchProb &&
        oodScore <= thresholds.oodDistance;
      if (goodMatch) {
        matchedModel = labels[bestSpecific];
        calloutLabel = matchedModel; // confident brand, e.g. "Skydio X2"
      } else if (categoryIdx.includes(argmax)) {
        // No confident brand, but the sound maps to a known TYPE -> call the
        // category, e.g. "FPV racer" / "Combustion UAS" / "Medium multirotor".
        calloutLabel = labels[argmax];
        isUnknownBuild = true;
      } else {
        calloutLabel = UNKNOWN_BUILD_LABEL; // drone present, uncategorizable
        isUnknownBuild = true;
      }
    } else {
      // Not a UAS -> positively call out the non-threat class it is.
      calloutLabel = nonThreatLabel; // None / Bird / Manned rotorcraft / Manned fixed-wing
    }

    // Acoustic "possible spec" estimate (diagnostic only) for unknown builds.
    let estFundamentalHz: number | null = null;
    let sizeClass: SizeClass | null = null;
    if (dronePresent) {
      const hz = estimateDominantHz(samples, this.cfg);
      if (hz > 0) {
        estFundamentalHz = Math.round(hz);
        sizeClass = hz >= 1400 ? 'small' : hz >= 900 ? 'medium' : 'large';
      }
    }

    return {
      dronePresent,
      droneness,
      isUnknownBuild,
      matchedModel,
      oodScore,
      category: dronePresent ? 'electric-multirotor' : 'unknown',
      estFundamentalHz,
      sizeClass,
      calloutLabel,
      nonThreatLabel,
    };
  }

  private estimateDistance(rms: number, label?: string): number {
    // Inverse-square: louder -> closer. Uses a per-drone reference loudness
    // (best-effort until a measured flight calibrates it).
    const refRms = (label && REF_RMS_BY_LABEL[label]) || DEFAULT_REF_RMS;
    const d = this.refDistanceFeet * Math.sqrt(refRms / Math.max(rms, 1e-6));
    return Math.max(30, Math.min(1500, d));
  }
}

export default DroneClassifier;
