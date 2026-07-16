#!/usr/bin/env node
/**
 * shot_eval.mjs -- run lib/shotDetect against a labelled gunshot corpus and
 * report RECALL, sliced by the things that actually decide the product:
 * microphone class, distance, and caliber.
 *
 * Stage 1's only job is to never miss a real shot (docs/SENTINEL-SHOTS-FIRED.md
 * §10). Synthetic fixtures can't prove that -- real muzzle blasts recorded on
 * real mics at real distances can. Every clip here IS a gunshot, so any miss is
 * a false negative and directly bounds the best recall the product can ever have.
 *
 * Corpus: C3GD (CC BY 4.0) -- see NOTICE. Every clip is a live outdoor gunshot,
 * resampled to 48 kHz, with per-file caliber/platform/mic metadata and per-mic
 * distance + azimuth ground truth.
 *
 * Usage:
 *   node --experimental-strip-types tools/shot_eval.mjs
 *   node --experimental-strip-types tools/shot_eval.mjs --root <dir> --limit 500
 */

import fs from 'node:fs';
import path from 'node:path';
import { detectShots } from '../lib/shotDetect.ts';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i];
}
const ROOT = args.root || 'data/external/C3GD-Dataset';
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;

// ---- minimal WAV reader (16/24/32-bit int + 32-bit float, any channels) -----
function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null;
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        format: b.readUInt16LE(body),
        channels: b.readUInt16LE(body + 2),
        sampleRate: b.readUInt32LE(body + 4),
        bits: b.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = b.subarray(body, Math.min(body + size, b.length));
    }
    pos = body + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || !data) return null;

  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / bytes / fmt.channels);
  const out = new Float64Array(frames);
  const isFloat = fmt.format === 3;
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const o = (i * fmt.channels + c) * bytes;
      let v;
      if (isFloat) v = bytes === 4 ? data.readFloatLE(o) : data.readDoubleLE(o);
      else if (bytes === 2) v = data.readInt16LE(o) / 32768;
      else if (bytes === 3) v = ((data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) << 8 >> 8)) / 8388608;
      else if (bytes === 4) v = data.readInt32LE(o) / 2147483648;
      else v = 0;
      acc += v;
    }
    out[i] = acc / fmt.channels; // downmix
  }
  return { samples: out, sampleRate: fmt.sampleRate, channels: fmt.channels, bits: fmt.bits };
}

// ---- csv ---------------------------------------------------------------------
function readCsv(p) {
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const c = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h, c[i] ?? '']));
  });
}

// ---- load --------------------------------------------------------------------
const meta = readCsv(path.join(ROOT, 'metadata.csv'));
const mics = Object.fromEntries(readCsv(path.join(ROOT, 'metadata/microphones.csv')).map((m) => [m.name, m]));
const locs = readCsv(path.join(ROOT, 'metadata/microphone_locations.csv'));
const distOf = new Map(locs.map((l) => [l.mic_loc_id, Number(l.distance_m)]));

console.log(`corpus: ${meta.length} clips  (evaluating ${Math.min(LIMIT, meta.length)})\n`);

// ---- run ---------------------------------------------------------------------
const rows = [];
let n = 0, bad = 0, clipped = 0;
for (const m of meta) {
  if (n >= LIMIT) break;
  const f = path.join(ROOT, 'data', m.filename);
  let w;
  try { w = readWav(f); } catch { w = null; }
  if (!w) { bad++; continue; }
  n++;

  const d = detectShots(w.samples, w.sampleRate);
  // Digital clipping check: how much of the clip sits at full scale?
  let atFs = 0;
  for (let i = 0; i < w.samples.length; i++) if (Math.abs(w.samples[i]) > 0.999) atFs++;
  if (atFs > 0) clipped++;

  rows.push({
    hit: d.present,
    peakDb: d.present ? d.candidates[0].peakDb : 0,
    attackMs: d.present ? d.candidates[0].attackMs : 0,
    shots: d.shotCount,
    mic: m.mic,
    isPhone: mics[m.mic]?.is_phone === '1',
    caliber: m.class_name,
    dist: distOf.get(m.mic_location) ?? null,
    clippedPct: (100 * atFs) / w.samples.length,
  });
}

// ---- report ------------------------------------------------------------------
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '—');
const recall = (rs) => pct(rs.filter((r) => r.hit).length, rs.length);
const meanPk = (rs) => { const h = rs.filter((r) => r.hit); return h.length ? (h.reduce((s, r) => s + r.peakDb, 0) / h.length).toFixed(1) : '—'; };

console.log(`OVERALL RECALL: ${recall(rows)}   (${rows.filter((r) => r.hit).length}/${rows.length})`);
if (bad) console.log(`unreadable files: ${bad}`);
console.log(`clips containing digital full-scale samples: ${clipped}/${n} (${pct(clipped, n)})\n`);

const group = (key, label) => {
  const g = new Map();
  for (const r of rows) {
    const k = typeof key === 'function' ? key(r) : r[key];
    if (k === null || k === undefined || k === '') continue;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(r);
  }
  console.log(`${label}`);
  console.log('  ' + 'group'.padEnd(18) + 'n'.padStart(6) + 'recall'.padStart(9) + 'meanPeakDb'.padStart(12) + '  clipped');
  const keys = [...g.keys()].sort((a, b) => (typeof a === 'number' ? a - b : String(a).localeCompare(String(b))));
  for (const k of keys) {
    const rs = g.get(k);
    const cl = pct(rs.filter((r) => r.clippedPct > 0).length, rs.length);
    console.log('  ' + String(k).padEnd(18) + String(rs.length).padStart(6) + recall(rs).padStart(9) + meanPk(rs).padStart(12) + '  ' + cl.padStart(7));
  }
  console.log();
};

group((r) => (r.isPhone ? 'phone' : 'dedicated mic'), 'BY MIC CLASS  (does the doc\'s "phones are inadequate" claim hold?)');
group('mic', 'BY MICROPHONE');
group('dist', 'BY DISTANCE (m)');
group('caliber', 'BY CALIBER');

const misses = rows.filter((r) => !r.hit);
if (misses.length) {
  console.log(`MISSES (${misses.length}) -- every one of these is a real gunshot the trigger did not fire on:`);
  const byMic = new Map();
  for (const m of misses) byMic.set(m.mic, (byMic.get(m.mic) || 0) + 1);
  for (const [mic, c] of [...byMic].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${mic.padEnd(8)} ${String(c).padStart(4)}  (${pct(c, rows.filter((r) => r.mic === mic).length)} of that mic's clips)`);
  }
}
