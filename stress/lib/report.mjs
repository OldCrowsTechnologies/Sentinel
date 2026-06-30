/**
 * report.mjs -- renders a stress-run result object into a single self-contained
 * HTML file (no external assets, no JS dependencies). Styled to match the Corvus
 * Sentinel tactical theme so reports look at home next to the app.
 */

const T = {
  bg: '#080D16', bgMid: '#0A1020', panel: '#0E1A2B', panelAlt: '#0A1626',
  border: '#1B2C44', divider: '#15263D', teal: '#00C2C7', gold: '#C9A23A',
  ink: '#EAF2F8', muted: '#7E8C9E', faint: '#46586E',
  ok: '#2ECC71', warn: '#F5A623', bad: '#FF4D52', info: '#00C2C7',
};
const statusColor = (s) => T[s] || T.muted;

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function card(c) {
  const col = statusColor(c.status);
  return `<div class="card" style="border-top:3px solid ${col}">
    <div class="card-label">${esc(c.label)}</div>
    <div class="card-value" style="color:${col}">${esc(c.value)}</div>
    ${c.sub ? `<div class="card-sub">${esc(c.sub)}</div>` : ''}
  </div>`;
}

function tableSection(s) {
  const head = s.headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = s.rows
    .map((r, i) => {
      const st = s.rowStatus && s.rowStatus[i];
      const tint = st ? ` style="color:${statusColor(st)}"` : '';
      return `<tr>${r.map((c) => `<td${tint}>${esc(c)}</td>`).join('')}</tr>`;
    })
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function barsSection(s) {
  const max = s.items.reduce((m, it) => Math.max(m, it.max ?? it.value), 0) || 1;
  return `<div class="bars">${s.items
    .map((it) => {
      const pct = Math.max(1, Math.min(100, ((it.value / max) * 100) || 0));
      const col = statusColor(it.status || 'info');
      const label = `${esc(it.label)}${s.unit ? '' : ''}`;
      const val = it.display ?? `${it.value}${s.unit ? ' ' + s.unit : ''}`;
      return `<div class="bar-row">
        <div class="bar-label">${label}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${col}"></div></div>
        <div class="bar-val">${esc(val)}</div>
      </div>`;
    })
    .join('')}</div>`;
}

function timeseriesSection(s) {
  const W = 860, H = 240, padL = 64, padR = 16, padT = 16, padB = 36;
  const allX = s.series.flatMap((se) => se.points.map((p) => p[0]));
  const allY = s.series.flatMap((se) => se.points.map((p) => p[1]));
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minY = Math.min(0, ...allY), maxY = Math.max(...allY) || 1;
  const sx = (x) => padL + ((x - minX) / (maxX - minX || 1)) * (W - padL - padR);
  const sy = (y) => H - padB - ((y - minY) / (maxY - minY || 1)) * (H - padT - padB);
  const yfmt = s.yfmt || ((v) => String(Math.round(v)));
  const gridY = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = minY + f * (maxY - minY);
    const yy = sy(v);
    return `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${T.divider}" stroke-width="1"/>
      <text x="${padL - 8}" y="${yy + 4}" fill="${T.muted}" font-size="11" text-anchor="end">${esc(yfmt(v))}</text>`;
  }).join('');
  const lines = s.series.map((se) => {
    const d = se.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${se.color || T.teal}" stroke-width="2"/>`;
  }).join('');
  const legend = s.series
    .map((se) => `<span class="lg"><i style="background:${se.color || T.teal}"></i>${esc(se.name)}</span>`)
    .join('');
  return `<div class="ts-legend">${legend}</div>
    <svg viewBox="0 0 ${W} ${H}" class="ts" preserveAspectRatio="xMidYMid meet">
      ${gridY}${lines}
      <text x="${(W) / 2}" y="${H - 6}" fill="${T.muted}" font-size="11" text-anchor="middle">${esc(s.xlabel || '')}</text>
    </svg>`;
}

function section(s) {
  let inner = '';
  if (s.type === 'table') inner = tableSection(s);
  else if (s.type === 'bars') inner = barsSection(s);
  else if (s.type === 'timeseries') inner = timeseriesSection(s);
  return `<section class="panel">
    <h2>${esc(s.title)}</h2>
    ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
    ${inner}
  </section>`;
}

export function renderReport(r) {
  const verdictColor = r.verdict.pass ? T.ok : T.bad;
  const meta = (r.meta || []).map((m) => `<span><b>${esc(m.k)}</b> ${esc(m.v)}</span>`).join('');
  const notes = (r.verdict.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.title)} — Corvus stress report</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:linear-gradient(180deg,#11203A,${T.bgMid} 40%,${T.bg});
    color:${T.ink};font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;
    -webkit-font-smoothing:antialiased;padding:28px;line-height:1.5}
  .wrap{max-width:920px;margin:0 auto}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;
    border-bottom:1px solid ${T.border};padding-bottom:18px;margin-bottom:22px}
  h1{font-size:20px;margin:0 0 6px;letter-spacing:.04em}
  .sub{color:${T.muted};font-size:12px}
  .meta{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:12px;color:${T.muted}}
  .meta b{color:${T.ink};font-weight:500}
  .verdict{flex:none;text-align:right}
  .badge{display:inline-block;padding:8px 16px;border-radius:22px;font-weight:700;
    font-size:14px;letter-spacing:.06em;background:${verdictColor}22;color:${verdictColor};
    border:1px solid ${verdictColor}66}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px}
  .card{background:${T.panel};border:1px solid ${T.border};border-radius:11px;padding:14px}
  .card-label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:${T.muted}}
  .card-value{font-size:24px;font-weight:700;margin-top:6px}
  .card-sub{font-size:11px;color:${T.faint};margin-top:4px}
  .panel{background:${T.panel};border:1px solid ${T.border};border-radius:14px;padding:18px 20px;margin-bottom:18px}
  h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:${T.teal};margin:0 0 14px}
  .note{color:${T.muted};font-size:12px;margin:-6px 0 14px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid ${T.divider}}
  th{color:${T.muted};font-weight:500;font-size:11px;letter-spacing:.06em;text-transform:uppercase}
  td{font-variant-numeric:tabular-nums}
  .bars{display:flex;flex-direction:column;gap:9px}
  .bar-row{display:grid;grid-template-columns:170px 1fr 92px;align-items:center;gap:12px;font-size:12px}
  .bar-label{color:${T.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar-track{background:${T.panelAlt};border-radius:6px;height:16px;overflow:hidden;border:1px solid ${T.divider}}
  .bar-fill{height:100%;border-radius:6px}
  .bar-val{text-align:right;color:${T.muted};font-variant-numeric:tabular-nums}
  .ts{width:100%;height:auto;background:${T.panelAlt};border-radius:8px;border:1px solid ${T.divider}}
  .ts-legend{display:flex;gap:18px;margin-bottom:10px;font-size:12px;color:${T.muted}}
  .lg i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}
  footer{color:${T.faint};font-size:11px;text-align:center;margin-top:24px}
  ul{margin:10px 0 0;padding-left:18px;color:${T.muted};font-size:12px}
</style></head><body><div class="wrap">
  <header>
    <div>
      <h1>⛨ ${esc(r.title)}</h1>
      <div class="sub">${esc(r.startedAt)} · ran ${(r.durationMs / 1000).toFixed(1)}s</div>
      <div class="meta">${meta}</div>
    </div>
    <div class="verdict">
      <div class="badge">${r.verdict.pass ? 'PASS' : 'ATTENTION'}</div>
      ${notes ? `<ul>${notes}</ul>` : ''}
    </div>
  </header>
  <div class="cards">${(r.cards || []).map(card).join('')}</div>
  ${(r.sections || []).map(section).join('')}
  <footer>Corvus Sentinel stress harness · ${esc(r.command)} · generated ${esc(r.startedAt)}</footer>
</div></body></html>`;
}
