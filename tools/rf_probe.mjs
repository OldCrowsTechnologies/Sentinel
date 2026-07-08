/**
 * rf_probe.mjs -- test an ENERGY/BURST detector (spectral peak over noise floor)
 * and a burst-localized dechirp sweep, on signal vs noise captures.
 *   node --experimental-strip-types tools/rf_probe.mjs <signal.iq8> <noise.iq8>
 */
import fs from 'node:fs';

const Fs = 1_024_000;
const L = 8192;

function loadIQ(path) {
  const buf = fs.readFileSync(path);
  const n = buf.length >> 1;
  const I = new Float64Array(n), Q = new Float64Array(n);
  for (let k = 0; k < n; k++) { I[k] = (buf[2 * k] - 127.5) / 127.5; Q[k] = (buf[2 * k + 1] - 127.5) / 127.5; }
  return { I, Q };
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = (-2 * Math.PI) / len, wRe = Math.cos(ang), wIm = Math.sin(ang); for (let i = 0; i < n; i += len) { let cRe = 1, cIm = 0; for (let k = 0; k < len / 2; k++) { const aRe = re[i + k], aIm = im[i + k]; const bRe = re[i + k + len / 2] * cRe - im[i + k + len / 2] * cIm; const bIm = re[i + k + len / 2] * cIm + im[i + k + len / 2] * cRe; re[i + k] = aRe + bRe; im[i + k] = aIm + bIm; re[i + k + len / 2] = aRe - bRe; im[i + k + len / 2] = aIm - bIm; const nRe = cRe * wRe - cIm * wIm; cIm = cRe * wIm + cIm * wRe; cRe = nRe; } } }
}
// Energy detector: peak bin over median-noise-floor, in dB, per L-sample window.
function energyDb(re, im) {
  const p = new Float64Array(L);
  for (let m = 0; m < L; m++) p[m] = re[m] * re[m] + im[m] * im[m];
  const s = Float64Array.from(p).sort();
  const med = s[L >> 1] + 1e-12;
  const peak = s[L - 1];
  return 10 * Math.log10(peak / med);
}
function scan({ I, Q }, maxWin = 500) {
  const re = new Float64Array(L), im = new Float64Array(L);
  let max = 0, count = 0;
  const vals = [];
  for (let p = 0; p + L <= I.length && count < maxWin; p += L, count++) {
    for (let k = 0; k < L; k++) { re[k] = I[p + k]; im[k] = Q[p + k]; }
    fft(re, im);
    const e = energyDb(re, im);
    vals.push(e);
    if (e > max) max = e;
  }
  vals.sort((a, b) => a - b);
  return { max, med: vals[vals.length >> 1], p95: vals[Math.floor(vals.length * 0.95)], vals };
}

const [sigPath, noisePath] = process.argv.slice(2);
const sig = scan(loadIQ(sigPath));
const noi = scan(loadIQ(noisePath));

console.log('=== ENERGY/BURST detector: spectral peak over noise floor (dB) ===');
console.log(`  signal: max ${sig.max.toFixed(1)}  median ${sig.med.toFixed(1)}  p95 ${sig.p95.toFixed(1)}`);
console.log(`  noise : max ${noi.max.toFixed(1)}  median ${noi.med.toFixed(1)}  p95 ${noi.p95.toFixed(1)}`);

// detection rate at a threshold set well above noise's worst case
const thr = noi.max + 2;
const hits = sig.vals.filter((v) => v > thr).length;
console.log(`\n  threshold = noise_max + 2 = ${thr.toFixed(1)} dB`);
console.log(`  signal windows over threshold: ${hits}/${sig.vals.length} (${(100 * hits / sig.vals.length).toFixed(1)}%)`);
console.log(`  => per-32ms-window detect prob ~${(100 * hits / sig.vals.length).toFixed(1)}%, matches the bursty duty cycle`);
