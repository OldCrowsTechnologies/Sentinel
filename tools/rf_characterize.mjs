/**
 * rf_characterize.mjs -- is the emission a continuous carrier or bursty packets?
 * Mixes the band around <offsetKHz> to DC, decimates, and prints a power-vs-time
 * envelope + duty stats.
 *   node --experimental-strip-types tools/rf_characterize.mjs <capture.iq8> <offsetKHz>
 */
import fs from 'node:fs';

const Fs = 1_024_000;
const path = process.argv[2];
const offKHz = parseFloat(process.argv[3] || '200');
const off = offKHz * 1e3;

const buf = fs.readFileSync(path);
const n = buf.length >> 1;
const I = new Float64Array(n), Q = new Float64Array(n);
for (let k = 0; k < n; k++) { I[k] = (buf[2 * k] - 127.5) / 127.5; Q[k] = (buf[2 * k + 1] - 127.5) / 127.5; }

// Mix by -off (bring +off to DC), boxcar-decimate by D -> ~Fs/D bandwidth around the emission.
const D = 32; // decimated rate 32 kHz-ish band (Fs/D = 32 kHz)
const decRate = Fs / D;
const M = Math.floor(n / D);
const pw = new Float64Array(M); // power per decimated sample
for (let m = 0; m < M; m++) {
  let accRe = 0, accIm = 0;
  for (let d = 0; d < D; d++) {
    const idx = m * D + d;
    const ph = -2 * Math.PI * off * (idx / Fs);
    const c = Math.cos(ph), s = Math.sin(ph);
    accRe += I[idx] * c - Q[idx] * s;
    accIm += I[idx] * s + Q[idx] * c;
  }
  pw[m] = (accRe * accRe + accIm * accIm) / (D * D);
}

// stats
const sorted = Float64Array.from(pw).sort();
const med = sorted[M >> 1];
const p95 = sorted[Math.floor(M * 0.95)];
const max = sorted[M - 1];
const thr = med * 4; // "on" = 6 dB over median
let onCount = 0;
for (let m = 0; m < M; m++) if (pw[m] > thr) onCount++;
const duty = (100 * onCount) / M;

console.log(`emission @ +${offKHz} kHz | decimated rate ${(decRate / 1e3).toFixed(0)} kHz | ${(M / decRate).toFixed(2)} s`);
console.log(`median ${(10 * Math.log10(med + 1e-12)).toFixed(1)} dB, p95 ${(10 * Math.log10(p95 + 1e-12)).toFixed(1)} dB, max ${(10 * Math.log10(max + 1e-12)).toFixed(1)} dB`);
console.log(`peak-over-median: ${(10 * Math.log10(max / med)).toFixed(1)} dB   duty(>6dB over median): ${duty.toFixed(1)}%\n`);

// envelope sparkline over first ~120 ms
const blocksMs = 1; // 1 ms per column
const perBlock = Math.round(decRate * blocksMs / 1000);
const cols = 120;
const glyph = ' .:-=+*#%@';
let line = '';
const dbMin = 10 * Math.log10(med + 1e-12) - 2;
const dbMax = 10 * Math.log10(max + 1e-12);
for (let c = 0; c < cols; c++) {
  let s = 0;
  for (let k = 0; k < perBlock; k++) { const idx = c * perBlock + k; if (idx < M) s += pw[idx]; }
  s /= perBlock;
  const db = 10 * Math.log10(s + 1e-12);
  const t = Math.max(0, Math.min(1, (db - dbMin) / (dbMax - dbMin + 1e-9)));
  line += glyph[Math.round(t * (glyph.length - 1))];
}
console.log('power vs time (1 ms/col, first 120 ms):');
console.log(line);
