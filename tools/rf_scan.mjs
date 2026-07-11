/**
 * rf_scan.mjs -- HUNT for a real sub-GHz control link (ExpressLRS 900 / LoRa /
 * TBS Crossfire / FrSky R9-433) and tell it apart from the RTL-SDR's own spurs.
 *
 * The problem: rf_field's energy detector fires on the dongle's fixed spurs too.
 * The DISCRIMINATOR is behaviour over time:
 *   - SPUR / fixed carrier -> strong, CONTINUOUS (high duty), parks at ONE offset.
 *   - Real ELRS/Crossfire  -> FHSS: hops across the band, so in our window it's
 *                             BURSTY (low duty) and the peak offset MOVES.
 *   - Real LoRa CSS (ELRS 900 base) -> the chirp detector also tags it.
 *
 * Scans at a wider 2.4 Msps so more of the 26 MHz 900 ISM band is in view and we
 * actually catch hops. Auto-saves ONLY genuine finds to captures/sub-ghz-find/
 * (raw spurs are not worth keeping), so you can leave it scanning.
 *
 * Usage:
 *   node --experimental-strip-types tools/rf_scan.mjs [rounds] [--secs N] [--bands 433,868,915] [--quiet]
 *     rounds     how many full sweeps (default 1; use e.g. 6 to keep watching)
 *     --secs N   capture seconds per band (default 4)
 *     --bands    comma list (default 433,868,915)
 *     --quiet    only print bands with a hit
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { rtlCommand, RTL_CMD, RTL_HEADER_BYTES, isRtlHeader, decodeIqU8 } from '../lib/rtlTcp.ts';
import { detectLora } from '../lib/loraDetect.ts';

const HOST = '127.0.0.1', PORT = 1234;
const SR = 2_400_000; // wide view to catch FHSS hops across the 900 band
const BAND_CENTERS = { '433': 433_920_000, '868': 868_000_000, '915': 915_000_000 };

// ---- args ----
const argv = process.argv.slice(2);
let rounds = 1, secs = 4, quiet = false, bandList = ['433', '868', '915'];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--secs') secs = parseFloat(argv[++i]);
  else if (a === '--bands') bandList = argv[++i].split(',');
  else if (a === '--quiet') quiet = true;
  else if (/^\d+$/.test(a)) rounds = parseInt(a, 10);
}

function captureBand(centerHz) {
  const discardBytes = Math.round(SR * 2 * 0.3);
  const wantBytes = Math.round(SR * 2 * secs);
  return new Promise((resolve, reject) => {
    let headerSeen = false, seen = 0, done = false;
    const chunks = [];
    const sock = net.connect(PORT, HOST, () => {
      sock.write(rtlCommand(RTL_CMD.SET_SAMPLE_RATE, SR));
      sock.write(rtlCommand(RTL_CMD.SET_GAIN_MODE, 0));
      sock.write(rtlCommand(RTL_CMD.SET_AGC_MODE, 1));
      sock.write(rtlCommand(RTL_CMD.SET_FREQ, centerHz));
    });
    const timer = setTimeout(() => { if (!done) { done = true; sock.destroy(); reject(new Error('timeout')); } }, (secs + 6) * 1000);
    sock.on('data', (d) => {
      if (done) return;
      let buf = d;
      if (!headerSeen) { if (isRtlHeader(new Uint8Array(d.buffer, d.byteOffset, d.byteLength))) buf = d.subarray(RTL_HEADER_BYTES); headerSeen = true; }
      seen += buf.length;
      if (seen <= discardBytes) return;
      chunks.push(Buffer.from(buf));
      if (chunks.reduce((a, b) => a + b.length, 0) >= wantBytes) {
        done = true; clearTimeout(timer); sock.destroy();
        resolve(Buffer.concat(chunks).subarray(0, wantBytes));
      }
    });
    sock.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
  });
}

// in-place radix-2 FFT
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = (-2 * Math.PI) / len, wRe = Math.cos(ang), wIm = Math.sin(ang); for (let i = 0; i < n; i += len) { let cRe = 1, cIm = 0; for (let k = 0; k < len / 2; k++) { const aRe = re[i + k], aIm = im[i + k]; const bRe = re[i + k + len / 2] * cRe - im[i + k + len / 2] * cIm; const bIm = re[i + k + len / 2] * cIm + im[i + k + len / 2] * cRe; re[i + k] = aRe + bRe; im[i + k] = aIm + bIm; re[i + k + len / 2] = aRe - bRe; im[i + k + len / 2] = aIm - bIm; const nRe = cRe * wRe - cIm * wIm; cIm = cRe * wIm + cIm * wRe; cRe = nRe; } } }
}

// Frame-by-frame peak tracking. The discriminator is COHERENCE, not raw peaks:
//  - noise floor wanders (peaks jump to random offsets, barely over median) — reject
//    with a high STRONG_DB gate so only real emissions/spurs count.
//  - a SPUR is strong but sits at ONE offset (high dominant-bucket fraction).
//  - real FHSS is strong bursts at MANY discrete offsets, and (in our narrow window
//    vs the 26 MHz hop band) BURSTY = well under 100% duty.
function hopAnalyze(I, Q) {
  const L = 2048, EXCL = 6, STRONG_DB = 16; // 16 dB gate rejects wandering noise (~10-13 dB)
  const re = new Float64Array(L), im = new Float64Array(L), p = new Float64Array(L);
  const nFrames = Math.floor(I.length / L);
  let maxDb = 0;
  const strongOffsets = [];
  for (let f = 0; f < nFrames; f++) {
    const off = f * L;
    for (let k = 0; k < L; k++) { re[k] = I[off + k]; im[k] = Q[off + k]; }
    fft(re, im);
    for (let m = 0; m < L; m++) p[m] = re[m] * re[m] + im[m] * im[m];
    const sorted = Float64Array.from(p).sort();
    const med = sorted[L >> 1] + 1e-12;
    let peak = 0, peakBin = 0;
    for (let m = 0; m < L; m++) { if (m <= EXCL || m >= L - EXCL) continue; if (p[m] > peak) { peak = p[m]; peakBin = m; } }
    const db = 10 * Math.log10(peak / med);
    if (db > maxDb) maxDb = db;
    if (db > STRONG_DB) strongOffsets.push((peakBin < L / 2 ? peakBin : peakBin - L) * (SR / L) / 1e3);
  }
  // bucket strong-frame offsets to 50 kHz; find the dominant bucket
  const counts = new Map();
  for (const o of strongOffsets) { const b = Math.round(o / 50); counts.set(b, (counts.get(b) || 0) + 1); }
  let topBucket = 0, topN = 0;
  for (const [b, n] of counts) if (n > topN) { topN = n; topBucket = b; }
  const strongCount = strongOffsets.length;
  const bandBuckets = Math.max(1, Math.round((SR / 1000) / 50)); // total 50 kHz buckets across the window
  return {
    nFrames, strongCount,
    strongDuty: nFrames ? strongCount / nFrames : 0,
    distinctStrong: counts.size,
    fillFrac: counts.size / bandBuckets,   // fraction of the WHOLE band that has peaks
    dominantFrac: strongCount ? topN / strongCount : 0,
    topLocKHz: topBucket * 50,
    maxDb,
    locsKHz: [...counts.keys()].map((b) => b * 50).sort((a, b) => a - b),
  };
}

function classify(h, chirp) {
  if (h.strongCount < 3) return { tag: 'clear', real: false, msg: `no sustained emission (peak ${h.maxDb | 0} dB, mostly noise floor)` };
  // Wandering noise fills the ENTIRE band uniformly; a real link occupies a few
  // discrete channels. >50% of all buckets lit = noise smear, not FHSS.
  if (h.fillFrac > 0.5) return { tag: 'noise', real: false, msg: `peaks smeared across ${(h.fillFrac * 100) | 0}% of the band — wandering noise, not a link (peak ${h.maxDb | 0} dB)` };
  // A spur: strong energy concentrated at ONE offset.
  if (h.dominantFrac > 0.6) return { tag: 'SPUR', real: false, msg: `fixed carrier @ ${h.topLocKHz} kHz (${(h.dominantFrac * 100) | 0}% of strong frames, peak ${h.maxDb | 0} dB) — ignore` };
  // Real FHSS: strong bursts across a FEW discrete channels, bursty (not continuous).
  if (h.distinctStrong >= 4 && h.strongDuty < 0.6) return { tag: 'HOPPING LINK', real: true, msg: `bursty FHSS across ${h.distinctStrong} channels (${(h.strongDuty * 100) | 0}% duty, peak ${h.maxDb | 0} dB) — ELRS/Crossfire/FrSky — VERIFY` };
  if (chirp && h.distinctStrong >= 2 && h.strongDuty < 0.6) return { tag: 'LoRa CSS', real: true, msg: `chirp-spread across ${h.distinctStrong} offsets (peak ${h.maxDb | 0} dB) — ELRS 900 / LoRa — VERIFY` };
  return { tag: 'inconclusive', real: false, msg: `scattered strong peaks, no clear FHSS pattern (${h.distinctStrong} offsets, ${(h.strongDuty * 100) | 0}% duty) — watch` };
}

const outDir = path.join('captures', 'sub-ghz-find');
let anyReal = false;
for (let r = 0; r < rounds; r++) {
  if (rounds > 1) console.log(`\n— sweep ${r + 1}/${rounds} —`);
  for (const b of bandList) {
    const centerHz = BAND_CENTERS[b];
    if (!centerHz) { console.log(`  ${b}: unknown band`); continue; }
    let out;
    try { out = await captureBand(centerHz); }
    catch (e) {
      if (String(e.message).includes('ECONNREFUSED')) { console.error('rtl_tcp not running -> tools/rtlsdr-win/x64/rtl_tcp.exe -a 127.0.0.1 -p 1234'); process.exit(1); }
      console.log(`  ${b}MHz: capture failed (${e.message})`); continue;
    }
    const { i: I, q: Q } = decodeIqU8(new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
    // chirp check on the strongest chunk (32k window)
    let chirp = false;
    for (let pos = 0; pos + 32768 <= I.length; pos += 32768) {
      if (detectLora(I.subarray(pos, pos + 32768), Q.subarray(pos, pos + 32768), SR).present) { chirp = true; break; }
    }
    const h = hopAnalyze(I, Q);
    const v = classify(h, chirp);
    if (!quiet || v.real) {
      const mark = v.real ? '★ REAL' : v.tag === 'SPUR' ? '·' : '?';
      console.log(`  ${mark} ${b}MHz  [${v.tag}]  ${v.msg}  (peak ${h.maxDb.toFixed(0)} dB)`);
    }
    if (v.real) {
      anyReal = true;
      fs.mkdirSync(outDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const base = `${b}MHz_${v.tag.replace(/\W+/g, '')}_${ts}`;
      fs.writeFileSync(path.join(outDir, `${base}.iq8`), out);
      fs.writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify({
        band: `${b}MHz`, centerFreqHz: centerHz, sampleRateHz: SR, seconds: secs,
        verdict: v.tag, detail: v.msg, hop: h, chirp, createdAt: new Date().toISOString(),
      }, null, 2) + '\n');
      console.log(`      saved -> ${path.join(outDir, base)}.iq8`);
    }
  }
}
console.log(anyReal ? '\n★ real sub-GHz link(s) found and saved.' : '\nno real sub-GHz links this pass — only spurs/quiet.');
process.exit(0);
