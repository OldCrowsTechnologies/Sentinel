/**
 * rf_console.mjs -- LOCAL one-click capture dashboard for Sentinel field work.
 *
 * Unlike the sandboxed Artifact, this is a real local server: its buttons ACTUALLY
 * fire the SDR through rtl_tcp, save the IQ + sidecar, run the shipped detectors and
 * show the verdict, ingest phone/camera clips to training audio, and kick a retrain
 * -- closing the loop capture -> data -> updated model right here.
 *
 * Pure Node built-ins (http/net/fs/child_process) + the same lib the app ships, so
 * captures are byte-identical to on-device. No new dependencies.
 *
 * Run:   npm run console          (then open http://127.0.0.1:8787)
 * Needs: rtl_tcp already serving   (tools/rtlsdr-win/x64/rtl_tcp.exe -a 127.0.0.1 -p 1234)
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { rtlCommand, RTL_CMD, RTL_HEADER_BYTES, isRtlHeader, decodeIqU8 } from '../lib/rtlTcp.ts';
import { detectEnergy } from '../lib/rfEnergyDetect.ts';
import { detectLora } from '../lib/loraDetect.ts';

const RTL_HOST = '127.0.0.1', RTL_PORT = 1234;
const PORT = parseInt(process.argv[2] || '8787', 10);
const SR = 1_024_000;             // on-device sample rate (captures replay identically)
const SCAN_SR = 2_400_000;        // wider for hop hunting
const BAND_CENTERS = { '915': 915_000_000, '868': 868_000_000, '433': 433_920_000 };
const CLASSES = ["None","Bird","Manned rotorcraft","Manned fixed-wing","Small multirotor","Medium multirotor","Large multirotor","FPV racer","Fixed-wing UAS","Combustion UAS","RC helicopter","Skydio X2","DJI Phantom","Parrot Anafi","Potensic Atom 2","DJI Mini 3 Pro","DJI Mini 5 Pro","DJI FPV","DJI Avata 2","DJI Mavic 3","Yuneec","Unknown"];

// ---- SDR access lock (rtl_tcp serves one client) --------------------------
// rtl_tcp serves ONE client and briefly refuses connects while tearing down the
// previous one. So: never probe it just to check status (that probe itself
// triggers a teardown and can starve a real capture) — cache the last real
// result instead — and retry a capture's connect across the teardown window.
let busy = false;
let lastRtlOk = null; // null = unknown until first capture/scan
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function captureBand(centerHz, sr, seconds, gain) {
  const discardBytes = Math.round(sr * 2 * 0.3);
  const wantBytes = Math.round(sr * 2 * seconds);
  return new Promise((resolve, reject) => {
    let headerSeen = false, seen = 0, done = false;
    const chunks = [];
    const sock = net.connect(RTL_PORT, RTL_HOST, () => {
      sock.write(rtlCommand(RTL_CMD.SET_SAMPLE_RATE, sr));
      if (gain == null || gain === 'auto') {
        sock.write(rtlCommand(RTL_CMD.SET_GAIN_MODE, 0));
        sock.write(rtlCommand(RTL_CMD.SET_AGC_MODE, 1));
      } else {
        sock.write(rtlCommand(RTL_CMD.SET_GAIN_MODE, 1));
        sock.write(rtlCommand(RTL_CMD.SET_GAIN, Math.round(gain * 10)));
        sock.write(rtlCommand(RTL_CMD.SET_AGC_MODE, 0));
      }
      sock.write(rtlCommand(RTL_CMD.SET_FREQ, centerHz));
    });
    const timer = setTimeout(() => { if (!done) { done = true; sock.destroy(); reject(new Error('capture timeout — is rtl_tcp streaming?')); } }, (seconds + 6) * 1000);
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

// retry the connect across rtl_tcp's single-client teardown window
async function captureWithRetry(centerHz, sr, seconds, gain) {
  for (let t = 0; ; t++) {
    try { return await captureBand(centerHz, sr, seconds, gain); }
    catch (e) {
      if (t >= 2 || !String(e && e.message).includes('ECONNREFUSED')) throw e;
      await sleep(450);
    }
  }
}

// on-device detectors over the capture (instant verdict)
function analyze(out, sr) {
  const { i: I, q: Q } = decodeIqU8(new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
  const W = 32768;
  let present = 0, windows = 0, maxPeak = 0, lora = 0;
  for (let p = 0; p + W <= I.length; p += W) {
    windows++;
    const e = detectEnergy(I.subarray(p, p + W), Q.subarray(p, p + W), sr);
    if (e.present) { present++; if (detectLora(I.subarray(p, p + W), Q.subarray(p, p + W), sr).present) lora++; }
    if (e.peakDb > maxPeak) maxPeak = e.peakDb;
  }
  const duty = windows ? (100 * present) / windows : 0;
  return { windows, present, dutyPct: +duty.toFixed(1), maxPeakDb: +maxPeak.toFixed(1), lora };
}

// hop-aware classifier (matches rf_scan: 16 dB gate + dominant-offset)
function hopClassify(out, sr) {
  const { i: I, q: Q } = decodeIqU8(new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
  const L = 2048, EXCL = 6, STRONG = 16;
  const re = new Float64Array(L), im = new Float64Array(L), p = new Float64Array(L);
  const nF = Math.floor(I.length / L); let maxDb = 0; const offs = [];
  for (let f = 0; f < nF; f++) {
    const o = f * L;
    for (let k = 0; k < L; k++) { re[k] = I[o + k]; im[k] = Q[o + k]; }
    fft(re, im);
    for (let m = 0; m < L; m++) p[m] = re[m] * re[m] + im[m] * im[m];
    const s = Float64Array.from(p).sort(); const med = s[L >> 1] + 1e-12;
    let pk = 0, pb = 0; for (let m = 0; m < L; m++) { if (m <= EXCL || m >= L - EXCL) continue; if (p[m] > pk) { pk = p[m]; pb = m; } }
    const db = 10 * Math.log10(pk / med); if (db > maxDb) maxDb = db;
    if (db > STRONG) offs.push(Math.round(((pb < L / 2 ? pb : pb - L) * (sr / L) / 1e3) / 50));
  }
  const counts = new Map(); for (const b of offs) counts.set(b, (counts.get(b) || 0) + 1);
  let topN = 0; for (const n of counts.values()) if (n > topN) topN = n;
  const strong = offs.length, distinct = counts.size, dutyStrong = nF ? strong / nF : 0, domFrac = strong ? topN / strong : 0;
  const bandBuckets = Math.max(1, Math.round((sr / 1000) / 50)), fillFrac = distinct / bandBuckets;
  if (strong < 3) return { tag: 'clear', real: false, maxDb, msg: `no sustained emission (${maxDb | 0} dB)` };
  // noise wanders across the WHOLE band; a real link sits on a few discrete channels
  if (fillFrac > 0.5) return { tag: 'noise', real: false, maxDb, msg: `peaks smeared across ${(fillFrac * 100) | 0}% of band — wandering noise, not a link` };
  if (domFrac > 0.6) return { tag: 'SPUR', real: false, maxDb, msg: `fixed carrier (${(domFrac * 100) | 0}% at one offset) — ignore` };
  if (distinct >= 4 && dutyStrong < 0.6) return { tag: 'HOPPING LINK', real: true, maxDb, msg: `FHSS across ${distinct} channels — ELRS/Crossfire — verify` };
  return { tag: 'inconclusive', real: false, maxDb, msg: `${distinct} offsets, ${(dutyStrong * 100) | 0}% duty` };
}
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = (-2 * Math.PI) / len, wRe = Math.cos(ang), wIm = Math.sin(ang); for (let i = 0; i < n; i += len) { let cRe = 1, cIm = 0; for (let k = 0; k < len / 2; k++) { const aRe = re[i + k], aIm = im[i + k]; const bRe = re[i + k + len / 2] * cRe - im[i + k + len / 2] * cIm; const bIm = re[i + k + len / 2] * cIm + im[i + k + len / 2] * cRe; re[i + k] = aRe + bRe; im[i + k] = aIm + bIm; re[i + k + len / 2] = aRe - bRe; im[i + k + len / 2] = aIm - bIm; const nRe = cRe * wRe - cIm * wIm; cIm = cRe * wIm + cIm * wRe; cRe = nRe; } } }
}

function kebab(s) { return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function nextBase(dir, bandLabel, label) {
  let seq = 0, base;
  do { seq++; base = `${bandLabel}_${label}_${String(seq).padStart(2, '0')}`; } while (fs.existsSync(path.join(dir, `${base}.iq8`)));
  return base;
}

// ---- capture handler (single band or 'sub' sweep) -------------------------
async function doCapture(body) {
  const subject = kebab(body.subject) || 'subject';
  const label = kebab(body.label) || 'signal';
  const seconds = Math.min(30, Math.max(1, +body.seconds || 6));
  const gain = body.gain === 'auto' || body.gain == null ? 'auto' : +body.gain;
  const note = String(body.note || '');
  const bands = body.band === 'sub' ? ['433', '868', '915'] : [String(body.band || '915')];
  const outDir = path.join('captures', subject);
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const b of bands) {
    const centerHz = BAND_CENTERS[b] || Math.round(parseFloat(b) * 1e6);
    const out = await captureWithRetry(centerHz, SR, seconds, gain);
    const a = analyze(out, SR);
    const base = nextBase(outDir, `${b}MHz`, label);
    const iqPath = path.join(outDir, `${base}.iq8`);
    fs.writeFileSync(iqPath, out);
    const verdict = a.present === 0 ? 'NO LINK' : a.lora > 0 ? 'LINK · LoRa/CSS' : 'LINK · burst';
    const meta = { subject, label, note, band: `${b}MHz`, centerFreqHz: centerHz, sampleRateHz: SR, gain, seconds, samples: out.length >> 1, bytes: out.length, createdAt: new Date().toISOString(), iqFile: path.basename(iqPath), detect: a };
    fs.writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify(meta, null, 2) + '\n');
    results.push({ band: `${b}MHz`, verdict, present: a.present > 0, ...a, file: iqPath.replace(/\\/g, '/'), mb: +(out.length / 1e6).toFixed(1) });
  }
  return { subject, label, note, results };
}

async function doScan(body) {
  const bands = (body.bands && body.bands.length ? body.bands : ['433', '868', '915']).map(String);
  const secs = Math.min(10, Math.max(1, +body.secs || 4));
  const out = [];
  const finds = [];
  for (const b of bands) {
    const centerHz = BAND_CENTERS[b]; if (!centerHz) continue;
    const buf = await captureWithRetry(centerHz, SCAN_SR, secs, 'auto');
    const v = hopClassify(buf, SCAN_SR);
    out.push({ band: `${b}MHz`, ...v });
    if (v.real) {
      const dir = path.join('captures', 'sub-ghz-find'); fs.mkdirSync(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const base = `${b}MHz_${v.tag.replace(/\W+/g, '')}_${ts}`;
      fs.writeFileSync(path.join(dir, `${base}.iq8`), buf);
      fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify({ band: `${b}MHz`, centerFreqHz: centerHz, sampleRateHz: SCAN_SR, seconds: secs, ...v, createdAt: new Date().toISOString() }, null, 2) + '\n');
      finds.push(`${dir}/${base}.iq8`);
    }
  }
  return { bands: out, finds };
}

function listCaptures() {
  const root = 'captures'; const rows = [];
  if (!fs.existsSync(root)) return rows;
  for (const subj of fs.readdirSync(root)) {
    const d = path.join(root, subj);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.json')) continue;
      try { const m = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); rows.push({ subject: subj, ...m }); } catch {}
    }
  }
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return rows.slice(0, 40);
}

function rtlTcpUp() {
  return new Promise((resolve) => {
    const s = net.connect(RTL_PORT, RTL_HOST, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    setTimeout(() => { s.destroy(); resolve(false); }, 1200);
  });
}

// ---- HTTP ----------------------------------------------------------------
function sendJSON(res, code, obj) { const s = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) }); res.end(s); }
function readBody(req) { return new Promise((resolve) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } }); }); }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
    if (req.method === 'GET' && url.pathname === '/api/status') { return sendJSON(res, 200, { rtlTcp: lastRtlOk, busy, captures: listCaptures().length }); }
    if (req.method === 'GET' && url.pathname === '/api/captures') { return sendJSON(res, 200, { rows: listCaptures() }); }

    if (req.method === 'POST' && (url.pathname === '/api/capture' || url.pathname === '/api/scan')) {
      if (busy) return sendJSON(res, 409, { error: 'SDR busy — one capture at a time' });
      const body = await readBody(req);
      busy = true;
      try {
        const out = url.pathname === '/api/capture' ? await doCapture(body) : await doScan(body);
        lastRtlOk = true;
        return sendJSON(res, 200, out);
      } catch (e) {
        const msg = String(e && e.message || e);
        const refused = msg.includes('ECONNREFUSED');
        if (refused) lastRtlOk = false;
        return sendJSON(res, 500, { error: refused ? 'rtl_tcp not running — start tools/rtlsdr-win/x64/rtl_tcp.exe -a 127.0.0.1 -p 1234' : msg });
      } finally { busy = false; }
    }

    if (req.method === 'POST' && url.pathname === '/api/ingest') {
      const body = await readBody(req);
      const args = ['tools/audio_ingest.mjs', String(body.src || ''), String(body.klass || 'Unknown')];
      if (body.note) args.push('--note', String(body.note));
      if (body.dry) args.push('--dry');
      return execFile('node', args, { cwd: process.cwd(), maxBuffer: 8 << 20 }, (err, so, se) => {
        sendJSON(res, err && !so ? 500 : 200, { ok: !err, output: (so || '') + (se || '') });
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/retrain') {
      // fire-and-report; retrain overwrites assets/models/corvus-model.json + checks parity
      return execFile('powershell', ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/retrain.ps1'], { cwd: process.cwd(), maxBuffer: 32 << 20, timeout: 15 * 60 * 1000 }, (err, so, se) => {
        const tail = ((so || '') + (se || '')).split('\n').slice(-25).join('\n');
        sendJSON(res, err ? 500 : 200, { ok: !err, output: tail });
      });
    }

    res.writeHead(404); res.end('not found');
  } catch (e) { sendJSON(res, 500, { error: String(e && e.message || e) }); }
});

server.listen(PORT, RTL_HOST, () => {
  console.log(`\n  Sentinel capture console -> http://127.0.0.1:${PORT}`);
  console.log(`  (needs rtl_tcp on ${RTL_HOST}:${RTL_PORT})\n`);
  // one gentle probe at startup to seed the status pill (safe while idle)
  rtlTcpUp().then((v) => { lastRtlOk = v; });
});

// ---- dashboard page (served inline) --------------------------------------
const CLASS_OPTS = CLASSES.map((c) => `<option value="${c}"${c === 'Fixed-wing UAS' ? ' selected' : ''}>${c}</option>`).join('');
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sentinel Capture Console</title>
<style>
:root{--bg:#0c0f12;--surface:#12181d;--surface2:#19222a;--line:#26313b;--lineS:#33414d;--text:#e7eef4;--muted:#8695a3;--faint:#5d6b78;--accent:#e9c46a;--accentD:#c79a3a;--good:#54c78c;--warn:#e0872e;--bad:#db5a46;--codeBg:#0a0d10;--mono:ui-monospace,"Cascadia Code",Consolas,monospace;--sans:system-ui,"Segoe UI",Roboto,sans-serif;color-scheme:dark}
:root[data-theme=light]{--bg:#eef1f3;--surface:#fff;--surface2:#f4f6f8;--line:#dde3e8;--lineS:#c7d0d8;--text:#16202a;--muted:#5a6875;--faint:#8a97a3;--accent:#a9791b;--accentD:#8a6112;--good:#1f9d63;--warn:#b9631a;--bad:#c23b28;--codeBg:#0f151a;color-scheme:light}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);line-height:1.5}
.wrap{max-width:1040px;margin:0 auto;padding:0 20px 60px}
header{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:20px 0 14px}
.glyph{width:34px;height:34px;border-radius:8px;background:radial-gradient(120% 120% at 30% 20%,var(--accent),var(--accentD));display:grid;place-items:center;font-size:19px;color:#1a130a}
h1{font-size:15px;margin:0;letter-spacing:.06em;text-transform:uppercase}
header p{margin:1px 0 0;font-size:11.5px;color:var(--muted);font-family:var(--mono)}
.sp{flex:1}
.status{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;padding:7px 13px;border-radius:999px;border:1px solid var(--line);background:var(--surface)}
.status .led{width:9px;height:9px;border-radius:50%;background:var(--faint)}
.status.up .led{background:var(--good);box-shadow:0 0 8px var(--good)}
.status.down .led{background:var(--bad)}
.tog{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:7px 12px;cursor:pointer}
hr.rule{height:2px;border:0;margin:0 0 20px;background:linear-gradient(90deg,transparent,var(--accentD),var(--accent),var(--accentD),transparent);opacity:.5}
.tabs{display:flex;gap:4px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:4px;width:fit-content;margin-bottom:18px}
.tab{font-family:var(--mono);font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);background:0;border:0;border-radius:7px;padding:9px 15px;cursor:pointer;font-weight:600}
.tab[aria-selected=true]{background:var(--surface2);color:var(--accent);box-shadow:inset 0 0 0 1px var(--lineS)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
@media(max-width:740px){.grid{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px}
.card h2{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:0 0 15px;font-weight:700}
.field{margin-bottom:14px}.field>label{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:6px}
input,select{width:100%;font-family:var(--mono);font-size:13px;color:var(--text);background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:9px 11px}
input:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(233,196,106,.16)}
.seg{display:flex;flex-wrap:wrap;gap:6px}.seg button{font-family:var(--mono);font-size:12px;color:var(--muted);background:var(--surface2);border:1px solid var(--line);border-radius:7px;padding:8px 12px;cursor:pointer}
.seg button[aria-pressed=true]{color:#1a130a;background:var(--accent);border-color:var(--accent);font-weight:700}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.go{width:100%;font-family:var(--mono);font-size:14px;letter-spacing:.04em;color:#1a130a;background:var(--accent);border:0;border-radius:9px;padding:13px;cursor:pointer;font-weight:700;margin-top:4px}
.go:hover{background:#f1cf7d}.go:disabled{opacity:.5;cursor:progress}
.go.alt{background:var(--surface2);color:var(--text);border:1px solid var(--lineS)}
.out{min-height:80px;background:var(--codeBg);border:1px solid var(--lineS);border-radius:12px;padding:16px;font-family:var(--mono);font-size:12.5px;color:#f0f4f7;white-space:pre-wrap;word-break:break-word}
.res{display:flex;flex-direction:column;gap:10px}
.bres{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--surface2)}
.bres .top{display:flex;align-items:center;gap:10px;justify-content:space-between}
.tag{font-family:var(--mono);font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px}
.tag.good{color:#0c1a12;background:var(--good)}.tag.bad{color:#fff;background:var(--bad)}.tag.spur{color:#1a130a;background:var(--warn)}.tag.neutral{color:var(--muted);border:1px solid var(--line)}
.bres .meta{font-family:var(--mono);font-size:11.5px;color:var(--muted);margin-top:6px}
.bres .band{font-family:var(--mono);font-weight:700;font-size:14px}
.hint{font-size:12px;color:var(--muted);margin:-4px 0 14px}
.log{margin-top:26px}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
th{font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}
td.mono{font-family:var(--mono)}.tw{overflow-x:auto}
.hidden{display:none!important}
.banner{background:color-mix(in srgb,var(--bad) 12%,transparent);border:1px solid color-mix(in srgb,var(--bad) 40%,var(--line));color:var(--text);border-radius:10px;padding:10px 14px;font-size:12.5px;margin-bottom:16px}
.banner code{font-family:var(--mono);background:var(--codeBg);padding:2px 6px;border-radius:4px}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><div class="wrap">
<header>
  <div class="glyph">📡</div>
  <div><h1>Sentinel · Capture Console</h1><p>one-click · fires the SDR · updates the model</p></div>
  <div class="sp"></div>
  <div class="status" id="status"><span class="led"></span><span id="statusTxt">checking…</span></div>
  <button class="tog" id="theme">◐ Theme</button>
</header>
<hr class="rule">
<div class="banner hidden" id="rtlWarn">rtl_tcp isn't reachable. Start it: <code>tools\\rtlsdr-win\\x64\\rtl_tcp.exe -a 127.0.0.1 -p 1234</code>, then this clears.</div>

<div class="tabs" role="tablist">
  <button class="tab" role="tab" aria-selected="true" data-panel="p-cap">Capture</button>
  <button class="tab" role="tab" aria-selected="false" data-panel="p-scan">Hunt sub-GHz</button>
  <button class="tab" role="tab" aria-selected="false" data-panel="p-ing">Ingest audio</button>
</div>

<section class="grid" id="p-cap">
  <div class="card">
    <h2>Labeled RF capture</h2>
    <div class="field"><label>Subject — what's transmitting</label><input id="cSubj" placeholder="e.g. dji-drone or elrs-plane" autocomplete="off"></div>
    <div class="field"><label>Band</label><div class="seg" id="cBand" data-single>
      <button data-v="915" aria-pressed="true">915</button><button data-v="868" aria-pressed="false">868</button><button data-v="433" aria-pressed="false">433</button><button data-v="sub" aria-pressed="false">sub · sweep</button></div></div>
    <div class="field"><label>Label</label><div class="seg" id="cLabel" data-single>
      <button data-v="signal" aria-pressed="true">signal</button><button data-v="baseline" aria-pressed="false">baseline</button><button data-v="hover" aria-pressed="false">hover</button><button data-v="throttle" aria-pressed="false">throttle</button><button data-v="pass" aria-pressed="false">pass</button></div></div>
    <div class="row2">
      <div class="field"><label>Seconds / band</label><input id="cSecs" type="number" value="6" min="1" max="30"></div>
      <div class="field"><label>Gain</label><select id="cGain"><option value="auto">auto (AGC)</option><option value="20">20 dB</option><option value="30">30 dB</option><option value="40">40 dB</option><option value="49">49 dB</option></select></div>
    </div>
    <div class="field"><label>Note — aircraft, distance, power</label><input id="cNote" placeholder="DJI drone, ~20m hover" autocomplete="off"></div>
    <button class="go" id="capBtn">● Capture</button>
  </div>
  <div class="card"><h2>Result</h2><div class="res" id="capRes"><div class="out">Set a subject, pick a band, hit Capture. The SDR fires and the verdict shows here.</div></div></div>
</section>

<section class="grid hidden" id="p-scan">
  <div class="card">
    <h2>Hunt for real ELRS / LoRa</h2>
    <p class="hint">One sweep across the sub-GHz bands. Tells a real hopping link from the dongle's spurs; saves genuine finds automatically.</p>
    <div class="field"><label>Bands</label><div class="seg" id="sBands">
      <button data-v="433" aria-pressed="true">433</button><button data-v="868" aria-pressed="true">868</button><button data-v="915" aria-pressed="true">915</button></div></div>
    <div class="field"><label>Seconds / band</label><input id="sSecs" type="number" value="4" min="1" max="10"></div>
    <button class="go" id="scanBtn">◎ Run one sweep</button>
  </div>
  <div class="card"><h2>Result</h2><div class="res" id="scanRes"><div class="out">Hunt sweeps 433/868/915 and classifies each.</div></div></div>
</section>

<section class="grid hidden" id="p-ing">
  <div class="card">
    <h2>Clips → training audio</h2>
    <p class="hint">Converts audio + video to 16 kHz mono WAV into a class folder. Every video doubles as an acoustic sample.</p>
    <div class="field"><label>Source file or folder</label><input id="iSrc" placeholder="C:/Users/joshu/Downloads/field/drone" autocomplete="off"></div>
    <div class="field"><label>Class</label><select id="iClass">${CLASS_OPTS}</select></div>
    <div class="field"><label>Note — appended to filenames</label><input id="iNote" placeholder="dji-20m" autocomplete="off"></div>
    <div class="row2"><button class="go alt" id="ingDry">Preview (dry)</button><button class="go" id="ingBtn">▶ Ingest</button></div>
  </div>
  <div class="card"><h2>Result</h2><div class="out" id="ingRes">Point at your phone/camera dump and ingest by class.</div>
    <h2 style="margin-top:18px">Update Sentinel</h2><p class="hint">Retrains the acoustic model on all class folders + checks parity. Takes a few minutes.</p>
    <button class="go alt" id="retrainBtn">⟳ Retrain model</button>
    <div class="out hidden" id="retrainRes" style="margin-top:10px"></div>
  </div>
</section>

<div class="log card">
  <h2>Recent captures</h2>
  <div class="tw"><table><thead><tr><th>when</th><th>subject</th><th>band</th><th>label</th><th>verdict</th><th>peak</th><th>duty</th></tr></thead><tbody id="logBody"><tr><td colspan="7" style="color:var(--faint)">none yet</td></tr></tbody></table></div>
</div>
</div>
<script>
var $=function(s,r){return (r||document).querySelector(s)},$$=function(s,r){return [].slice.call((r||document).querySelectorAll(s))};
try{var t=localStorage.getItem('sc-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}
$('#theme').onclick=function(){var c=document.documentElement.getAttribute('data-theme');var d=c?c==='dark':matchMedia('(prefers-color-scheme:dark)').matches;var n=d?'light':'dark';document.documentElement.setAttribute('data-theme',n);try{localStorage.setItem('sc-theme',n)}catch(e){}};
$$('.tab').forEach(function(t){t.onclick=function(){$$('.tab').forEach(function(x){x.setAttribute('aria-selected','false')});t.setAttribute('aria-selected','true');$$('.grid,.log').forEach(function(){});['p-cap','p-scan','p-ing'].forEach(function(id){$('#'+id).classList.add('hidden')});$('#'+t.dataset.panel).classList.remove('hidden')}});
$$('.seg').forEach(function(seg){var single=seg.hasAttribute('data-single');seg.onclick=function(e){var b=e.target.closest('button');if(!b)return;if(single){$$('button',seg).forEach(function(x){x.setAttribute('aria-pressed','false')});b.setAttribute('aria-pressed','true')}else{var on=b.getAttribute('aria-pressed')==='true';if(on&&$$("button[aria-pressed=true]",seg).length===1)return;b.setAttribute('aria-pressed',on?'false':'true')}}});
function segVal(id){return $$('#'+id+" button[aria-pressed=true]").map(function(b){return b.dataset.v})}
function tagClass(v){if(v==='SPUR')return 'spur';if(v==='clear'||v==='inconclusive')return 'neutral';return v.indexOf('NO LINK')>=0?'bad':'good'}
async function api(p,b){var r=await fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});var j=await r.json();if(!r.ok)throw new Error(j.error||'error');return j}
async function refresh(){try{var s=await (await fetch('/api/status')).json();var st=s.rtlTcp;var el=$('#status');el.className='status '+(st===true?'up':st===false?'down':'');$('#statusTxt').textContent=st===true?'rtl_tcp connected':st===false?'rtl_tcp down':'checking…';$('#rtlWarn').classList.toggle('hidden',st!==false);}catch(e){}
 try{var c=await (await fetch('/api/captures')).json();var b=$('#logBody');if(!c.rows.length){return}b.innerHTML=c.rows.map(function(r){var v=r.detect&&r.detect.present?(r.detect.lora?'LINK·LoRa':'LINK'):'no link';return '<tr><td class=mono>'+(r.createdAt||'').slice(11,19)+'</td><td>'+r.subject+'</td><td class=mono>'+r.band+'</td><td class=mono>'+r.label+'</td><td class=mono>'+v+'</td><td class=mono>'+(r.detect?r.detect.maxPeakDb:'')+'</td><td class=mono>'+(r.detect?r.detect.dutyPct+'%':'')+'</td></tr>'}).join('')}catch(e){}}
$('#capBtn').onclick=async function(){var btn=this;btn.disabled=true;var old=btn.textContent;btn.textContent='● Capturing…';$('#capRes').innerHTML='<div class=out>Firing the SDR…</div>';try{var j=await api('/api/capture',{subject:$('#cSubj').value,band:segVal('cBand')[0],label:segVal('cLabel')[0],seconds:$('#cSecs').value,gain:$('#cGain').value,note:$('#cNote').value});$('#capRes').innerHTML=j.results.map(function(r){var t=r.verdict.indexOf('NO')>=0?'bad':'good';return '<div class=bres><div class=top><span class=band>'+r.band+'</span><span class="tag '+t+'">'+r.verdict+'</span></div><div class=meta>peak '+r.maxPeakDb+' dB · '+r.dutyPct+'% duty · '+r.present+'/'+r.windows+' windows · '+r.mb+' MB</div><div class=meta>'+r.file+'</div></div>'}).join('');refresh()}catch(e){$('#capRes').innerHTML='<div class=out style="color:var(--bad)">'+e.message+'</div>'}btn.disabled=false;btn.textContent=old};
$('#scanBtn').onclick=async function(){var btn=this;btn.disabled=true;var old=btn.textContent;btn.textContent='◎ Sweeping…';$('#scanRes').innerHTML='<div class=out>Sweeping…</div>';try{var j=await api('/api/scan',{bands:segVal('sBands'),secs:$('#sSecs').value});$('#scanRes').innerHTML=j.bands.map(function(r){return '<div class=bres><div class=top><span class=band>'+r.band+'</span><span class="tag '+tagClass(r.tag)+'">'+r.tag+'</span></div><div class=meta>'+r.msg+' · peak '+(r.maxDb|0)+' dB</div></div>'}).join('')+(j.finds.length?'<div class=meta style="color:var(--good)">★ saved '+j.finds.length+' real find(s)</div>':'');refresh()}catch(e){$('#scanRes').innerHTML='<div class=out style="color:var(--bad)">'+e.message+'</div>'}btn.disabled=false;btn.textContent=old};
function ing(dry){return async function(){var btn=this;btn.disabled=true;$('#ingRes').textContent='Converting…';try{var j=await api('/api/ingest',{src:$('#iSrc').value,klass:$('#iClass').value,note:$('#iNote').value,dry:dry});$('#ingRes').textContent=j.output||'(no output)'}catch(e){$('#ingRes').textContent=e.message}btn.disabled=false}}
$('#ingBtn').onclick=ing(false);$('#ingDry').onclick=ing(true);
$('#retrainBtn').onclick=async function(){var btn=this;btn.disabled=true;var old=btn.textContent;btn.textContent='⟳ Retraining…';$('#retrainRes').classList.remove('hidden');$('#retrainRes').textContent='Running scripts/retrain.ps1 — a few minutes…';try{var j=await api('/api/retrain',{});$('#retrainRes').textContent=j.output}catch(e){$('#retrainRes').textContent=e.message}btn.disabled=false;btn.textContent=old};
refresh();setInterval(refresh,5000);
</script></body></html>`;
