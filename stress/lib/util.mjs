/**
 * util.mjs -- shared helpers for the stress harness: arg parsing, statistics,
 * formatting, and terminal tables. No dependencies (Node built-ins only).
 */

/** Minimal argv parser: `cmd --flag value --bool --repeat a --repeat b`. */
export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out.flags[key] = true; // boolean flag
      } else {
        // repeated flags accumulate into an array
        if (key in out.flags) {
          out.flags[key] = [].concat(out.flags[key], next);
        } else {
          out.flags[key] = next;
        }
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** p in [0,100]; arr must be sorted ascending. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** Latency/value summary from an unsorted numeric array. */
export function summarize(values) {
  if (values.length === 0) {
    return { count: 0, min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0, stdev: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mean = sum / sorted.length;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / sorted.length;
  return {
    count: sorted.length,
    min: sorted[0],
    mean,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    stdev: Math.sqrt(variance),
  };
}

/** Ordinary least-squares slope + Pearson r of ys over xs. */
export function linreg(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r: 0 };
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const r = sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
  return { slope, intercept: my - slope * mx, r };
}

// ---- formatting ----
export const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms.toFixed(2) + 'ms');
export const fmtPct = (x) => (x * 100).toFixed(1) + '%';
export function fmtBytes(b) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(i === 0 ? 0 : 1) + u[i];
}

/** Filesystem-safe timestamp, e.g. 2026-06-29_141233. */
export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

// ---- terminal output (ANSI) ----
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  teal: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', gray: '\x1b[90m',
};
export const color = C;
export const paint = (s, c) => `${C[c] || ''}${s}${C.reset}`;

/** Render an aligned table of rows (array of arrays of strings). */
export function termTable(headers, rows) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => stripAnsi(String(r[i] ?? '')).length)));
  const line = (r) =>
    '  ' + r.map((c, i) => padAnsi(String(c ?? ''), widths[i])).join('  ');
  const sep = '  ' + widths.map((w) => '─'.repeat(w)).join('  ');
  return [paint(line(headers), 'bold'), paint(sep, 'gray'), ...rows.map(line)].join('\n');
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
function padAnsi(s, w) {
  const visible = stripAnsi(s).length;
  return s + ' '.repeat(Math.max(0, w - visible));
}
