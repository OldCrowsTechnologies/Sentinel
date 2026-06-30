/**
 * soak.mjs -- runtime endurance / leak test.
 *
 * Runs a workload in a tight loop for N minutes, sampling heap + RSS + CPU at a
 * fixed interval, then fits a line to heap-over-time to flag a probable memory
 * leak (sustained positive slope with high correlation). The default workload is
 * the real classifier hot path (DSP → FFT → MLP) on a rotating synthetic window,
 * so it exercises the same per-frame allocations the live app makes thousands of
 * times per minute -- the kind of slow growth unit tests never catch.
 *
 *   npm run stress -- soak --minutes 3 --workload detect
 *   node --expose-gc ... soak ...   # forces GC before each sample for a clean signal
 */
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { linreg, fmtBytes, fmtMs, num } from '../lib/util.mjs';
import * as synth from '../lib/synth.mjs';

async function buildWorkload(flags) {
  const kind = flags.workload || 'detect';
  if (kind === 'noop') {
    let acc = 0;
    return { kind, step: () => { for (let i = 0; i < 1e4; i++) acc += Math.sqrt(i); return acc; } };
  }
  // detect: drive the real classifier on a rotating window
  const modelPath = flags.model || 'assets/models/corvus-model.json';
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  const sr = model.dsp.sampleRate;
  const n = Math.round(sr * model.dsp.clipSec);
  const { default: DroneClassifier } = await import(pathToFileURL(join(process.cwd(), 'lib/mlClassifier.ts')).href);
  const clf = new DroneClassifier(model);
  // a small bank of windows we cycle through so input varies but stays bounded
  const bank = [
    synth.whiteNoise(n, 0.2, 1),
    synth.harmonicStack(n, 190, sr, { amp: 0.4 }),
    synth.voiceLike(n, sr, { f0: 130 }),
    synth.crowdBabble(n, sr, { voices: 4 }),
  ];
  let i = 0;
  return { kind, meta: basename(modelPath), step: () => clf.classifySamples(bank[i++ % bank.length]) };
}

export async function run(flags) {
  const minutes = num(flags.minutes, 2);
  const sampleMs = num(flags['sample-ms'], 1000);
  const wl = await buildWorkload(flags);
  const gc = typeof global.gc === 'function' ? global.gc : null;

  const start = performance.now();
  const deadline = start + minutes * 60_000;
  let nextSample = start;
  let iterations = 0;
  const samples = []; // {t, heap, rss, ext}
  let cpuPrev = process.cpuUsage();
  let cpuPrevT = start;
  const cpuPts = [];

  process.stdout.write(`  soak: workload=${wl.kind}${wl.meta ? ' (' + wl.meta + ')' : ''} for ${minutes}min, sampling every ${sampleMs}ms${gc ? ' [gc]' : ''}\n`);

  while (performance.now() < deadline) {
    wl.step();
    iterations++;
    const now = performance.now();
    if (now >= nextSample) {
      if (gc) gc();
      const mem = process.memoryUsage();
      const t = (now - start) / 1000;
      samples.push({ t, heap: mem.heapUsed, rss: mem.rss, ext: mem.external });
      const cu = process.cpuUsage(cpuPrev);
      const wall = (now - cpuPrevT) * 1000; // µs
      const cpuPct = wall > 0 ? ((cu.user + cu.system) / wall) * 100 : 0;
      cpuPts.push([t, cpuPct]);
      cpuPrev = process.cpuUsage();
      cpuPrevT = now;
      nextSample += sampleMs;
      // yield so timers/GC can run
      await new Promise((r) => setImmediate(r));
    }
  }

  const elapsed = (performance.now() - start) / 1000;
  const ts = samples.map((s) => s.t);
  const heaps = samples.map((s) => s.heap);
  const rsss = samples.map((s) => s.rss);
  const fit = linreg(ts, heaps);
  const slopePerMin = fit.slope * 60; // bytes/min
  const heapStart = heaps[0] ?? 0;
  const heapEnd = heaps[heaps.length - 1] ?? 0;
  const rssPeak = Math.max(...rsss, 0);
  const opsPerSec = iterations / elapsed;

  // leak heuristic: growing >1MB/min AND well-correlated AND net growth meaningful
  const growMBmin = slopePerMin / (1024 * 1024);
  const leakSuspected = growMBmin > 1 && fit.r > 0.85 && heapEnd - heapStart > 8 * 1024 * 1024;
  const pass = !leakSuspected;

  const cards = [
    { label: 'Iterations', value: iterations.toLocaleString('en-US'), status: 'info', sub: `${opsPerSec.toFixed(0)}/s over ${elapsed.toFixed(0)}s` },
    { label: 'Heap growth', value: `${growMBmin >= 0 ? '+' : ''}${growMBmin.toFixed(2)} MB/min`, status: leakSuspected ? 'bad' : Math.abs(growMBmin) < 0.5 ? 'ok' : 'warn', sub: `r=${fit.r.toFixed(2)}` },
    { label: 'Heap Δ', value: `${fmtBytes(heapStart)} → ${fmtBytes(heapEnd)}`, status: 'info', sub: `net ${heapEnd >= heapStart ? '+' : ''}${fmtBytes(heapEnd - heapStart)}` },
    { label: 'RSS peak', value: fmtBytes(rssPeak), status: 'info', sub: gc ? 'gc-forced samples' : 'no --expose-gc' },
  ];

  const sections = [
    {
      type: 'timeseries', title: 'Memory over time', xlabel: 'seconds', yfmt: fmtBytes,
      series: [
        { name: 'heapUsed', color: '#00C2C7', points: samples.map((s) => [s.t, s.heap]) },
        { name: 'rss', color: '#C9A23A', points: samples.map((s) => [s.t, s.rss]) },
      ],
    },
    {
      type: 'timeseries', title: 'CPU utilization', xlabel: 'seconds', yfmt: (v) => v.toFixed(0) + '%',
      series: [{ name: 'cpu %', color: '#2ECC71', points: cpuPts }],
    },
    {
      type: 'table', title: 'Summary',
      headers: ['metric', 'value'],
      rows: [
        ['workload', wl.kind + (wl.meta ? ` (${wl.meta})` : '')],
        ['duration', `${elapsed.toFixed(1)} s`],
        ['iterations', iterations.toLocaleString('en-US')],
        ['throughput', `${opsPerSec.toFixed(1)} /s`],
        ['heap slope', `${growMBmin.toFixed(3)} MB/min (r=${fit.r.toFixed(3)})`],
        ['heap net', `${fmtBytes(heapEnd - heapStart)}`],
        ['rss peak', fmtBytes(rssPeak)],
        ['gc forced', gc ? 'yes' : 'no (run node --expose-gc for a cleaner signal)'],
      ],
    },
  ];

  const notes = [];
  if (leakSuspected) notes.push(`heap grew ${growMBmin.toFixed(1)} MB/min (r=${fit.r.toFixed(2)}) — investigate for a leak`);
  else notes.push(`stable: ${growMBmin >= 0 ? '+' : ''}${growMBmin.toFixed(2)} MB/min over ${elapsed.toFixed(0)}s, ${iterations.toLocaleString('en-US')} iters`);
  if (!gc) notes.push('tip: run with node --expose-gc for a cleaner heap-slope signal');

  return {
    command: 'soak',
    title: 'Runtime endurance / leak test',
    cards,
    sections,
    meta: [
      { k: 'workload', v: wl.kind },
      { k: 'duration', v: `${minutes} min` },
      { k: 'sample', v: `${sampleMs} ms` },
      { k: 'gc', v: gc ? 'forced' : 'off' },
    ],
    verdict: { pass, label: pass ? 'PASS' : 'ATTENTION', notes },
    _terminal: {
      headline: `${iterations.toLocaleString('en-US')} iters · ${opsPerSec.toFixed(0)}/s · heap ${growMBmin >= 0 ? '+' : ''}${growMBmin.toFixed(2)} MB/min (r=${fit.r.toFixed(2)}) · ${leakSuspected ? 'LEAK?' : 'stable'}`,
      headers: ['metric', 'value'],
      rows: [
        ['iterations', iterations.toLocaleString('en-US')],
        ['heap slope', `${growMBmin.toFixed(3)} MB/min`],
        ['heap net', fmtBytes(heapEnd - heapStart)],
        ['rss peak', fmtBytes(rssPeak)],
      ],
      rowStatus: ['info', leakSuspected ? 'bad' : 'ok', 'info', 'info'],
    },
  };
}
