/**
 * load.mjs -- HTTP/HTTPS load test for the OCWS site or any endpoint/proxy route.
 *
 * Spins up N concurrent virtual users that hammer a URL for a fixed duration (or
 * a fixed request count), reusing keep-alive connections. Reports throughput,
 * success rate, latency percentiles, a status-code histogram, and a per-second
 * latency timeline. Pure Node built-ins -- no k6/Artillery install required.
 *
 *   npm run stress -- load --url https://oldcrowswireless.com --concurrency 20 --duration 15
 */
import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { summarize, fmtMs, fmtPct, num } from '../lib/util.mjs';

function requestOnce(url, opts, agents) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const t0 = performance.now();
    const req = lib.request(
      u,
      {
        method: opts.method,
        headers: opts.headers,
        agent: isHttps ? agents.https : agents.http,
        timeout: opts.timeout,
      },
      (res) => {
        let bytes = 0;
        res.on('data', (c) => { bytes += c.length; });
        res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode, ms: performance.now() - t0, bytes }));
      }
    );
    req.on('error', (e) => resolve({ ok: false, status: 0, ms: performance.now() - t0, error: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, ms: performance.now() - t0, error: 'TIMEOUT' }); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

export async function run(flags) {
  const url = flags.url;
  if (!url) throw new Error('load: --url <url> is required');
  const concurrency = Math.max(1, num(flags.concurrency, 10));
  const durationS = num(flags.duration, flags.requests ? Infinity : 10);
  const maxReq = flags.requests ? num(flags.requests, Infinity) : Infinity;
  const method = (flags.method || 'GET').toUpperCase();
  const timeout = num(flags.timeout, 10000);
  const headers = {};
  for (const h of [].concat(flags.header || [])) {
    const idx = String(h).indexOf(':');
    if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
  }
  const body = flags.body || null;
  if (body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const agents = {
    http: new http.Agent({ keepAlive: true, maxSockets: concurrency }),
    https: new https.Agent({ keepAlive: true, maxSockets: concurrency }),
  };
  const opts = { method, headers, timeout, body };

  const results = [];
  const timeline = []; // [{t, ms, ok}]
  const start = performance.now();
  const deadline = start + durationS * 1000;
  let issued = 0;
  let stop = false;

  async function worker() {
    while (!stop) {
      if (issued >= maxReq) break;
      if (performance.now() >= deadline) break;
      issued++;
      const r = await requestOnce(url, opts, agents);
      results.push(r);
      timeline.push({ t: (performance.now() - start) / 1000, ms: r.ms, ok: r.ok });
    }
  }

  process.stdout.write(`  load: ${concurrency} VUs → ${method} ${url} ${Number.isFinite(durationS) ? `for ${durationS}s` : `× ${maxReq}`}\n`);
  const workers = Array.from({ length: concurrency }, () => worker());
  // safety stop slightly past deadline
  const guard = setTimeout(() => { stop = true; }, (Number.isFinite(durationS) ? durationS * 1000 : 600000) + 2000);
  await Promise.all(workers);
  clearTimeout(guard);
  agents.http.destroy();
  agents.https.destroy();

  const elapsed = (performance.now() - start) / 1000;
  const lat = results.map((r) => r.ms);
  const s = summarize(lat);
  const okCount = results.filter((r) => r.ok).length;
  const successRate = results.length ? okCount / results.length : 0;
  const rps = results.length / elapsed;

  // status histogram
  const hist = new Map();
  for (const r of results) {
    const key = r.status === 0 ? (r.error || 'ERROR') : String(r.status);
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const histItems = [...hist.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({
      label: k,
      value: v,
      display: `${v} (${fmtPct(v / results.length)})`,
      status: k.startsWith('2') ? 'ok' : k.startsWith('3') ? 'info' : 'bad',
    }));

  // per-second latency timeline (avg ms + p95)
  const buckets = new Map();
  for (const e of timeline) {
    const sec = Math.floor(e.t);
    if (!buckets.has(sec)) buckets.set(sec, []);
    buckets.get(sec).push(e.ms);
  }
  const secs = [...buckets.keys()].sort((a, b) => a - b);
  const avgPts = secs.map((sec) => [sec, buckets.get(sec).reduce((a, b) => a + b, 0) / buckets.get(sec).length]);
  const p95Pts = secs.map((sec) => [sec, summarize(buckets.get(sec)).p95]);
  const rpsPts = secs.map((sec) => [sec, buckets.get(sec).length]);

  const pass = successRate >= 0.99 && results.length > 0;
  const cards = [
    { label: 'Requests', value: String(results.length), status: 'info', sub: `${elapsed.toFixed(1)}s · ${concurrency} VUs` },
    { label: 'Throughput', value: `${rps.toFixed(1)}/s`, status: 'info', sub: 'requests per second' },
    { label: 'Success rate', value: fmtPct(successRate), status: successRate >= 0.99 ? 'ok' : successRate >= 0.95 ? 'warn' : 'bad', sub: `${results.length - okCount} failed` },
    { label: 'p95 latency', value: fmtMs(s.p95), status: s.p95 < 300 ? 'ok' : s.p95 < 1000 ? 'warn' : 'bad', sub: `p50 ${fmtMs(s.p50)} · max ${fmtMs(s.max)}` },
  ];

  const sections = [
    {
      type: 'bars', title: 'Status codes', items: histItems,
    },
    {
      type: 'bars', title: 'Latency percentiles', unit: 'ms',
      items: ['p50', 'p90', 'p95', 'p99', 'max'].map((k) => ({
        label: k, value: +s[k].toFixed(1), display: fmtMs(s[k]),
        status: k === 'max' || k === 'p99' ? 'warn' : 'ok',
      })),
    },
  ];
  if (avgPts.length > 1) {
    sections.push({
      type: 'timeseries', title: 'Latency over time', xlabel: 'seconds', yfmt: (v) => v.toFixed(0) + 'ms',
      series: [
        { name: 'avg ms', color: '#00C2C7', points: avgPts },
        { name: 'p95 ms', color: '#F5A623', points: p95Pts },
      ],
    });
    sections.push({
      type: 'timeseries', title: 'Requests per second', xlabel: 'seconds', yfmt: (v) => v.toFixed(0),
      series: [{ name: 'req/s', color: '#2ECC71', points: rpsPts }],
    });
  }

  const notes = [];
  if (!pass) notes.push(`${results.length - okCount} non-2xx/3xx or errored responses`);
  else notes.push(`${fmtPct(successRate)} success · ${rps.toFixed(0)} req/s · ${fmtMs(s.p95)} p95`);

  return {
    command: 'load',
    title: 'Web / API load test',
    cards,
    sections,
    meta: [
      { k: 'target', v: url },
      { k: 'method', v: method },
      { k: 'VUs', v: String(concurrency) },
      { k: 'mode', v: Number.isFinite(durationS) ? `${durationS}s` : `${maxReq} req` },
    ],
    verdict: { pass, label: pass ? 'PASS' : 'ATTENTION', notes },
    _terminal: {
      headline: `${results.length} req · ${rps.toFixed(1)}/s · ${fmtPct(successRate)} ok · p95 ${fmtMs(s.p95)}`,
      headers: ['status', 'count', 'share'],
      rows: histItems.map((h) => [h.label, String(h.value), fmtPct(h.value / results.length)]),
      rowStatus: histItems.map((h) => h.status),
    },
  };
}
