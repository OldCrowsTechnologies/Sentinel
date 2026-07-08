/**
 * rf_hoptrack.mjs -- per-frame peak tracker: is there a strong narrowband peak
 * that HOPS across frequency (FHSS), or just weak random noise peaks?
 *   node --experimental-strip-types tools/rf_hoptrack.mjs <capture.iq8> <Fs> [frames] [startSec]
 */
import fs from 'node:fs';

const path = process.argv[2];
const Fs = Math.round(parseFloat(process.argv[3] || '2400000'));
const nFrames = parseInt(process.argv[4] || '70', 10);
const startSec = parseFloat(process.argv[5] || '0.5');

const buf = fs.readFileSync(path);
const total = buf.length >> 1;
const I = new Float64Array(total), Q = new Float64Array(total);
for (let k = 0; k < total; k++) { I[k] = (buf[2 * k] - 127.5) / 127.5; Q[k] = (buf[2 * k + 1] - 127.5) / 127.5; }

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = (-2 * Math.PI) / len, wRe = Math.cos(ang), wIm = Math.sin(ang); for (let i = 0; i < n; i += len) { let cRe = 1, cIm = 0; for (let k = 0; k < len / 2; k++) { const aRe = re[i + k], aIm = im[i + k]; const bRe = re[i + k + len / 2] * cRe - im[i + k + len / 2] * cIm; const bIm = re[i + k + len / 2] * cIm + im[i + k + len / 2] * cRe; re[i + k] = aRe + bRe; im[i + k] = aIm + bIm; re[i + k + len / 2] = aRe - bRe; im[i + k + len / 2] = aIm - bIm; const nRe = cRe * wRe - cIm * wIm; cIm = cRe * wIm + cIm * wRe; cRe = nRe; } } }
}

const L = 2048;
const EXCL = 6; // exclude +/- EXCL bins around DC (RTL center spike)
const re = new Float64Array(L), im = new Float64Array(L);
const start = Math.floor(startSec * Fs);
const p = new Float64Array(L);

console.log(`hoptrack ${path.split(/[\\/]/).pop()} | Fs ${(Fs / 1e6).toFixed(2)}MHz | bin ${(Fs / L / 1e3).toFixed(1)}kHz | ${(L / Fs * 1e3).toFixed(2)}ms/frame`);
console.log('frame   t(ms)   peakOffset(kHz)   peakOverMedian(dB)   bar');
let strong = 0;
const offsets = [];
for (let f = 0; f < nFrames; f++) {
  const off = start + f * L;
  if (off + L > total) break;
  for (let k = 0; k < L; k++) { re[k] = I[off + k]; im[k] = Q[off + k]; }
  fft(re, im);
  for (let m = 0; m < L; m++) p[m] = re[m] * re[m] + im[m] * im[m];
  const sorted = Float64Array.from(p).sort();
  const med = sorted[L >> 1] + 1e-12;
  let peak = 0, peakBin = 0;
  for (let m = 0; m < L; m++) {
    if (m <= EXCL || m >= L - EXCL) continue; // skip DC spike
    if (p[m] > peak) { peak = p[m]; peakBin = m; }
  }
  const offKHz = ((peakBin < L / 2 ? peakBin : peakBin - L) * Fs / L) / 1e3;
  const db = 10 * Math.log10(peak / med);
  if (db > 10) { strong++; offsets.push(offKHz); }
  const bar = '#'.repeat(Math.max(0, Math.round(db)));
  console.log(`${String(f).padStart(4)}  ${(f * L / Fs * 1e3).toFixed(2).padStart(6)}   ${offKHz.toFixed(0).padStart(8)}          ${db.toFixed(1).padStart(5)}   ${bar}`);
}
const uniq = new Set(offsets.map((o) => Math.round(o / 100) * 100));
console.log(`\nframes with strong peak (>10dB): ${strong}/${nFrames}`);
console.log(`distinct ~100kHz peak locations among them: ${uniq.size}  -> ${[...uniq].sort((a, b) => a - b).join(', ')} kHz`);
