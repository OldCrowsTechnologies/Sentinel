/**
 * fp_replay.mjs -- slide the REAL Corvus classifier across a long recording and
 * report every callout with a timestamp. For an all-negative recording (no drone
 * airborne) every detection is a FALSE POSITIVE, so this enumerates them by time
 * and dumps the confidence distribution (to expose softmax over-confidence).
 *
 * Uses the same window (model.dsp.clipSec @ sampleRate) and the same
 * classifySamples() path as the app -- no forked detection code (via the stress
 * ts-resolver + --experimental-strip-types).
 *
 * Usage:
 *   node --experimental-strip-types tools/fp_replay.mjs <file.wav> \
 *        [--hop <sec>] [--model <path>] [--json <out.json>]
 *
 *   --hop    window step in seconds (default 1.0 -> 50% overlap on a 2s window)
 *   --model  model JSON (default assets/models/corvus-model.json)
 *   --json   also write per-window records here for calibration reuse
 */
import { register } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import * as synth from '../stress/lib/synth.mjs';

register('../stress/lib/ts-resolver.mjs', import.meta.url);

const argv = process.argv.slice(2);
const pos = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  else pos.push(argv[i]);
}
const wavPath = pos[0];
if (!wavPath) { console.error('usage: fp_replay.mjs <file.wav> [--hop sec] [--model path] [--json out]'); process.exit(2); }
const modelPath = flags.model || 'assets/models/corvus-model.json';
const hopSec = Number(flags.hop ?? 1.0);

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const model = JSON.parse(readFileSync(modelPath, 'utf8'));
const sr = model.dsp.sampleRate;
const n = Math.round(sr * model.dsp.clipSec);
const hop = Math.max(1, Math.round(hopSec * sr));

const { default: DroneClassifier } = await import(pathToFileURL(join(process.cwd(), 'lib/mlClassifier.ts')).href);
const clf = new DroneClassifier(model);

const { samples, sampleRate } = synth.decodeWav(readFileSync(wavPath));
if (sampleRate !== sr) { console.error(`sample-rate mismatch: wav ${sampleRate} != model ${sr}`); process.exit(1); }

const detections = [];
const records = [];
const confHist = new Array(11).fill(0); // 0-9,10..19,...,100 -> 11 buckets by 10s (100 in last)
const labelCounts = {};
let windows = 0;

for (let start = 0; start + n <= samples.length; start += hop) {
  const win = samples.subarray(start, start + n);
  const r = clf.classifySamples(win);
  windows++;
  const tSec = start / sr;
  const rawConf = r.probs[r.classIdx] * 100; // raw softmax peak (pre VAD-penalty)
  const bucket = Math.min(10, Math.floor(rawConf / 10));
  if (r.droneDetected) {
    confHist[bucket]++;
    detections.push({ tSec, label: r.label, conf: r.confidence, rawConf });
    labelCounts[r.label] = (labelCounts[r.label] || 0) + 1;
  }
  // Capture probs + classIdx per window: this is the calibration set for fitting
  // temperature scaling (log(probs) == logits up to a constant softmax ignores).
  records.push({ tSec: +tSec.toFixed(2), det: r.droneDetected, label: r.label, conf: +r.confidence.toFixed(1), rawConf: +rawConf.toFixed(1), classIdx: r.classIdx, probs: r.probs.map((p) => +p.toFixed(5)) });
}

// ---- report --------------------------------------------------------------
const fpRate = windows ? detections.length / windows : 0;
console.log(`\n=== fp_replay: ${wavPath} ===`);
console.log(`window ${model.dsp.clipSec}s @ ${sr}Hz · hop ${hopSec}s · ${windows} windows · ${(samples.length / sr / 60).toFixed(1)} min`);
console.log(`FALSE POSITIVES: ${detections.length}/${windows} windows  (${(fpRate * 100).toFixed(1)}%)\n`);

if (detections.length) {
  console.log('by call-out label:');
  for (const [k, v] of Object.entries(labelCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log('\nconfidence of false alarms (bucket -> count):');
  for (let b = 5; b <= 10; b++) {
    const lo = b * 10, label = b === 10 ? '100' : `${lo}-${lo + 9}`;
    if (confHist[b]) console.log(`  ${label.padStart(6)}% ${'#'.repeat(Math.min(60, confHist[b]))} ${confHist[b]}`);
  }
  const conf90 = detections.filter((d) => d.conf >= 90).length;
  const conf99 = detections.filter((d) => d.conf >= 99).length;
  console.log(`\n  >=90%: ${conf90}/${detections.length} (${(conf90 / detections.length * 100).toFixed(0)}%)   >=99%: ${conf99}/${detections.length} (${(conf99 / detections.length * 100).toFixed(0)}%)`);

  console.log('\ntimestamped false alarms:');
  for (const d of detections) console.log(`  ${mmss(d.tSec)}  ${d.conf.toFixed(0).padStart(3)}%  ${d.label}`);
}

if (flags.json) {
  writeFileSync(flags.json, JSON.stringify({ wav: wavPath, model: modelPath, sr, clipSec: model.dsp.clipSec, hopSec, windows, detections, records }, null, 2));
  console.log(`\nwrote per-window records -> ${flags.json}`);
}
