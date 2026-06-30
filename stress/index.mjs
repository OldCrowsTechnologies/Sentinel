/**
 * index.mjs -- entry point for the Corvus stress harness.
 *
 *   npm run stress -- <detect|load|soak> [options]
 *
 * Registers a resolver so the REAL TypeScript library imports cleanly under
 * Node, runs the chosen scenario, prints a terminal summary, and writes a
 * self-contained HTML report to stress/reports/. See stress/README.md.
 */
import { register } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs, stamp, termTable, paint, color } from './lib/util.mjs';
import { renderReport } from './lib/report.mjs';

// Make extensionless TS imports (lib/*.ts) resolve under Node.
register('./lib/ts-resolver.mjs', import.meta.url);

const HELP = `
${paint('Corvus Sentinel — stress harness', 'teal')}

Usage:
  npm run stress -- <command> [options]
  node --experimental-strip-types stress/index.mjs <command> [options]

Commands:
  ${paint('detect', 'bold')}   Detection robustness: false-positive rate, latency, adversarial input.
            --model <path>      model JSON (default assets/models/corvus-model.json)
            --iterations <n>    classifications per scenario (default 100)
            --wav-dir <dir>     also test real recordings (subfolders = class labels)

  ${paint('load', 'bold')}     HTTP/API load test against a URL.
            --url <url>         target (required)
            --concurrency <n>   virtual users (default 10)
            --duration <s>      seconds to run (default 10)
            --requests <n>      OR fixed request count
            --method <m>        HTTP method (default GET)
            --header "K: V"     add a header (repeatable)
            --body <str>        request body
            --timeout <ms>      per-request timeout (default 10000)

  ${paint('soak', 'bold')}     Runtime endurance / memory-leak test.
            --minutes <m>       run time (default 2)
            --workload <w>      detect | noop (default detect)
            --sample-ms <ms>    sampling interval (default 1000)
            (run via: node --expose-gc ... for a cleaner heap signal)

Global:
  --report <path>   write HTML report here (default stress/reports/<cmd>-<ts>.html)
  --no-report       skip the HTML report
  --help            this message
`;

const SCENARIOS = { detect: './scenarios/detect.mjs', load: './scenarios/load.mjs', soak: './scenarios/soak.mjs' };

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0];

  if (flags.help || !cmd) {
    console.log(HELP);
    process.exit(cmd ? 0 : 1);
  }
  if (!SCENARIOS[cmd]) {
    console.error(paint(`Unknown command: ${cmd}`, 'red'));
    console.log(HELP);
    process.exit(1);
  }

  const t0 = performance.now();
  const startedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const { run } = await import(SCENARIOS[cmd]);

  let result;
  try {
    result = await run(flags);
  } catch (e) {
    console.error(paint(`\n✗ ${cmd} failed: `, 'red') + (e.message || e));
    if (flags.debug) console.error(e.stack);
    process.exit(1);
  }
  result.durationMs = performance.now() - t0;
  result.startedAt = startedAt;

  // ---- terminal summary ----
  const v = result.verdict;
  const badge = v.pass ? paint(' PASS ', 'green') : paint(' ATTENTION ', 'yellow');
  console.log(`\n${paint('▌', 'teal')} ${paint(result.title, 'bold')}  ${badge}`);
  if (result._terminal?.headline) console.log('  ' + paint(result._terminal.headline, 'gray'));
  console.log();
  if (result._terminal?.rows?.length) {
    const t = result._terminal;
    const painted = t.rows.map((r, i) => {
      const st = t.rowStatus?.[i];
      const c = st === 'bad' ? 'red' : st === 'warn' ? 'yellow' : st === 'ok' ? 'green' : null;
      return c ? r.map((cell, j) => (j === 0 ? paint(cell, c) : cell)) : r;
    });
    console.log(termTable(t.headers, painted));
    console.log();
  }
  for (const note of v.notes || []) console.log('  ' + paint('• ' + note, v.pass ? 'gray' : 'yellow'));

  // ---- HTML report ----
  if (!flags['no-report']) {
    const dir = join(process.cwd(), 'stress', 'reports');
    mkdirSync(dir, { recursive: true });
    const out = flags.report || join(dir, `${cmd}-${stamp()}.html`);
    writeFileSync(out, renderReport(result), 'utf8');
    console.log('\n  ' + paint('report → ', 'teal') + out.replace(process.cwd() + (process.platform === 'win32' ? '\\' : '/'), ''));
  }
  console.log();
  process.exit(v.pass ? 0 : 2);
}

main();
