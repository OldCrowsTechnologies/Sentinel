# Corvus stress harness

A reusable, zero-dependency stress-test tool for OCWS apps. One CLI, three modes,
and every run writes a self-contained HTML report you can open, save, or share.

```bash
npm run stress -- <detect|load|soak> [options]
```

Each run prints a terminal summary, writes `stress/reports/<cmd>-<timestamp>.html`,
and exits non-zero when the verdict is **ATTENTION** (handy for CI gating).

---

## `detect` — detection robustness (Corvus)

Drives the **real** classifier (`lib/mlClassifier.ts`, the bundled model) with a
battery of synthetic and adversarial audio windows and measures what matters in
the field:

- **False-positive rate** on non-drone audio — silence, white/pink noise, two
  synthetic voices, a crowded-bar babble, a frequency sweep. Anything that
  "DETECTS" here is a false alarm. This is the metric the voice/crowd-rejection
  work is judged against.
- **Latency** distribution (p50/p95/p99/max) — the on-device per-window budget.
- **Robustness** — empty / sub-window / NaN / Inf / clipping / DC-offset /
  huge-amplitude inputs must never throw or return a non-finite confidence.
- **Determinism** — same window in ⇒ identical verdict out.

```bash
npm run stress -- detect                       # default: 100 iters/scenario
npm run stress -- detect --iterations 500
npm run stress -- detect --model assets/models/corvus-model.json
npm run stress -- detect --wav-dir data/recordings   # also test real WAVs
```

**`--wav-dir`**: each immediate subfolder is a class label. Folders named
`none / silence / noise / voice / crowd / ambient / speech / bar` are treated as
"should NOT detect"; any other folder name as "should detect". Files must be mono
or stereo 16-bit PCM WAV at the model's sample rate (16 kHz).

## `load` — web / API load test

Concurrent virtual users hammering any URL (the OCWS site, a proxy route, an
API). Keep-alive connections, latency percentiles, status histogram, and
per-second timelines. No k6/Artillery install needed.

```bash
npm run stress -- load --url https://oldcrowswireless.com --concurrency 20 --duration 15
npm run stress -- load --url https://api.example.com/health --requests 1000 --concurrency 50
npm run stress -- load --url https://api.example.com/x --method POST \
    --header "Authorization: Bearer …" --body '{"q":1}'
```

Verdict passes at ≥99% success. (Be considerate about what you point this at —
only load-test infrastructure you own.)

## `soak` — runtime endurance / leak test

Runs a workload in a tight loop for N minutes, sampling heap/RSS/CPU, then fits a
line to heap-over-time to flag a probable leak (sustained >1 MB/min growth with
high correlation). Default workload is the real classifier hot path, so it
exercises the same per-window DSP→FFT→MLP allocations the live app makes.

```bash
npm run stress:soak -- --minutes 5            # uses --expose-gc for a clean signal
npm run stress -- soak --minutes 2 --workload noop
```

`npm run stress:soak` adds `--expose-gc` so each sample is taken after a forced
GC — strongly recommended for a trustworthy heap slope.

---

## Global options

| flag | meaning |
|------|---------|
| `--report <path>` | write the HTML report to a specific path |
| `--no-report` | skip the HTML report |
| `--help` | usage |
| `--debug` | print stack traces on failure |

## How it works / extending it

- **No new dependencies** — Node built-ins only (`http`, `perf_hooks`, `fs`).
- `lib/ts-resolver.mjs` lets Node import the app's extensionless `.ts` modules so
  `detect`/`soak` run the *real* detection code, not a copy.
- Add a mode by dropping `scenarios/<name>.mjs` that exports
  `async run(flags) → result` and registering it in `index.mjs`. The result shape
  (cards / sections / verdict) drives both the terminal output and the HTML
  report automatically — see an existing scenario for the contract.
- New synthetic signals go in `lib/synth.mjs`; report widgets (`table`, `bars`,
  `timeseries`) live in `lib/report.mjs`.

Reports under `stress/reports/` are git-ignored (local artifacts).
