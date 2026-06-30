/**
 * detect.mjs -- detection-robustness stress test.
 *
 * Drives the REAL Corvus classifier (lib/mlClassifier.ts) with a battery of
 * synthetic + adversarial audio windows and measures what actually matters in
 * the field:
 *   - false-positive rate on non-drone audio (silence, noise, voice, crowd) --
 *     this is the metric the voice/crowd-rejection work is judged on;
 *   - inference latency distribution (the on-device per-window budget);
 *   - robustness to pathological input (empty/short/NaN/Inf/clipping) -- must
 *     never throw or emit a non-finite confidence;
 *   - determinism (same window in -> identical verdict out).
 *
 * Optionally ingests real recordings via --wav-dir <dir>, where each immediate
 * subfolder is a class label (a folder named none/silence/noise/voice/crowd is
 * treated as "should NOT detect"; anything else as "should detect").
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { summarize, fmtMs, fmtPct, num } from '../lib/util.mjs';
import * as synth from '../lib/synth.mjs';

const NEG_HINTS = ['none', 'silence', 'noise', 'voice', 'crowd', 'ambient', 'speech', 'bar'];

function loadModel(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function buildScenarios(sr, n) {
  return [
    // ---- non-drone: any detection here is a FALSE POSITIVE ----
    { id: 'silence', group: 'neg', expect: false, gen: () => synth.silence(n) },
    { id: 'white-noise-low', group: 'neg', expect: false, gen: () => synth.whiteNoise(n, 0.08, 11) },
    { id: 'white-noise-high', group: 'neg', expect: false, gen: () => synth.whiteNoise(n, 0.45, 12) },
    { id: 'pink-noise', group: 'neg', expect: false, gen: () => synth.pinkNoise(n, 0.3, 13) },
    { id: 'voice-male', group: 'neg', expect: false, gen: () => synth.voiceLike(n, sr, { f0: 110, amp: 0.55 }) },
    { id: 'voice-female', group: 'neg', expect: false, gen: () => synth.voiceLike(n, sr, { f0: 210, amp: 0.5, seed: 7 }) },
    { id: 'crowded-bar', group: 'neg', expect: false, gen: () => synth.crowdBabble(n, sr, { voices: 6, amp: 0.6 }) },
    { id: 'chirp-sweep', group: 'neg', expect: false, gen: () => synth.chirp(n, 200, 4000, sr, 0.4) },
    // ---- drone-like: informational (synthetic, not a trained signature) ----
    { id: 'rotor-180hz', group: 'pos', expect: null, gen: () => synth.harmonicStack(n, 180, sr, { harmonics: 7, amp: 0.4 }) },
    { id: 'rotor-260hz', group: 'pos', expect: null, gen: () => synth.harmonicStack(n, 260, sr, { harmonics: 6, amp: 0.4, seed: 8 }) },
    { id: 'pure-tone-440', group: 'pos', expect: null, gen: () => synth.tone(n, 440, sr, 0.5) },
  ];
}

function pathological(n) {
  return [
    { id: 'empty-buffer', gen: () => new Float32Array(0) },
    { id: 'sub-window (16)', gen: () => synth.whiteNoise(16, 0.2) },
    { id: 'all-NaN', gen: () => new Float32Array(n).fill(NaN) },
    { id: 'all-+Inf', gen: () => new Float32Array(n).fill(Infinity) },
    { id: 'clipping-overload', gen: () => synth.clipping(n, 16000, 6) },
    { id: 'dc-offset', gen: () => synth.dcOffset(n, 0.9) },
    { id: 'huge-amplitude', gen: () => synth.whiteNoise(n, 50, 21) },
  ];
}

function listWavDir(dir) {
  const out = [];
  for (const label of readdirSync(dir)) {
    const sub = join(dir, label);
    if (!statSync(sub).isDirectory()) continue;
    const expectDrone = !NEG_HINTS.includes(label.toLowerCase());
    for (const f of readdirSync(sub)) {
      if (f.toLowerCase().endsWith('.wav')) out.push({ label, expectDrone, file: join(sub, f) });
    }
  }
  return out;
}

export async function run(flags) {
  const modelPath = flags.model || 'assets/models/corvus-model.json';
  const iterations = Math.max(1, num(flags.iterations, 100));
  const model = loadModel(modelPath);
  const sr = model.dsp.sampleRate;
  const n = Math.round(sr * model.dsp.clipSec);

  const { default: DroneClassifier } = await import(pathToFileURL(join(process.cwd(), 'lib/mlClassifier.ts')).href);
  const clf = new DroneClassifier(model);

  const rows = [];
  const rowStatus = [];
  const latAll = [];
  let falsePositives = 0;
  let negCount = 0;

  for (const sc of buildScenarios(sr, n)) {
    const buf = sc.gen();
    const lat = [];
    let first = null;
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      const r = clf.classifySamples(buf);
      lat.push(performance.now() - t0);
      if (i === 0) first = r;
    }
    // determinism: re-run once, compare
    const again = clf.classifySamples(buf);
    const deterministic = again.label === first.label && Math.abs(again.confidence - first.confidence) < 1e-6;
    const s = summarize(lat);
    const detected = first.droneDetected;
    let status = 'info';
    if (sc.expect === false) {
      negCount++;
      if (detected) { falsePositives++; status = 'bad'; } else status = 'ok';
    } else if (sc.expect === null) {
      status = detected ? 'info' : 'info';
    }
    if (!deterministic) status = 'warn';
    rows.push([
      sc.id,
      sc.expect === false ? 'no-drone' : sc.expect === true ? 'drone' : 'n/a',
      detected ? `${first.label} (${first.confidence.toFixed(0)}%)` : 'None',
      detected ? 'DETECTED' : '—',
      fmtMs(s.p95),
      deterministic ? 'yes' : 'NO',
    ]);
    rowStatus.push(status);
    latAll.push(...lat);
  }

  // optional: real recordings
  let wavRows = [];
  let wavMissed = 0, wavFp = 0, wavPos = 0, wavNeg = 0;
  if (flags['wav-dir']) {
    for (const item of listWavDir(flags['wav-dir'])) {
      let detected, label, conf;
      try {
        const { samples, sampleRate } = synth.decodeWav(readFileSync(item.file));
        if (sampleRate !== sr) {
          wavRows.push([basename(item.file), item.label, `skipped (sr ${sampleRate}≠${sr})`, '', '']);
          continue;
        }
        const r = clf.classifySamples(samples);
        detected = r.droneDetected; label = r.label; conf = r.confidence;
      } catch (e) {
        wavRows.push([basename(item.file), item.label, 'ERROR: ' + e.message, '', '']);
        continue;
      }
      let st = 'ok';
      if (item.expectDrone) { wavPos++; if (!detected) { wavMissed++; st = 'bad'; } }
      else { wavNeg++; if (detected) { wavFp++; st = 'bad'; } }
      wavRows.push([basename(item.file), item.label, detected ? `${label} (${conf.toFixed(0)}%)` : 'None', item.expectDrone ? 'drone' : 'no-drone', st]);
    }
  }

  // pathological robustness
  const robRows = [];
  const robStatus = [];
  let crashes = 0;
  for (const p of pathological(n)) {
    let outcome, status;
    try {
      const r = clf.classifySamples(p.gen());
      const finite = Number.isFinite(r.confidence);
      if (!finite) { outcome = 'non-finite confidence'; status = 'bad'; crashes++; }
      else { outcome = `ok — ${r.label} (${r.confidence.toFixed(0)}%)`; status = 'ok'; }
    } catch (e) {
      outcome = 'THREW: ' + (e.message || e); status = 'bad'; crashes++;
    }
    robRows.push([p.id, outcome]);
    robStatus.push(status);
  }

  const latSummary = summarize(latAll);
  const fpRate = negCount ? falsePositives / negCount : 0;
  const pass = falsePositives === 0 && crashes === 0 && wavFp === 0;

  const cards = [
    { label: 'False positives', value: `${falsePositives}/${negCount}`, status: falsePositives === 0 ? 'ok' : 'bad', sub: 'synthetic non-drone windows' },
    { label: 'p95 latency', value: fmtMs(latSummary.p95), status: latSummary.p95 < 50 ? 'ok' : latSummary.p95 < 150 ? 'warn' : 'bad', sub: `p50 ${fmtMs(latSummary.p50)} · max ${fmtMs(latSummary.max)}` },
    { label: 'Robustness', value: crashes === 0 ? 'clean' : `${crashes} fail`, status: crashes === 0 ? 'ok' : 'bad', sub: `${pathological(n).length} pathological inputs` },
    { label: 'Throughput', value: `${(1000 / latSummary.mean).toFixed(0)}/s`, status: 'info', sub: `${latSummary.count} classifications` },
  ];
  if (flags['wav-dir']) {
    cards.push({ label: 'Recordings', value: `${wavPos - wavMissed}/${wavPos} hit`, status: wavMissed === 0 && wavFp === 0 ? 'ok' : 'warn', sub: `${wavFp} FP on ${wavNeg} neg` });
  }

  const sections = [
    {
      type: 'table', title: 'Synthetic scenarios',
      note: 'Each window classified ' + iterations + '×. "no-drone" rows that DETECT are false positives.',
      headers: ['scenario', 'expect', 'verdict', 'flag', 'p95 lat', 'det.'],
      rows, rowStatus,
    },
    {
      type: 'table', title: 'Adversarial / pathological input',
      note: 'Must never throw or return a non-finite confidence.',
      headers: ['input', 'outcome'], rows: robRows, rowStatus: robStatus,
    },
    {
      type: 'bars', title: 'Latency percentiles', unit: 'ms',
      items: [
        { label: 'p50', value: +latSummary.p50.toFixed(2), status: 'ok', display: fmtMs(latSummary.p50) },
        { label: 'p90', value: +latSummary.p90.toFixed(2), status: 'ok', display: fmtMs(latSummary.p90) },
        { label: 'p95', value: +latSummary.p95.toFixed(2), status: 'info', display: fmtMs(latSummary.p95) },
        { label: 'p99', value: +latSummary.p99.toFixed(2), status: 'warn', display: fmtMs(latSummary.p99) },
        { label: 'max', value: +latSummary.max.toFixed(2), status: 'warn', display: fmtMs(latSummary.max) },
      ],
    },
  ];
  if (wavRows.length) {
    sections.splice(1, 0, {
      type: 'table', title: `Real recordings (${flags['wav-dir']})`,
      headers: ['file', 'folder', 'verdict', 'expect', ''],
      rows: wavRows.map((r) => r.slice(0, 4)),
      rowStatus: wavRows.map((r) => r[4]),
    });
  }

  const notes = [];
  if (falsePositives) notes.push(`${falsePositives} false positive(s) on non-drone audio`);
  if (crashes) notes.push(`${crashes} pathological input(s) failed`);
  if (wavFp) notes.push(`${wavFp} false positive(s) on real recordings`);
  if (pass) notes.push(`0 false positives · ${fmtMs(latSummary.p95)} p95`);

  return {
    command: 'detect',
    title: 'Detection robustness',
    cards,
    sections,
    meta: [
      { k: 'model', v: basename(modelPath) },
      { k: 'labels', v: model.labels.join(', ') },
      { k: 'window', v: `${model.dsp.clipSec}s @ ${sr}Hz` },
      { k: 'iters', v: String(iterations) },
    ],
    verdict: { pass, label: pass ? 'PASS' : 'ATTENTION', notes },
    _terminal: {
      headline: `FP ${falsePositives}/${negCount} · p95 ${fmtMs(latSummary.p95)} · robustness ${crashes === 0 ? 'clean' : crashes + ' fail'} · fpRate ${fmtPct(fpRate)}`,
      rows, headers: ['scenario', 'expect', 'verdict', 'flag', 'p95 lat', 'det.'], rowStatus,
    },
  };
}
