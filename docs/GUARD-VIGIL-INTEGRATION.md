# GUARD / Vigil integration — findings + plan

External work we got permission to use (UWF, Pensacola). Source of truth for what
we took, what's deferred, and the honest result of a first integration pass.

**Sources**
- Code/model: `github.com/mpb63UWF/Vigil` — "GUARD" drone audio detection. No license file,
  but the **owner has granted permission to use it (incl. commercially) and stated no written
  terms are needed** (confirmed to Josh, 2026-07). Keep this note as the record of that grant.
- Data: HuggingFace `geronimobasso/drone-audio-detection-samples` — **MIT licensed** (commercial
  OK w/ attribution). 180,320 clips, binary `label` (0 = background/no-drone ~9 s clips,
  1 = drone ~0.5 s segments), 16 kHz, 6.81 GB.

---

## What GUARD is (not a dataset — a system)
A **mel-spectrogram CNN** (binary drone/no-drone, `DroneDetectorCNN`, 5.8 MB) + **acoustic
direction-finding (DOA)** via a **mic array** (ReSpeaker XVF3800 6-ch or miniDSP UMA-8) using
SRP-PHAT / GCC-PHAT, + GPS geo-tagging + LoRa forwarding. Trained on the HF dataset above.

## What transfers, and where
| Piece | Fit | Status |
|---|---|---|
| **DOA / bearing (mic array)** | **Sensor node** (needs a mic array — phones can't) | **Biggest win** — closes Sentinel's "no direction finding" gap AND feeds Shots-Fired TDOA. Deferred to the external sensor node. |
| **CNN detector** | Sensor node / edge (PyTorch, binary) | Runs on a laptop/Pi, not our pure-TS phone runtime. Candidate for the edge node, or as a distillation teacher. |
| **Noise front-end** (`AudioPP.py`: spectral subtraction + HPSS harmonic keep + 80–4000 bandpass) | Phone (concept portable) | HPSS is heavy/stateful; the *idea* (suppress wind/transients, keep steady motor tones) is a future FP tool. Not yet ported. |
| **HF dataset** | Phone model retrain | See experiment below — needs careful integration. |

---

## Experiment: naive HF-data integration into the phone model (DID NOT SHIP)

Pulled a balanced subset (2500 background + 1800 drone), mapped **label 0 → `None`**,
**label 1 → `Unknown`** (0.5 s drone clips tiled to our 2 s window), retrained, held-out eval.

**Result — it destabilized the tuned 17-class model:**
- HF held-out drone detection **100%** ✓, our negatives still **0% brand FP** ✓, T3i recovered ✓.
- **BUT Fritz fixed-wing detection regressed 100% → 17–33%** (false negatives on quieter real
  drones), and it's a hard **precision/recall wall**: more `None` data → fewer FPs but misses
  real drones; less → detects drones but unseen-background FP jumps to ~35%.

**Decision:** kept **build-11** (the shipped, balanced model) in production. A binary,
multirotor-heavy, 0.5 s-window generic-drone dataset can't be dumped into our 2 s multi-class
open-set model without regressing the classes we tuned. **Not a tuning miss — a modeling one.**

**Proper integration path (do next, unrushed):**
1. **Class-weighted / balanced training** (`class_weight='balanced'` or resampling) so the huge
   `None` pool can't dominate — the missing lever here.
2. **Keep the HF drone as a droneness-gate signal**, not a blanket `Unknown` flood — e.g. a
   separate binary "is-it-a-drone" head, or weight it so typed classes keep their share.
3. **Held-out-driven tuning** against our *real* clips (Fritz, T3i) as the gate, not just the
   HF holdout (which is loud/clean and over-optimistic).
4. Re-evaluate the **80–4000 Hz band** tightening *separately* (it hurt fixed-wing >4 kHz
   harmonics here; only revisit with proper A/B).

Reproduce the subset: `training/pull_hf_dataset.py` (streams `None`, pulls drone from a late
parquet shard; no torch needed). Staged locally under `data/staged-hf/` (gitignored — re-pullable).

---

## Attribution
- Dataset: geronimobasso, *drone-audio-detection-samples* (MIT) — attribute in product credits.
- GUARD/Vigil (UWF): permission-based; confirm written terms + commercial rights before shipping.
