#!/usr/bin/env node
/**
 * node.mjs -- Corvus Sentinel gunshot sensor node (Raspberry Pi).
 *
 * Air -> mic -> ALSA -> ring buffer -> detectShots() -> C2 alert. That's it.
 *
 * WHY NODE ON A PI: this imports ../lib/shotDetect.ts UNCHANGED -- the exact
 * detector validated at 97.8% recall against 8,015 real gunshots (C3GD, see
 * tools/shot_eval.mjs). No port, no re-validation, no second implementation to
 * keep in parity. An ESP32 rewrite is the production cost-down once the
 * algorithm is proven in the field; it is the wrong place to start.
 *
 * NO AUDIO IS EVER WRITTEN TO DISK. Samples live in a RAM ring buffer and are
 * overwritten continuously. A detection transmits a few numbers -- never audio.
 * This is a hard design constraint, not a setting: a device that continuously
 * records audio in a school is a wiretapping/consent problem regardless of what
 * it is for, and it is the fight ShotSpotter keeps having. Keep it that way.
 * (--save-clips exists for BENCH use only and refuses to run without --unsafe.)
 *
 * Capture uses `arecord` over a pipe rather than a native addon: no node-gyp, no
 * ABI breakage on Pi OS upgrades, and any ALSA-visible device works (I2S HAT,
 * USB interface, ReSpeaker) by changing one config string.
 *
 * Usage:
 *   node --experimental-strip-types sensor-node/node.mjs --config node.json
 *   node --experimental-strip-types sensor-node/node.mjs --wav some.wav   # bench
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectShots } from '../lib/shotDetect.ts';
import { enroll, pushDetection, loadSession } from './c2.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---- config -----------------------------------------------------------------
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i];
}
const CFG_PATH = args.config || path.join(HERE, 'node.json');
const cfg = {
  // ALSA capture device. `arecord -l` lists them. I2S HATs are usually hw:1,0.
  device: 'hw:1,0',
  sampleRate: 48000,
  channels: 1,
  // Analysis window + hop. Hop < window so a shot near a boundary is never split;
  // the absolute-time dedup below drops the resulting double-sighting.
  //
  // 0.5 s (not 1 s): detectShots' noise floor is the MEDIAN of ~500 frames here,
  // which is ample, and the hop bounds detection latency -- 0.25 s worst case
  // versus 0.5 s. On a product whose pitch is "faster than 911", latency is the
  // feature. A 1 s window also silently never filled from C3GD's 0.919 s clips,
  // so bench mode analysed nothing at all.
  windowSec: 0.5,
  hopSec: 0.25,
  // Node identity + siting. lat/lon are SURVEYED at install -- a fixed node knows
  // where it is, which is the whole reason fixed beats a phone (it is NOT that
  // phones can't hear shots; measured, they hear them just fine).
  nodeId: 'node-unset',
  lat: null,
  lon: null,
  callSign: null,
  seatCode: null,
  supabaseUrl: null,
  supabaseAnonKey: null,
  detect: {}, // ShotOptions overrides; defaults are corpus-tuned, don't touch casually
  ...(fs.existsSync(CFG_PATH) ? JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) : {}),
};

const log = (...m) => console.log(new Date().toISOString(), ...m);

// ---- ring buffer ------------------------------------------------------------
// TRUE circular buffer: O(1) per sample, one O(window) copy per hop. The naive
// "shift everything down by one" version is O(n) PER SAMPLE -- ~2.3 billion
// element moves per second of audio at 48 kHz -- which cannot run in real time
// on a Pi and hung outright on a 1 s bench file. Do not "simplify" this back.
const windowSamples = Math.round(cfg.windowSec * cfg.sampleRate);
const hopSamples = Math.round(cfg.hopSec * cfg.sampleRate);
const ring = new Float64Array(windowSamples);
const scratch = new Float64Array(windowSamples); // window materialised in time order
let writeIdx = 0;
let filled = 0;
let sinceHop = 0;
let totalSamples = 0; // absolute sample clock since start -- the timeline for dedup

// EVENT-level alerting, not impulse-level.
//
// One trigger pull produces several impulses at this node: the direct blast,
// then echoes (C3GD's oh_farm event is literally annotated "One-Sided Echo"),
// and the shot also lands in ~2 overlapping windows. Alerting per impulse sent
// 3 banners for ONE round in bench. A dispatcher reading "SHOTS FIRED" three
// times cannot tell an echo from three shooters, and that is worse than useless
// under stress.
//
// So: the FIRST impulse alerts immediately -- latency is the product ("faster
// than 911"), so we never wait to count before speaking -- and everything for
// the next 1.5 s folds into that same event. Rapid fire is ONE alert carrying a
// round count, which is what command actually needs. shot_count comes from
// detectShots' own per-window count.
const EVENT_REFRACTORY_SEC = 1.5;
let lastReportedAt = -Infinity;
let seq = 0;

function onWindow(win) {
  const d = detectShots(win, cfg.sampleRate, cfg.detect);
  if (!d.present) return;

  // Window start in absolute seconds; candidate onsets are relative to it.
  const windowStartSec = (totalSamples - windowSamples) / cfg.sampleRate;
  for (const c of d.candidates) {
    const at = windowStartSec + c.onsetSec;
    if (at - lastReportedAt < EVENT_REFRACTORY_SEC) continue;
    lastReportedAt = at;
    // Fire-and-forget: detection must never block the capture loop. A stalled
    // HTTPS POST cannot be allowed to make us deaf to the next round.
    void report(c, d).catch((e) => log('report error', e.message));
  }
}

async function report(c, d) {
  const report = {
    v: 1,
    nodeId: cfg.nodeId,
    seq: seq++,
    t: Date.now(),
    lat: cfg.lat,
    lon: cfg.lon,
    posAcc: cfg.lat != null ? 1 : null, // surveyed position: accuracy is ~1 m, not GPS noise
    type: 'Unknown firearm', // P1 detects; the classifier (P2) sets weapon class
    conf: Math.min(100, Math.round(c.peakDb * 2)), // provisional until the model lands
    rangeFt: -1, // single sensor cannot range a shot; -1 = unknown, never 0
    rangeSd: null,
    bearing: -1, // omni mic
    unknownBuild: false,
    kind: 'gunshot',
  };
  log(`SHOT peak=${c.peakDb.toFixed(1)}dB attack=${c.attackMs.toFixed(1)}ms decay=${c.decayMs.toFixed(0)}ms crest=${c.crest.toFixed(1)}`);
  try {
    await pushDetection(report, { peakDb: c.peakDb, shotCount: d.shotCount });
    log('  -> C2 ok');
  } catch (e) {
    // Buffering/retry is safe for free: detections is unique(org_id,node_id,seq),
    // so a re-send after an outage dedups server-side rather than double-alerting.
    log('  -> C2 FAILED:', e.message, '(seq', report.seq, 'will retry)');
    pending.push(report);
  }
}

// ---- offline buffer ---------------------------------------------------------
const pending = [];
async function drain() {
  while (pending.length) {
    const r = pending[0];
    try {
      await pushDetection(r, {});
      pending.shift();
      log('resent buffered detection seq', r.seq);
    } catch {
      return; // still down; keep the queue and try again later
    }
  }
}
// .unref() so bench mode can exit -- an un-unref'd interval keeps the event loop
// alive forever and `--wav` would never return.
setInterval(() => void drain().catch(() => {}), 15000).unref();

// ---- sample intake ----------------------------------------------------------
function pushSamples(f64) {
  for (let i = 0; i < f64.length; i++) {
    ring[writeIdx] = f64[i];
    writeIdx = writeIdx + 1 === windowSamples ? 0 : writeIdx + 1;
    if (filled < windowSamples) filled++;
    totalSamples++;
    if (filled >= windowSamples && ++sinceHop >= hopSamples) {
      sinceHop = 0;
      // Unwrap the ring into time order: [writeIdx..end] then [0..writeIdx).
      const tail = windowSamples - writeIdx;
      scratch.set(ring.subarray(writeIdx), 0);
      if (writeIdx > 0) scratch.set(ring.subarray(0, writeIdx), tail);
      onWindow(scratch);
    }
  }
}

/** int16 LE -> mono float, downmixing if the device gives us stereo. */
function decodeS16(buf) {
  const frames = Math.floor(buf.length / 2 / cfg.channels);
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < cfg.channels; c++) acc += buf.readInt16LE((i * cfg.channels + c) * 2) / 32768;
    out[i] = acc / cfg.channels;
  }
  return out;
}

// ---- run --------------------------------------------------------------------
async function main() {
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    log('WARN: no supabaseUrl/anonKey in config -- detections will log locally only.');
  } else {
    const s = loadSession();
    if (s?.orgId) log(`C2: enrolled, org ${s.orgId}`);
    else if (cfg.seatCode) {
      log('C2: enrolling with seat code...');
      const e = await enroll(cfg.supabaseUrl, cfg.supabaseAnonKey, cfg.seatCode, cfg.callSign || cfg.nodeId);
      log(`C2: enrolled, org ${e.orgId}`);
    } else {
      log('WARN: not enrolled and no seatCode configured -- detections will log locally only.');
    }
  }

  if (args.wav) {
    // Bench mode: same code path, file instead of a mic.
    const b = fs.readFileSync(args.wav);
    const dataAt = b.indexOf(Buffer.from('data')) + 8;
    log(`bench: ${args.wav}`);
    pushSamples(decodeS16(b.subarray(dataAt)));
    log('bench done');
    return;
  }

  log(`capture: arecord ${cfg.device} ${cfg.sampleRate}Hz x${cfg.channels}`);
  const rec = spawn('arecord', [
    '-D', cfg.device,
    '-f', 'S16_LE',
    '-r', String(cfg.sampleRate),
    '-c', String(cfg.channels),
    '-t', 'raw',
    '--buffer-size=8192',
  ]);
  let carry = Buffer.alloc(0);
  const frameBytes = 2 * cfg.channels;
  rec.stdout.on('data', (chunk) => {
    const b = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const usable = b.length - (b.length % frameBytes);
    carry = usable < b.length ? b.subarray(usable) : Buffer.alloc(0);
    if (usable > 0) pushSamples(decodeS16(b.subarray(0, usable)));
  });
  rec.stderr.on('data', (d) => {
    const s = String(d).trim();
    if (s && !/^Recording/.test(s)) log('arecord:', s);
  });
  rec.on('exit', (code) => {
    log('arecord exited', code, '-- restarting in 2s');
    setTimeout(() => void main(), 2000);
  });
}

void main().catch((e) => {
  log('fatal', e);
  process.exit(1);
});
