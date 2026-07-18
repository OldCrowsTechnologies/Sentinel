/**
 * pull_c2.mjs -- pull ALL detections + positions the org has fed through C2 and
 * summarize them (for an after-action report). Authenticates as COMMAND exactly
 * like the dashboard: anonymous auth -> redeem_seat_code(CMD) -> RLS-scoped read.
 *
 *   node tools/pull_c2.mjs [--code ECSO-BA-CMD] [--out <dir>] [--since <ISO>]
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const URL = process.env.CORVUS_SUPABASE_URL || 'https://llduasjyqprkmpjotgfu.supabase.co';
const ANON = process.env.CORVUS_SUPABASE_ANON || 'sb_publishable_T6jfcmv0R_uhJ1CV3Yj6EA_bplZfB8x';
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const code = flag('code', 'ECSO-BA-CMD');
const outDir = flag('out', '.');
const since = flag('since', null);

const supa = createClient(URL, ANON, { auth: { persistSession: false } });

const { error: authErr } = await supa.auth.signInAnonymously();
if (authErr) { console.error('anon auth failed:', authErr.message); process.exit(1); }
const { data: org, error: rErr } = await supa.rpc('redeem_seat_code', { p_code: code, p_call_sign: 'AAR-pull' });
if (rErr) { console.error('redeem failed:', rErr.message); process.exit(1); }
console.log('org:', org);

// pull everything (paged to be safe)
async function pullAll(table, order = 'ts') {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = supa.from(table).select('*').order(order, { ascending: true }).range(from, from + 999);
    if (since && table === 'detections') q = q.gte('ts', since);
    const { data, error } = await q;
    if (error) { console.error(`${table} error:`, error.message); break; }
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const dets = await pullAll('detections');
const pos = await pullAll('positions');

// ---- summary ----
const by = (rows, k) => rows.reduce((m, r) => (m[r[k] ?? '—'] = (m[r[k] ?? '—'] || 0) + 1, m), {});
const NON_THREAT = new Set(['None', 'Bird', 'Manned rotorcraft', 'Manned fixed-wing']);
const RF_KINDS = new Set(['lora', 'elrs', 'ocusync', 'control-link']);
const threats = dets.filter(d => !NON_THREAT.has(d.label) && !RF_KINDS.has(d.kind));
const rf = dets.filter(d => RF_KINDS.has(d.kind));
const times = dets.map(d => new Date(d.ts).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
const hourHist = dets.reduce((m, d) => { const h = new Date(d.ts).toISOString().slice(0, 13); m[h] = (m[h] || 0) + 1; return m; }, {});
const confs = threats.map(d => d.confidence).filter(Number.isFinite);
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;

const sortDesc = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
console.log('\n=== C2 PULL ===');
console.log('detections:', dets.length, '| positions rows:', pos.length);
if (times.length) console.log('span:', new Date(times[0]).toISOString(), '→', new Date(times.at(-1)).toISOString());
console.log('\nby kind:', JSON.stringify(by(dets, 'kind')));
console.log('by node/user:', JSON.stringify(by(dets, 'node_id')));
console.log('\nthreat call-outs (acoustic, non-RF, non-None):', threats.length);
console.log('  by label:', JSON.stringify(sortDesc(by(threats, 'label'))));
console.log('  confidence mean/max:', mean(confs).toFixed(1) + '%', Math.max(0, ...confs).toFixed(0) + '%',
  '| >=90%:', confs.filter(c => c >= 90).length, '| >=99%:', confs.filter(c => c >= 99).length);
console.log('\nnon-threat call-outs:', dets.filter(d => NON_THREAT.has(d.label)).length,
  JSON.stringify(sortDesc(by(dets.filter(d => NON_THREAT.has(d.label)), 'label'))));
console.log('RF control-link detections:', rf.length, JSON.stringify(by(rf, 'kind')));
console.log('\nper-hour (UTC):');
for (const [h, n] of Object.entries(hourHist).sort()) console.log('  ' + h + '  ' + '#'.repeat(Math.min(60, n)) + ' ' + n);

// ---- dumps for the AAR ----
const cols = ['ts', 'kind', 'label', 'confidence', 'band', 'peak_db', 'range_ft', 'lat', 'lon', 'node_id', 'user_id', 'seq'];
const esc = v => { if (v == null) return ''; const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = cols.join(',') + '\n' + dets.map(d => cols.map(c => esc(d[c])).join(',')).join('\n') + '\n';
writeFileSync(outDir + '/c2_detections.csv', csv);
writeFileSync(outDir + '/c2_dump.json', JSON.stringify({ org, pulledAt: new Date().toISOString(), detections: dets, positions: pos }, null, 2));
console.log('\nwrote', outDir + '/c2_detections.csv', 'and c2_dump.json');
