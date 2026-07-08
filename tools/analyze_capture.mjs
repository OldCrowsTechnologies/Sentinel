/**
 * analyze_capture.mjs -- compare LoRa presence detectors on real captures.
 *
 * Loads a signal + noise .iq8 (raw u8 IQ from rf_capture) and scores each with
 * (a) the CURRENT continuous-chirp detectLora and (b) an IMPROVED per-symbol
 * dechirp, so we can see which actually separates real LoRa from noise.
 *
 *   node --experimental-strip-types tools/analyze_capture.mjs <signal.iq8> <noise.iq8>
 */
import fs from 'node:fs';
import { detectLora } from '../lib/loraDetect.ts';

const Fs = 1_024_000;
const BWs = [125e3, 250e3, 500e3];
const SFs = [7, 8, 9, 10, 11, 12];

function loadIQ(path) {
  const buf = fs.readFileSync(path);
  const n = buf.length >> 1;
  const I = new Float64Array(n);
  const Q = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    I[k] = (buf[2 * k] - 127.5) / 127.5;
    Q[k] = (buf[2 * k + 1] - 127.5) / 127.5;
  }
  return { I, Q };
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k], aIm = im[i + k];
        const bRe = re[i + k + len / 2] * cRe - im[i + k + len / 2] * cIm;
        const bIm = re[i + k + len / 2] * cIm + im[i + k + len / 2] * cRe;
        re[i + k] = aRe + bRe; im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe; im[i + k + len / 2] = aIm - bIm;
        const nRe = cRe * wRe - cIm * wIm; cIm = cRe * wIm + cIm * wRe; cRe = nRe;
      }
    }
  }
}

function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }

function buildRef(BW, SF) {
  const Tsym = Math.pow(2, SF) / BW;
  const Nsym = Math.round(Tsym * Fs);
  const re = new Float64Array(Nsym), im = new Float64Array(Nsym);
  for (let n = 0; n < Nsym; n++) {
    const t = n / Fs;
    const phi = 2 * Math.PI * (-BW / 2 * t + (BW / (2 * Tsym)) * t * t);
    re[n] = Math.cos(phi); im[n] = -Math.sin(phi); // conj(upchirp)
  }
  return { re, im, Nsym };
}

// Improved: per-symbol dechirp, max peak-to-average over slide positions + candidates.
function improvedScore({ I, Q }, maxSamples, maxWin = 500) {
  const N = Math.min(I.length, maxSamples);
  let best = 0, bestCand = 'none';
  for (const BW of BWs) for (const SF of SFs) {
    const ref = buildRef(BW, SF);
    const Nsym = ref.Nsym;
    if (Nsym < 16 || Nsym > N / 2) continue;
    const L = nextPow2(Nsym);
    const re = new Float64Array(L), im = new Float64Array(L);
    const hop = Math.max(1, Nsym >> 1);
    let localBest = 0, count = 0;
    for (let p = 0; p + Nsym <= N && count < maxWin; p += hop, count++) {
      for (let k = 0; k < L; k++) { re[k] = 0; im[k] = 0; }
      for (let k = 0; k < Nsym; k++) {
        const sRe = I[p + k], sIm = Q[p + k], rRe = ref.re[k], rIm = ref.im[k];
        re[k] = sRe * rRe - sIm * rIm;
        im[k] = sRe * rIm + sIm * rRe;
      }
      fft(re, im);
      let peak = 0, mean = 0;
      for (let m = 0; m < L; m++) { const pw = re[m] * re[m] + im[m] * im[m]; mean += pw; if (pw > peak) peak = pw; }
      mean = mean / L + 1e-12;
      const papr = peak / mean;
      if (papr > localBest) localBest = papr;
    }
    if (localBest > best) { best = localBest; bestCand = `BW${BW / 1e3}k/SF${SF}`; }
  }
  return { best, bestCand };
}

function currentMax({ I, Q }, maxSamples) {
  const N = Math.min(I.length, maxSamples);
  const W = 32768;
  let best = 0;
  for (let p = 0; p + W <= N; p += W) {
    const d = detectLora(I.subarray(p, p + W), Q.subarray(p, p + W), Fs);
    if (d.score > best) best = d.score;
  }
  return best;
}

const [sigPath, noisePath] = process.argv.slice(2);
const sig = loadIQ(sigPath);
const noi = loadIQ(noisePath);
const M = 512 * 1024; // ~0.5s is plenty

console.log(`samples: signal ${sig.I.length}, noise ${noi.I.length}\n`);
console.log('=== CURRENT detector (continuous-chirp, threshold 40) ===');
const cs = currentMax(sig, M), cn = currentMax(noi, M);
console.log(`  signal max score: ${cs.toFixed(1)}`);
console.log(`  noise  max score: ${cn.toFixed(1)}`);
console.log(`  separation: ${(cs / cn).toFixed(2)}x\n`);

console.log('=== IMPROVED detector (per-symbol dechirp PAPR) ===');
const is = improvedScore(sig, M), ino = improvedScore(noi, M);
console.log(`  signal max PAPR: ${is.best.toFixed(0)}  (${is.bestCand})`);
console.log(`  noise  max PAPR: ${ino.best.toFixed(0)}  (${ino.bestCand})`);
console.log(`  separation: ${(is.best / ino.best).toFixed(2)}x`);
