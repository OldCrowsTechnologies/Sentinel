/**
 * audio_ingest.mjs -- turn phone/camera clips into trainer-ready audio.
 *
 * Converts any audio OR video file (m4a/wav/mp3/aac/mov/mp4/…) to the trainer's
 * canonical format -- 16 kHz mono WAV -- and drops it into the right class folder
 * under data/recordings/<Class>/. Because it pulls the audio track out of VIDEO
 * too, every clip you film doubles as an acoustic training sample.
 *
 * Needs ffmpeg on PATH (present: ffmpeg 8.x).
 *
 * Usage:
 *   node tools/audio_ingest.mjs <src file|dir> "<Class>" [--note "…"] [--dry]
 *
 *   <src>    a single file, or a directory (recursed for known extensions)
 *   <Class>  destination class folder, exactly as under data/recordings/, e.g.
 *            "Fixed-wing UAS", "Small multirotor", "DJI Mini 4 Pro", "None", "Unknown"
 *            (warns if it's not an existing class folder — typo guard)
 *
 * Options:
 *   --note "…"  appended to the output filename (kebab-cased) for your own tracking
 *   --dry       print what it WOULD do, convert nothing
 *
 * Output name: <origstem>[_<note>]_<NN>.wav  (never overwrites)
 * Example:
 *   node tools/audio_ingest.mjs "C:/Users/joshu/Downloads/field" "Fixed-wing UAS" --note "elrs-plane-30m"
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const AUDIO_EXT = new Set(['.m4a', '.wav', '.mp3', '.aac', '.flac', '.ogg', '.opus', '.wma']);
const VIDEO_EXT = new Set(['.mov', '.mp4', '.m4v', '.avi', '.mkv', '.webm', '.3gp']);
const KNOWN = new Set([...AUDIO_EXT, ...VIDEO_EXT]);

const RECDIR = path.join('data', 'recordings');

// ---- args ----------------------------------------------------------------
const argv = process.argv.slice(2);
const pos = [];
let note = '', dry = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--note') note = argv[++i] ?? '';
  else if (argv[i] === '--dry') dry = true;
  else pos.push(argv[i]);
}
const [src, klass] = pos;
if (!src || !klass) {
  console.error('usage: audio_ingest.mjs <src file|dir> "<Class>" [--note "…"] [--dry]');
  process.exit(2);
}
if (!fs.existsSync(src)) {
  console.error(`source not found: ${src}`);
  process.exit(2);
}

// ffmpeg present?
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('ffmpeg not found on PATH. Install ffmpeg, then re-run.');
  process.exit(1);
}

// class folder typo-guard: warn (don't block) if it's not an existing class
const existingClasses = fs.existsSync(RECDIR)
  ? fs.readdirSync(RECDIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];
if (!existingClasses.includes(klass)) {
  console.warn(`⚠ "${klass}" is not an existing class folder under ${RECDIR}/.`);
  console.warn(`  existing: ${existingClasses.join(', ') || '(none)'}`);
  console.warn(`  proceeding (a new folder will be created) — Ctrl-C if that's a typo.\n`);
}
const destDir = path.join(RECDIR, klass);

// ---- collect sources -----------------------------------------------------
function collect(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) return fs.readdirSync(p).flatMap((f) => collect(path.join(p, f)));
  return KNOWN.has(path.extname(p).toLowerCase()) ? [p] : [];
}
const files = collect(src);
if (files.length === 0) {
  console.error(`no audio/video files (${[...KNOWN].join(' ')}) under ${src}`);
  process.exit(1);
}

const noteSlug = note ? '_' + note.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '';
function outName(srcFile) {
  const stem = path.basename(srcFile, path.extname(srcFile)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let n = 0, name;
  do {
    n++;
    name = `${stem}${noteSlug}_${String(n).padStart(2, '0')}.wav`;
  } while (fs.existsSync(path.join(destDir, name)));
  return name;
}

console.log(`\ningest ${files.length} file(s) -> ${destDir}/  (16 kHz mono WAV)${dry ? '  [DRY RUN]' : ''}\n`);
if (!dry) fs.mkdirSync(destDir, { recursive: true });

let ok = 0, fail = 0;
for (const f of files) {
  const isVideo = VIDEO_EXT.has(path.extname(f).toLowerCase());
  const out = path.join(destDir, outName(f));
  if (dry) {
    console.log(`  ${isVideo ? '🎬' : '🎧'} ${path.basename(f)} -> ${path.basename(out)}`);
    continue;
  }
  try {
    // -vn drop video, -ac 1 mono, -ar 16000, PCM s16 WAV
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', f, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out], { stdio: ['ignore', 'ignore', 'inherit'] });
    const secs = fs.statSync(out).size / (16000 * 2);
    console.log(`  ✓ ${isVideo ? '🎬' : '🎧'} ${path.basename(f)} -> ${path.basename(out)}  (${secs.toFixed(1)}s)`);
    ok++;
  } catch (e) {
    console.log(`  ✗ ${path.basename(f)}: ${e.message.split('\n')[0]}`);
    fail++;
  }
}
if (!dry) console.log(`\n${ok} converted, ${fail} failed -> ${destDir}/\nretrain when ready:  scripts/retrain.ps1\n`);
