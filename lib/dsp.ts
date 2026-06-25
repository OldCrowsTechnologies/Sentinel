/**
 * dsp.ts -- On-device acoustic feature extraction for Corvus Sentinel.
 *
 * This is a byte-for-byte port of training/corvus_features.py. The trained
 * model is only valid if the features it sees in the field match the features
 * it was trained on, so the math here MUST stay in lockstep with the Python.
 * (A parity test in training/verify_parity.* checks this automatically.)
 *
 * Pure TypeScript -- no native modules, no tfjs. Works anywhere JS runs.
 */

export interface DspConfig {
  sampleRate: number;
  nfft: number;
  hop: number;
  nMels: number;
  bandRatios: [number, number][];
  melFilterbank: number[][]; // (nMels, nfft/2+1), exported by the trainer
}

/** np.hanning(M): w[n] = 0.5 - 0.5*cos(2*pi*n/(M-1)) */
function hann(M: number): Float64Array {
  const w = new Float64Array(M);
  if (M === 1) {
    w[0] = 1;
    return w;
  }
  for (let n = 0; n < M; n++) {
    w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (M - 1));
  }
  return w;
}

/**
 * In-place iterative radix-2 Cooley-Tukey FFT.
 * re/im are length N (N power of two). Uses the e^{-2pi i kn/N} convention,
 * matching numpy. (Power = re^2+im^2 is sign-convention independent anyway.)
 */
function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * Extract the Corvus feature vector from mono samples (~[-1,1]).
 * Returns Float64Array of length 2*nMels + bandRatios.length.
 */
export function extractFeatures(samples: ArrayLike<number>, cfg: DspConfig): Float64Array {
  const { nfft, hop, nMels, melFilterbank, bandRatios, sampleRate } = cfg;
  const nBins = nfft / 2 + 1;
  const win = hann(nfft);

  // Copy + DC removal (subtract mean of whole signal)
  const len = samples.length;
  const x = new Float64Array(Math.max(len, nfft));
  let mean = 0;
  for (let i = 0; i < len; i++) mean += samples[i];
  mean = len > 0 ? mean / len : 0;
  for (let i = 0; i < len; i++) x[i] = samples[i] - mean;
  // (zero-padded tail already 0 - mean? Python pads AFTER dc removal only when
  // len<nfft via _frame_signal which pads zeros; those pads are 0, not -mean.
  // We replicate: if len<nfft, the pad region must be 0, not -mean.)
  if (len < nfft) {
    for (let i = len; i < nfft; i++) x[i] = 0;
  }

  const nFrames = 1 + Math.floor((x.length - nfft) / hop);

  const melMean = new Float64Array(nMels);
  const melSqAcc = new Float64Array(nMels); // for std
  const melFrames: Float64Array[] = [];
  const meanPower = new Float64Array(nBins);

  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);

  for (let f = 0; f < nFrames; f++) {
    const start = f * hop;
    for (let i = 0; i < nfft; i++) {
      re[i] = x[start + i] * win[i];
      im[i] = 0;
    }
    fftRadix2(re, im);

    // power spectrum (first nBins)
    const power = new Float64Array(nBins);
    for (let k = 0; k < nBins; k++) {
      power[k] = re[k] * re[k] + im[k] * im[k];
      meanPower[k] += power[k];
    }

    // mel energies (log)
    const logMel = new Float64Array(nMels);
    for (let m = 0; m < nMels; m++) {
      const fb = melFilterbank[m];
      let e = 0;
      for (let k = 0; k < nBins; k++) e += power[k] * fb[k];
      logMel[m] = Math.log(e + 1e-10);
      melMean[m] += logMel[m];
    }
    melFrames.push(logMel);
  }

  for (let m = 0; m < nMels; m++) melMean[m] /= nFrames;
  for (let f = 0; f < nFrames; f++) {
    for (let m = 0; m < nMels; m++) {
      const d = melFrames[f][m] - melMean[m];
      melSqAcc[m] += d * d;
    }
  }
  const melStd = new Float64Array(nMels);
  for (let m = 0; m < nMels; m++) melStd[m] = Math.sqrt(melSqAcc[m] / nFrames);

  for (let k = 0; k < nBins; k++) meanPower[k] /= nFrames;

  // band-energy ratios
  let total = 1e-10;
  for (let k = 0; k < nBins; k++) total += meanPower[k];
  const nyq = sampleRate / 2;
  const ratios = new Float64Array(bandRatios.length);
  for (let b = 0; b < bandRatios.length; b++) {
    const [lo, hi] = bandRatios[b];
    let s = 0;
    for (let k = 0; k < nBins; k++) {
      const freq = (k * nyq) / (nBins - 1);
      if (freq >= lo && freq < hi) s += meanPower[k];
    }
    ratios[b] = s / total;
  }

  const out = new Float64Array(2 * nMels + bandRatios.length);
  out.set(melMean, 0);
  out.set(melStd, nMels);
  out.set(ratios, 2 * nMels);
  return out;
}

/**
 * Estimate the dominant rotor/tonal frequency (Hz) in a window, for the
 * acoustic "possible spec" on unknown/homemade contacts. This is a DIAGNOSTIC
 * ONLY -- it is NOT part of the model feature path, so it has no parity
 * obligation. Averages the periodogram across frames and returns the peak-energy
 * frequency within [fmin, fmax].
 */
export function estimateDominantHz(
  samples: ArrayLike<number>,
  cfg: DspConfig,
  fmin = 150,
  fmax = 2500
): number {
  const { nfft, hop, sampleRate } = cfg;
  const nBins = nfft / 2 + 1;
  const win = hann(nfft);
  const len = samples.length;
  const x = new Float64Array(Math.max(len, nfft));
  let mean = 0;
  for (let i = 0; i < len; i++) mean += samples[i];
  mean = len > 0 ? mean / len : 0;
  for (let i = 0; i < len; i++) x[i] = samples[i] - mean;

  const nFrames = 1 + Math.floor((x.length - nfft) / hop);
  const meanPower = new Float64Array(nBins);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  for (let f = 0; f < nFrames; f++) {
    const start = f * hop;
    for (let i = 0; i < nfft; i++) {
      re[i] = x[start + i] * win[i];
      im[i] = 0;
    }
    fftRadix2(re, im);
    for (let k = 0; k < nBins; k++) meanPower[k] += re[k] * re[k] + im[k] * im[k];
  }

  const nyq = sampleRate / 2;
  let bestBin = -1;
  let bestVal = -1;
  for (let k = 0; k < nBins; k++) {
    const freq = (k * nyq) / (nBins - 1);
    if (freq < fmin || freq > fmax) continue;
    if (meanPower[k] > bestVal) {
      bestVal = meanPower[k];
      bestBin = k;
    }
  }
  if (bestBin < 0) return 0;
  return (bestBin * nyq) / (nBins - 1);
}
