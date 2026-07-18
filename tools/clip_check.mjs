/**
 * clip_check.mjs -- classify each WAV in a dir (optionally filtered by a filename
 * substring) through the REAL classifier and print label / droneDetected / conf.
 * Used to spot-check held-out clips (e.g. a fixed-wing regression guard).
 *   node --experimental-strip-types tools/clip_check.mjs <dir> [nameFilter]
 */
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import * as synth from '../stress/lib/synth.mjs';
register('../stress/lib/ts-resolver.mjs', import.meta.url);

const [dir, filter, modelPath] = process.argv.slice(2);
const model = JSON.parse(readFileSync(modelPath || 'assets/models/corvus-model.json', 'utf8'));
const sr = model.dsp.sampleRate, n = Math.round(sr * model.dsp.clipSec);
const { default: DroneClassifier } = await import(pathToFileURL(join(process.cwd(), 'lib/mlClassifier.ts')).href);
const clf = new DroneClassifier(model);

const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wav') && (!filter || f.includes(filter)));
const hop = Math.round(n / 2);
let det = 0;
for (const f of files) {
  const { samples } = synth.decodeWav(readFileSync(join(dir, f)));
  // Scan ALL windows (as the app monitors continuously): a flyover counts as
  // detected if ANY window fires. Report the best-confidence detected label.
  let best = null, anyDet = false;
  const ends = Math.max(1, samples.length - n + 1);
  for (let s = 0; s < ends; s += hop) {
    const win = samples.length >= n ? samples.subarray(s, s + n) : samples;
    const r = clf.classifySamples(win);
    if (r.droneDetected) { anyDet = true; if (!best || r.confidence > best.confidence) best = r; }
    if (samples.length < n) break;
  }
  if (anyDet) det++;
  console.log(`${anyDet ? 'DET' : '   '}  ${(best ? best.label : '—').padEnd(18)} ${(best ? best.confidence.toFixed(0) : '').padStart(3)}${best ? '%' : ' '}  ${f}`);
}
console.log(`\n${det}/${files.length} clips detected as a UAS (any window)`);
