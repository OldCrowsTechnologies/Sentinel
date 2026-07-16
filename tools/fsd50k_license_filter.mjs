#!/usr/bin/env node
/**
 * fsd50k_license_filter.mjs -- make FSD50K safe to train on for a COMMERCIAL
 * product, and prove it.
 *
 * FSD50K's clips are individually licensed by their original Freesound
 * uploaders: CC0 (38.8%), CC-BY (45.9%), CC-BY-NC (11.8%), CC Sampling+ (3.5%).
 * The NC clips cannot be used in a product we sell, and Sampling+ is unsettled
 * for ML training. Filtering by hand is not auditable, so this does it
 * mechanically:
 *
 *   1. reads the upstream per-clip license maps that ship with FSD50K
 *   2. emits a training whitelist containing ONLY CC0 + CC-BY clips
 *   3. emits the per-clip attribution list CC-BY obliges us to carry
 *
 * Run this BEFORE training; commit both outputs. See NOTICE for the policy this
 * enforces and docs/SENTINEL-SHOTS-FIRED.md for why confounders matter at all
 * (they are the false-positive fight -- the actual hard part of P1).
 *
 * Usage:
 *   node tools/fsd50k_license_filter.mjs --root /path/to/FSD50K
 *   node tools/fsd50k_license_filter.mjs --root /path/to/FSD50K \
 *        --classes "Fireworks,Slam,Hammer,Thunder" --out data/fsd50k
 *
 * Expects the standard FSD50K layout under --root:
 *   FSD50K.metadata/dev_clips_info_FSD50K.json
 *   FSD50K.metadata/eval_clips_info_FSD50K.json
 *   FSD50K.ground_truth/dev.csv
 *   FSD50K.ground_truth/eval.csv
 * (paths are searched a couple of levels deep, so an unzipped-anywhere tree
 * still works).
 */

import fs from 'node:fs';
import path from 'node:path';

// ---- license classification -------------------------------------------------
// Order matters: "by-nc" CONTAINS "by", so NC must be tested first or every
// non-commercial clip silently classifies as CC-BY and poisons the corpus.
// This is the one bug in this file that would be invisible until a lawyer found it.
const ALLOWED = new Set(['CC0', 'CC-BY']);

function classifyLicense(url) {
  const u = String(url || '').toLowerCase();
  if (!u) return 'UNKNOWN';
  if (u.includes('publicdomain/zero') || u.includes('/cc0')) return 'CC0';
  if (u.includes('sampling+') || u.includes('sampling%2b')) return 'CC-SAMPLING+';
  if (u.includes('/by-nc')) return 'CC-BY-NC'; // MUST precede the /by test
  if (u.includes('/by/')) return 'CC-BY';
  return 'UNKNOWN';
}

// ---- tiny arg parser --------------------------------------------------------
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i];
}
if (!args.root) {
  console.error('usage: node tools/fsd50k_license_filter.mjs --root /path/to/FSD50K [--classes "A,B"] [--out data/fsd50k]');
  process.exit(2);
}
const OUT = args.out || 'data/fsd50k';
const CLASSES = args.classes ? String(args.classes).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null;

// ---- locate the upstream files (tolerate an extra nesting level) ------------
function find(name) {
  const stack = [args.root];
  for (let depth = 0; depth < 4 && stack.length; depth++) {
    const next = [];
    for (const dir of stack) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isFile() && e.name === name) return p;
        if (e.isDirectory()) next.push(p);
      }
    }
    stack.length = 0; stack.push(...next);
  }
  return null;
}

function readJson(name) {
  const p = find(name);
  if (!p) { console.error(`ERROR: could not find ${name} under ${args.root}`); process.exit(1); }
  return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) };
}

/** Minimal CSV reader: FSD50K ground truth quotes label fields containing commas. */
function readCsv(name) {
  const p = find(name);
  if (!p) { console.error(`ERROR: could not find ${name} under ${args.root}`); process.exit(1); }
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
  const head = splitCsvLine(lines[0]);
  return lines.slice(1).map(l => {
    const cells = splitCsvLine(l);
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}
function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// ---- run --------------------------------------------------------------------
const devInfo = readJson('dev_clips_info_FSD50K.json');
const evalInfo = readJson('eval_clips_info_FSD50K.json');
console.log(`license maps:\n  ${devInfo.path}\n  ${evalInfo.path}`);

const devGt = readCsv('dev.csv');
const evalGt = readCsv('eval.csv');
console.log(`ground truth: ${devGt.length} dev + ${evalGt.length} eval clips`);

const tally = {};
const kept = [];
const attributions = new Map(); // uploader -> Set of clip ids (CC-BY only)
let classFiltered = 0;

function process(rows, info, split) {
  for (const row of rows) {
    const id = row.fname;
    const meta = info[id];
    if (!meta) { tally.NO_METADATA = (tally.NO_METADATA || 0) + 1; continue; }

    const lic = classifyLicense(meta.license);
    tally[lic] = (tally[lic] || 0) + 1;
    if (!ALLOWED.has(lic)) continue;

    // optional class filter (FSD50K labels are comma-separated, e.g. "Fireworks,Explosion")
    const labels = String(row.labels || '').split(',').map(s => s.trim());
    if (CLASSES) {
      const hit = labels.some(l => CLASSES.includes(l.toLowerCase()));
      if (!hit) { classFiltered++; continue; }
    }

    const uploader = meta.uploader || 'unknown';
    kept.push({ fname: id, split: row.split || split, license: lic, uploader, labels: labels.join('|') });
    if (lic === 'CC-BY') {
      if (!attributions.has(uploader)) attributions.set(uploader, new Set());
      attributions.get(uploader).add(id);
    }
  }
}
process(devGt, devInfo.data, 'dev');
process(evalGt, evalInfo.data, 'eval');

// ---- report -----------------------------------------------------------------
console.log('\nlicense breakdown (all clips seen):');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  const mark = ALLOWED.has(k) ? 'USE   ' : 'EXCLUDE';
  console.log(`  ${mark} ${k.padEnd(14)} ${String(v).padStart(6)}`);
}
if (CLASSES) console.log(`\nclass filter [${CLASSES.join(', ')}]: dropped ${classFiltered} license-clean clips that didn't match`);
console.log(`\nWHITELIST: ${kept.length} clips cleared for commercial training`);

if (kept.length === 0) {
  console.error('\nERROR: whitelist is empty -- check --classes spelling against FSD50K label names.');
  process.exit(1);
}

// ---- write ------------------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
const wl = path.join(OUT, 'whitelist.csv');
fs.writeFileSync(wl, 'fname,split,license,uploader,labels\n' +
  kept.map(k => `${k.fname},${k.split},${k.license},"${k.uploader}","${k.labels}"`).join('\n') + '\n');

const ccByCount = kept.filter(k => k.license === 'CC-BY').length;
const lines = [
  'NOTICE — FSD50K per-clip attribution',
  '=====================================',
  '',
  'GENERATED FILE — do not edit by hand.',
  'Regenerate: node tools/fsd50k_license_filter.mjs --root /path/to/FSD50K' +
    (CLASSES ? ` --classes "${CLASSES.join(',')}"` : ''),
  '',
  'These Freesound clips are licensed CC-BY and are used in Corvus Sentinel',
  'training data. Each requires attribution to its original uploader.',
  'CC0 clips in the corpus require no attribution and are not listed here.',
  '',
  `CC-BY clips used: ${ccByCount}   (from ${attributions.size} uploaders)`,
  `CC0 clips used:   ${kept.length - ccByCount}`,
  '',
  'Source: FSD50K — https://zenodo.org/records/4060432',
  'Clips originate from Freesound — https://freesound.org/',
  '',
  '-----------------------------------------------------------------------------',
  '',
];
for (const uploader of [...attributions.keys()].sort()) {
  const ids = [...attributions.get(uploader)].sort();
  lines.push(`${uploader} — freesound.org/people/${uploader}/`);
  lines.push(`    clips: ${ids.join(', ')}`);
  lines.push('');
}
fs.writeFileSync('NOTICE-fsd50k-clips.txt', lines.join('\n'));

console.log(`\nwrote ${wl}`);
console.log(`wrote NOTICE-fsd50k-clips.txt  (${ccByCount} CC-BY clips, ${attributions.size} uploaders to credit)`);
console.log('\nCommit both. Train only on whitelist.csv.');
