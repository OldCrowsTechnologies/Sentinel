/**
 * loud_filter.mjs -- keep only the LOUD (energy-dominated) windows of a recording
 * and write them out as a new WAV. For the Blue Angels corpus this drops the quiet
 * crowd/wind stretches so "Manned fixed-wing" trains on JETS only -- removing the
 * pollution that pulled real fixed-wing UAS toward Manned-fixed-wing/None.
 *
 *   node --experimental-strip-types tools/loud_filter.mjs <in.wav> <out.wav> [pct]
 *   pct = keep windows at/above this RMS percentile (default 50 = loudest half)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as synth from '../stress/lib/synth.mjs';

const [inPath, outPath, pctArg] = process.argv.slice(2);
if (!inPath || !outPath) { console.error('usage: loud_filter.mjs <in.wav> <out.wav> [pct]'); process.exit(2); }
const pct = Number(pctArg ?? 50);
const SR = 16000, WIN = SR * 2; // 2s windows == trainer CLIP_SEC

const { samples, sampleRate } = synth.decodeWav(readFileSync(inPath));
if (sampleRate !== SR) { console.error(`expected ${SR} Hz, got ${sampleRate}`); process.exit(1); }

const wins = [];
for (let s = 0; s + WIN <= samples.length; s += WIN) {
  const w = samples.subarray(s, s + WIN);
  let sq = 0; for (let i = 0; i < w.length; i++) sq += w[i] * w[i];
  wins.push({ s, rms: Math.sqrt(sq / w.length) });
}
const sorted = [...wins].map((w) => w.rms).sort((a, b) => a - b);
const thr = sorted[Math.floor((pct / 100) * sorted.length)] ?? 0;
const kept = wins.filter((w) => w.rms >= thr);

const out = new Float32Array(kept.length * WIN);
kept.forEach((w, k) => out.set(samples.subarray(w.s, w.s + WIN), k * WIN));

// minimal 16-bit PCM mono WAV writer
const n = out.length, buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, out[i])); buf.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), 44 + i * 2); }
writeFileSync(outPath, buf);

console.log(`${inPath}: ${wins.length} windows -> kept ${kept.length} at >=P${pct} (rms>=${thr.toFixed(4)}) -> ${outPath} (${(n / SR / 60).toFixed(1)} min)`);
