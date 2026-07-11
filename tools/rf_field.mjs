/**
 * rf_field.mjs -- LABELED field capture with instant feedback. Grabs raw u8 IQ
 * from rtl_tcp into an organized, self-describing corpus so the day's data is
 * ready to build a detector against, and tells you on the spot whether you
 * actually caught the link (so you can re-shoot before the aircraft lands).
 *
 * Writes two files per band per shot into captures/<subject>/ :
 *   <band>_<label>_<NN>.iq8   raw interleaved u8 IQ (headerless; Fs in sidecar)
 *   <band>_<label>_<NN>.json  metadata: subject, freq, sample rate, gain,
 *                             seconds, samples, timestamp, notes + the live
 *                             detectEnergy/detectLora readout for this capture.
 *
 * The .iq8 format and sample rate match the on-device path (lib/rtlTcp decodeIqU8,
 * rfSensorService SAMPLE_RATE=1.024 Msps), so every capture replays byte-identically
 * through the SAME detectors the product ships (detectEnergy primary, detectLora tag).
 *
 * Usage:
 *   node --experimental-strip-types tools/rf_field.mjs <subject> <band> <label> [seconds] [options]
 *
 *   subject   what's transmitting, kebab-case. e.g. dji-mini4, elrs-tx-915, tbs-crossfire, site-noise
 *   band      915 | 868 | 433  (single ISM center)
 *             sub | all        (SWEEP all three sub-GHz bands back-to-back)
 *             433,915          (comma list of bands)
 *             <MHz>            (raw center freq, e.g. 915.5)
 *   label     what this shot is: signal | hover | throttle | idle | armed | pass | noise | baseline ...
 *   seconds   capture length PER BAND (default 5)
 *
 * Options:
 *   --gain N     manual tuner gain in dB (default: auto/AGC, matches the app)
 *   --note "…"   free-text note stored in the sidecar (aircraft, radio system, distance, throttle…)
 *   --sr N       sample rate Hz (default 1024000 — covers up to 500 kHz LoRa BW)
 *   --host H     rtl_tcp host (default 127.0.0.1)
 *   --port P     rtl_tcp port (default 1234)
 *
 * Examples:
 *   # unknown aircraft — sweep every sub-GHz band, see which one lights up:
 *   node --experimental-strip-types tools/rf_field.mjs rc-plane-elrs sub signal 5 --note "TBS ELRS, 250mW"
 *   # matched noise baseline (do a sweep with TX OFF too):
 *   node --experimental-strip-types tools/rf_field.mjs site-noise sub baseline 5
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { rtlCommand, RTL_CMD, RTL_HEADER_BYTES, isRtlHeader, decodeIqU8 } from '../lib/rtlTcp.ts';
import { detectEnergy } from '../lib/rfEnergyDetect.ts';
import { detectLora } from '../lib/loraDetect.ts';

// ---- args ----------------------------------------------------------------
const argv = process.argv.slice(2);
const positional = [];
const opts = { gain: 'auto', note: '', sr: 1_024_000, host: '127.0.0.1', port: 1234 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--gain') opts.gain = parseFloat(argv[++i]);
  else if (a === '--note') opts.note = argv[++i] ?? '';
  else if (a === '--sr') opts.sr = Math.round(parseFloat(argv[++i]));
  else if (a === '--host') opts.host = argv[++i];
  else if (a === '--port') opts.port = parseInt(argv[++i], 10);
  else positional.push(a);
}
const [subject, bandArg, label, secArg] = positional;
if (!subject || !bandArg || !label) {
  console.error('usage: rf_field.mjs <subject> <band:915|868|433|sub|MHz> <label> [seconds] [--gain N] [--note "…"]');
  process.exit(2);
}
const seconds = parseFloat(secArg || '5');
const SR = opts.sr;

// ---- band arg -> list of {label, centerHz} -------------------------------
const BAND_CENTERS = { '915': 915_000_000, '868': 868_000_000, '433': 433_920_000 };
const SUB_GHZ = ['433', '868', '915']; // sweep order
function resolveBand(tok) {
  const t = String(tok).trim();
  if (BAND_CENTERS[t]) return { label: `${t}MHz`, centerHz: BAND_CENTERS[t] };
  const hz = Math.round(parseFloat(t) * 1e6);
  if (!hz || hz < 24e6 || hz > 1_700e6) return null;
  return { label: `${(hz / 1e6).toFixed(3)}MHz`, centerHz: hz };
}
let bands;
if (bandArg === 'sub' || bandArg === 'all') bands = SUB_GHZ.map(resolveBand);
else bands = String(bandArg).split(',').map(resolveBand);
if (bands.some((b) => !b)) {
  console.error(`bad band in "${bandArg}" — use 915|868|433|sub|all|<MHz within 24–1700>`);
  process.exit(2);
}

const outDir = path.join('captures', subject);
fs.mkdirSync(outDir, { recursive: true });

// ---- rtl_tcp capture of one band (fresh connection each; sequential) ------
function captureBand(centerHz) {
  const discardBytes = Math.round(SR * 2 * 0.3); // drop tuner-settling transient
  const wantBytes = Math.round(SR * 2 * seconds);
  return new Promise((resolve, reject) => {
    let headerSeen = false;
    let seen = 0;
    const chunks = [];
    let done = false;
    const sock = net.connect(opts.port, opts.host, () => {
      sock.write(rtlCommand(RTL_CMD.SET_SAMPLE_RATE, SR));
      if (opts.gain === 'auto') {
        sock.write(rtlCommand(RTL_CMD.SET_GAIN_MODE, 0));
        sock.write(rtlCommand(RTL_CMD.SET_AGC_MODE, 1));
      } else {
        sock.write(rtlCommand(RTL_CMD.SET_GAIN_MODE, 1));
        sock.write(rtlCommand(RTL_CMD.SET_GAIN, Math.round(opts.gain * 10)));
        sock.write(rtlCommand(RTL_CMD.SET_AGC_MODE, 0));
      }
      sock.write(rtlCommand(RTL_CMD.SET_FREQ, centerHz));
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      sock.destroy();
      reject(new Error('timed out — is rtl_tcp streaming? (rtl_tcp -a 127.0.0.1 -p 1234)'));
    }, (seconds + 6) * 1000);
    sock.on('data', (d) => {
      if (done) return;
      let buf = d;
      if (!headerSeen) {
        if (isRtlHeader(new Uint8Array(d.buffer, d.byteOffset, d.byteLength))) buf = d.subarray(RTL_HEADER_BYTES);
        headerSeen = true;
      }
      seen += buf.length;
      if (seen <= discardBytes) return; // still settling
      chunks.push(Buffer.from(buf));
      if (chunks.reduce((a, b) => a + b.length, 0) >= wantBytes) {
        done = true;
        clearTimeout(timer);
        sock.destroy();
        resolve(Buffer.concat(chunks).subarray(0, wantBytes));
      }
    });
    sock.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
  });
}

// ---- instant feedback: run the SHIPPED detectors over the capture --------
function analyze(out) {
  const { i: I, q: Q } = decodeIqU8(new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
  const W = 32768; // matches on-device FRAME_SAMPLES
  let present = 0, windows = 0, maxPeak = 0, lora = 0, bestSlope = 0;
  for (let p = 0; p + W <= I.length; p += W) {
    windows++;
    const e = detectEnergy(I.subarray(p, p + W), Q.subarray(p, p + W), SR);
    if (e.present) present++;
    if (e.peakDb > maxPeak) maxPeak = e.peakDb;
    if (e.present) {
      const c = detectLora(I.subarray(p, p + W), Q.subarray(p, p + W), SR);
      if (c.present) { lora++; bestSlope = c.slopeHzPerS; }
    }
  }
  const duty = windows ? (100 * present) / windows : 0;
  return { windows, present, duty, maxPeak, lora, bestSlope };
}

// ---- next sequence number for a given band label -------------------------
function nextBase(bandLabel) {
  let seq = 0, base;
  do {
    seq++;
    base = `${bandLabel}_${label}_${String(seq).padStart(2, '0')}`;
  } while (fs.existsSync(path.join(outDir, `${base}.iq8`)));
  return base;
}

// ---- main: sweep the requested band(s) -----------------------------------
const sweep = bands.length > 1;
console.log(`\n● ${subject} · ${label}${sweep ? ` · sweep ${bands.map((b) => b.label).join(' ')}` : ` · ${bands[0].label}`}`);
const results = [];
for (const b of bands) {
  process.stdout.write(`  ${b.label} @ ${(b.centerHz / 1e6).toFixed(3)} MHz, ${seconds}s … `);
  let out;
  try {
    out = await captureBand(b.centerHz);
  } catch (e) {
    console.log(`✗ ${e.message}`);
    if (String(e.message).includes('ECONNREFUSED')) {
      console.error('    -> start the server: tools/rtlsdr-win/x64/rtl_tcp.exe -a 127.0.0.1 -p 1234');
      process.exit(1);
    }
    continue;
  }
  const base = nextBase(b.label);
  const iqPath = path.join(outDir, `${base}.iq8`);
  const metaPath = path.join(outDir, `${base}.json`);
  fs.writeFileSync(iqPath, out);
  const a = analyze(out);
  const verdict = a.present === 0 ? 'no link' : a.lora > 0 ? 'LINK (LoRa/CSS)' : 'LINK (burst)';
  const meta = {
    subject, label, note: opts.note,
    band: b.label, centerFreqHz: b.centerHz, sampleRateHz: SR,
    gain: opts.gain, seconds, samples: out.length >> 1, bytes: out.length,
    createdAt: new Date().toISOString(),
    iqFile: path.basename(iqPath),
    detect: { windows: a.windows, present: a.present, dutyPct: +a.duty.toFixed(1), maxPeakDb: +a.maxPeak.toFixed(1), loraWindows: a.lora, bestSlopeHzPerS: a.bestSlope },
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  console.log(`${a.present > 0 ? '►' : '·'} ${verdict}  (peak ${a.maxPeak.toFixed(1)} dB, ${a.duty.toFixed(0)}% duty) -> ${path.basename(iqPath)}`);
  results.push({ band: b.label, ...a });
}

// ---- session summary -----------------------------------------------------
const hits = results.filter((r) => r.present > 0).sort((a, b) => b.maxPeak - a.maxPeak);
if (results.length === 0) {
  // nothing captured (all errored)
} else if (hits.length === 0) {
  console.log(`  → NO LINK on ${results.map((r) => r.band).join('/')}. Move closer / re-key TX / it may be 2.4 GHz (out of RTL range).\n`);
} else {
  const best = hits[0];
  console.log(`  → LINK on ${best.band} (peak ${best.maxPeak.toFixed(1)} dB${best.lora ? ', LoRa/CSS' : ''})${hits.length > 1 ? ` [also ${hits.slice(1).map((h) => h.band).join(',')}]` : ''}\n`);
}
process.exit(0);
