/**
 * mlClassifier.ts -- Corvus drone classifier (pure TypeScript inference).
 *
 * Loads the JSON "brain" produced by training/train_corvus.py and runs the
 * forward pass on-device. No TFLite, no tfjs runtime -- just standardization,
 * a small MLP, and softmax. Features come from lib/dsp.ts, whose math is
 * verified identical to the trainer (training/verify_parity.*).
 */

import { extractFeatures } from './dsp';
import type { DspConfig } from './dsp';

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
  };
  featureDim: number;
  scaler: { mean: number[]; scale: number[] };
  mlp: { layers: CorvusLayer[] };
}

export interface ClassificationResult {
  label: string;
  confidence: number; // 0-100, probability of top class
  classIdx: number;
  probs: number[];
  rms: number;
  distance: number; // rough estimate, feet
  bearing: number; // -1 = unknown (mono mic in MVP)
  timestamp: number;
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

export class DroneClassifier {
  private model: CorvusModel;
  private cfg: DspConfig;
  private confidenceThreshold = 0.7;
  // SPL calibration for the rough distance estimate
  private refDistanceFeet = 100;
  private refRms = 0.05; // RMS of a drone at ~100 ft (calibrate per device)

  constructor(model: CorvusModel) {
    this.model = model;
    this.cfg = {
      sampleRate: model.dsp.sampleRate,
      nfft: model.dsp.nfft,
      hop: model.dsp.hop,
      nMels: model.dsp.nMels,
      bandRatios: model.dsp.bandRatios,
      melFilterbank: model.dsp.melFilterbank,
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

    const distance = this.estimateDistance(rms);

    return {
      label: this.model.labels[classIdx],
      confidence,
      classIdx,
      probs,
      rms,
      distance,
      bearing: -1, // mono mic: bearing not available in MVP
      timestamp: Date.now(),
    };
  }

  private estimateDistance(rms: number): number {
    // Inverse-square: louder -> closer. Calibrate refRms/refDistanceFeet per device.
    const d = this.refDistanceFeet * Math.sqrt(this.refRms / Math.max(rms, 1e-6));
    return Math.max(30, Math.min(1500, d));
  }
}

export default DroneClassifier;
