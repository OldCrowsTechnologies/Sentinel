/**
 * rf_spectrum.mjs -- average power spectrum of two .iq8 captures, coarse-binned,
 * to reveal a band-limited signal (its offset + bandwidth) vs flat noise.
 *   node --experimental-strip-types tools/rf_spectrum.mjs <signal.iq8> <noise.iq8>
 */
import fs from 'node:fs';

const Fs = 1_024_000;
const L = 8192;
const COARSE = 64;

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
function psd({ I, Q }, maxWin = 400) {
  const re = new Float64Array(L), im = new Float64Array(L);
  const acc = new Float64Array(L);
  let wins = 0;
  for (let p = 0; p + L <= I.length && wins < maxWin; p += L, wins++) {
    for (let k = 0; k < L; k++) { re[k] = I[p + k]; im[k] = Q[p + k]; }
    fft(re, im);
    for (let m = 0; m < L; m++) acc[m] += re[m] * re[m] + im[m] * im[m];
  }
  // fftshift + coarse-bin to dB
  const shifted = new Float64Array(L);
  for (let m = 0; m < L; m++) shifted[m] = acc[(m + L / 2) % L] / wins;
  const per = L / COARSE;
  const out = [];
  for (let c = 0; c < COARSE; c++) {
    let s = 0;
    for (let k = 0; k < per; k++) s += shifted[c * per + k];
    out.push(10 * Math.log10(s / per + 1e-12));
  }
  return out;
}

const [sigPath, noisePath] = process.argv.slice(2);
const S = psd(loadIQ(sigPath));
const N = psd(loadIQ(noisePath));
console.log('offset(kHz)   signal   noise   delta(dB)');
let maxDelta = -1e9, maxAt = 0;
for (let c = 0; c < COARSE; c++) {
  const offKHz = ((c + 0.5) / COARSE - 0.5) * (Fs / 1e3);
  const delta = S[c] - N[c];
  if (delta > maxDelta) { maxDelta = delta; maxAt = offKHz; }
  const bar = '#'.repeat(Math.max(0, Math.round(delta)));
  console.log(`${offKHz.toFixed(0).padStart(6)}    ${S[c].toFixed(1).padStart(6)}  ${N[c].toFixed(1).padStart(6)}   ${delta.toFixed(1).padStart(5)} ${bar}`);
}
console.log(`\npeak excess ${maxDelta.toFixed(1)} dB at ${maxAt.toFixed(0)} kHz offset from tuned center`);
