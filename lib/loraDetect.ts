/**
 * loraDetect.ts -- LoRa / chirp-spread-spectrum PRESENCE detector (Tier-3 RF).
 *
 * This is the hardware-independent signal-processing core: given complex IQ
 * baseband (from an external SDR, e.g. RTL-SDR over USB-C), it decides whether a
 * LoRa-style linear chirp is present, WITHOUT decoding it. Method: "dechirp" the
 * IQ against a bank of reference chirp slopes (the common LoRa BW/SF combos);
 * a matching slope collapses the chirp to a tone, producing a sharp FFT peak
 * (high peak-to-average power ratio). Noise produces no such peak.
 *
 * Detecting *presence* of an active LoRa/ExpressLRS control link is the useful
 * counter-UAS signal; full demodulation is out of scope. The native USB/SDR
 * driver that feeds IQ here is the remaining (hardware-gated) work --
 * rfSensorService.processIqFrame() is the seam.
 */

// Self-contained in-place radix-2 FFT (kept local so this module has no internal
// imports and stays unit-testable on its own).
function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
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

export interface LoraDetection {
  present: boolean;
  score: number; // peak-to-average power ratio at the best-matching slope
  slopeHzPerS: number; // chirp slope that matched (0 if none)
  rssiDb: number; // relative received power (uncalibrated)
}

/** Chirp slopes (Hz/s) for common LoRa configs: slope = BW^2 / 2^SF. */
export function loraCandidateSlopes(): number[] {
  const BWs = [125e3, 250e3, 500e3];
  const SFs = [7, 8, 9, 10, 11, 12];
  const set = new Set<number>();
  for (const bw of BWs) for (const sf of SFs) set.add((bw * bw) / Math.pow(2, sf));
  return Array.from(set).sort((a, b) => a - b);
}

function pow2Floor(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

/**
 * Detect a LoRa-style chirp in an IQ frame. iqI/iqQ are the real/imaginary
 * baseband samples; sampleRate is the SDR sample rate (Hz).
 */
export function detectLora(
  iqI: ArrayLike<number>,
  iqQ: ArrayLike<number>,
  sampleRate: number,
  candidates: number[] = loraCandidateSlopes(),
  threshold = 40
): LoraDetection {
  const N = pow2Floor(Math.min(iqI.length, iqQ.length));
  if (N < 8) return { present: false, score: 0, slopeHzPerS: 0, rssiDb: -120 };

  let power = 0;
  for (let n = 0; n < N; n++) power += iqI[n] * iqI[n] + iqQ[n] * iqQ[n];
  power /= N;
  const rssiDb = 10 * Math.log10(power + 1e-12);

  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const t2 = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const t = n / sampleRate;
    t2[n] = t * t;
  }

  let best = 0;
  let bestSlope = 0;
  for (const k of candidates) {
    const a = Math.PI * k; // phase = pi*k*t^2 ; dechirp ref = exp(-j*phase)
    for (let n = 0; n < N; n++) {
      const phi = a * t2[n];
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const I = iqI[n];
      const Q = iqQ[n];
      // (I + jQ) * (cos - j sin)
      re[n] = I * c + Q * s;
      im[n] = Q * c - I * s;
    }
    fftRadix2(re, im);
    let peak = 0;
    let mean = 0;
    for (let m = 0; m < N; m++) {
      const p = re[m] * re[m] + im[m] * im[m];
      mean += p;
      if (p > peak) peak = p;
    }
    mean = mean / N + 1e-12;
    const papr = peak / mean;
    if (papr > best) {
      best = papr;
      bestSlope = k;
    }
  }

  return { present: best >= threshold, score: best, slopeHzPerS: bestSlope, rssiDb };
}
