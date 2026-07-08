/**
 * rf_spectrogram.mjs -- ASCII spectrogram (time x freq) to SEE hop bursts.
 *   node --experimental-strip-types tools/rf_spectrogram.mjs <capture.iq8> <Fs> [seconds] [startSec]
 */
import fs from 'node:fs';

const path = process.argv[2];
const Fs = Math.round(parseFloat(process.argv[3] || '2400000'));
const seconds = parseFloat(process.argv[4] || '0.2');
const startSec = parseFloat(process.argv[5] || '0');

const buf = fs.readFileSync(path);
const total = buf.length >> 1;
const I = new Float64Array(total), Q = new Float64Array(total);
for (let k = 0; k < total; k++) { I[k] = (buf[2 * k] - 127.5) / 127.5; Q[k] = (buf[2 * k + 1] - 127.5) / 127.5; }

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = (-2 * Math.PI) / len, wRe = Math.cos(ang), wIm = Math.sin(ang); for (let i = 0; i < n; i += len) { let cRe = 1, cIm = 0; for (let k = 0; k < len / 2; k++) { const aRe = re[i + k], aIm = im[i + k]; const bRe = re[i + k + len / 2] * cRe - im[i + k + len / 2] * cIm; const bIm = re[i + k + len / 2] * cIm + im[i + k + len / 2] * cRe; re[i + k] = aRe + bRe; im[i + k] = aIm + bIm; re[i + k + len / 2] = aRe - bRe; im[i + k + len / 2] = aIm - bIm; const nRe = cRe * wRe - cIm * wIm; cIm = cRe * wIm + cIm * wRe; cRe = nRe; } } }
}

const L = 1024;         // freq resolution ~Fs/1024
const COLS = 64;        // freq columns (must divide L)
const rows = Math.floor((seconds * Fs) / L);
const start = Math.floor(startSec * Fs);
const re = new Float64Array(L), im = new Float64Array(L);
const frames = [];
let gmin = Infinity, gmax = -Infinity;
for (let r = 0; r < rows; r++) {
  const p = start + r * L;
  if (p + L > total) break;
  for (let k = 0; k < L; k++) { re[k] = I[p + k]; im[k] = Q[p + k]; }
  fft(re, im);
  // fftshift + coarse to COLS, dB
  const col = new Float64Array(COLS);
  const per = L / COLS;
  for (let c = 0; c < COLS; c++) {
    let s = 0;
    for (let k = 0; k < per; k++) { const idx = (c * per + k + L / 2) % L; s += re[idx] * re[idx] + im[idx] * im[idx]; }
    const db = 10 * Math.log10(s / per + 1e-12);
    col[c] = db; if (db < gmin) gmin = db; if (db > gmax) gmax = db;
  }
  frames.push(col);
}

const glyph = ' .:-=+*#%@';
console.log(`spectrogram ${path.split(/[\\/]/).pop()} | Fs ${(Fs / 1e6).toFixed(2)}MHz | ${frames.length} rows x ${COLS} cols | ${(L / Fs * 1e3).toFixed(2)} ms/row`);
console.log(`freq span: -${(Fs / 2e6).toFixed(2)} .. +${(Fs / 2e6).toFixed(2)} MHz around center | dB ${gmin.toFixed(0)}..${gmax.toFixed(0)}`);
const thr = gmin + (gmax - gmin) * 0.55; // highlight bursts
for (const col of frames) {
  let line = '';
  for (let c = 0; c < COLS; c++) {
    const t = Math.max(0, Math.min(1, (col[c] - gmin) / (gmax - gmin + 1e-9)));
    line += glyph[Math.round(t * (glyph.length - 1))];
  }
  console.log(line);
}
