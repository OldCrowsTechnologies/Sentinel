/**
 * rfEnergyDetect.ts -- energy / narrowband-burst presence detector for sub-GHz
 * control links. This is the PRIMARY RF detector: real drone control links
 * (ELRS / FrSky / generic FHSS) and telemetry don't present as a single clean
 * LoRa chirp -- they're narrowband bursts that hop, so a matched-chirp detector
 * misses them. What they DO reliably show is a narrowband peak sitting well above
 * the noise floor within the ISM band. This detects exactly that.
 *
 * Method: Welch-averaged periodogram (average several sub-window FFTs) to smooth
 * the noise floor, exclude the RTL-SDR DC/center spike, then measure the strongest
 * bin's excess over the MEDIAN (robust noise floor). Real emissions clear the
 * floor by >10 dB; averaged noise sits a few dB over median, so the two separate
 * cleanly. Validated against real captures (drone link, LoRa32, and noise) with
 * tools/rf_probe. loraDetect (chirp) remains a secondary "is it LoRa CSS?" tag.
 */

// Self-contained in-place radix-2 FFT (no imports; unit-testable standalone).
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
      let cRe = 1;
      let cIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * cRe - im[i + k + len / 2] * cIm;
        const bIm = re[i + k + len / 2] * cIm + im[i + k + len / 2] * cRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = nRe;
      }
    }
  }
}

function pow2Floor(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

export interface EnergyDetection {
  present: boolean;
  peakDb: number; // strongest bin's excess over the median noise floor (dB)
  peakOffsetHz: number; // frequency offset of that bin from tune center
  occupancy: number; // fraction of bins > 6 dB over floor (spread/wideband hint)
  floorDb: number; // absolute median floor (10log10 power; uncalibrated)
}

export interface EnergyOptions {
  subWin?: number; // sub-window size for Welch averaging (power of 2)
  maxAvg?: number; // cap on sub-windows averaged (bounds CPU)
  excludeDcBins?: number; // bins each side of DC to ignore (RTL center spike)
  thresholdDb?: number; // peak-over-floor dB to call "present"
}

/**
 * Detect a narrowband emission in an IQ frame via Welch-averaged spectral
 * peak-over-floor. Hardware-independent; fed by rfSensorService.
 */
export function detectEnergy(
  iqI: ArrayLike<number>,
  iqQ: ArrayLike<number>,
  sampleRate: number,
  opts: EnergyOptions = {}
): EnergyDetection {
  const subWin = pow2Floor(opts.subWin ?? 2048);
  const maxAvg = opts.maxAvg ?? 24;
  const excl = opts.excludeDcBins ?? 4;
  const threshold = opts.thresholdDb ?? 9;

  const N = Math.min(iqI.length, iqQ.length);
  const nAvg = Math.min(maxAvg, Math.floor(N / subWin));
  if (nAvg < 1 || subWin < 16) {
    return { present: false, peakDb: 0, peakOffsetHz: 0, occupancy: 0, floorDb: -120 };
  }

  const re = new Float64Array(subWin);
  const im = new Float64Array(subWin);
  const avg = new Float64Array(subWin);

  for (let w = 0; w < nAvg; w++) {
    const base = w * subWin;
    for (let k = 0; k < subWin; k++) {
      re[k] = iqI[base + k];
      im[k] = iqQ[base + k];
    }
    fftRadix2(re, im);
    for (let m = 0; m < subWin; m++) avg[m] += re[m] * re[m] + im[m] * im[m];
  }
  for (let m = 0; m < subWin; m++) avg[m] /= nAvg;

  // Robust floor = median of included bins (exclude DC/center spike).
  const included: number[] = [];
  for (let m = 0; m < subWin; m++) {
    if (m <= excl || m >= subWin - excl) continue;
    included.push(avg[m]);
  }
  included.sort((a, b) => a - b);
  const floor = included[included.length >> 1] + 1e-12;

  let peak = 0;
  let peakBin = 0;
  let occ = 0;
  const occThresh = floor * 3.981; // +6 dB
  for (let m = 0; m < subWin; m++) {
    if (m <= excl || m >= subWin - excl) continue;
    const p = avg[m];
    if (p > peak) {
      peak = p;
      peakBin = m;
    }
    if (p > occThresh) occ++;
  }

  const peakDb = 10 * Math.log10(peak / floor);
  const binHz = sampleRate / subWin;
  const peakOffsetHz = (peakBin < subWin / 2 ? peakBin : peakBin - subWin) * binHz;

  return {
    present: peakDb >= threshold,
    peakDb,
    peakOffsetHz,
    occupancy: occ / included.length,
    floorDb: 10 * Math.log10(floor),
  };
}
