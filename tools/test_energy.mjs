/**
 * test_energy.mjs -- run detectEnergy over sliding frames of a capture.
 *   node --experimental-strip-types tools/test_energy.mjs <capture.iq8> <Fs> [label]
 */
import fs from 'node:fs';
import { detectEnergy } from '../lib/rfEnergyDetect.ts';

const path = process.argv[2];
const Fs = Math.round(parseFloat(process.argv[3] || '1024000'));
const label = process.argv[4] || path.split(/[\\/]/).pop();

const buf = fs.readFileSync(path);
const n = buf.length >> 1;
const I = new Float64Array(n), Q = new Float64Array(n);
for (let k = 0; k < n; k++) { I[k] = (buf[2 * k] - 127.5) / 127.5; Q[k] = (buf[2 * k + 1] - 127.5) / 127.5; }

const W = 32768;
let frames = 0, present = 0;
const peaks = [];
for (let p = 0; p + W <= n; p += W) {
  const d = detectEnergy(I.subarray(p, p + W), Q.subarray(p, p + W), Fs);
  frames++;
  if (d.present) present++;
  peaks.push(d.peakDb);
}
peaks.sort((a, b) => a - b);
const med = peaks[peaks.length >> 1];
const max = peaks[peaks.length - 1];
const min = peaks[0];
console.log(`${label.padEnd(22)}  frames ${frames}  present ${present} (${(100 * present / frames).toFixed(0)}%)  peakDb min/med/max ${min.toFixed(1)}/${med.toFixed(1)}/${max.toFixed(1)}`);
