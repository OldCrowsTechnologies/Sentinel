# Corvus Sentinel — Real-Audio Data Pipeline

**Goal:** move the acoustic model off `corvus_synth.py` (synthetic backstop) and onto
real drone + real-world-noise recordings, so it fires in the field and stops
false-positiving on lawnmowers/wind/voices.

This is the plan for sourcing, cleaning, labeling, and mixing that audio, and for
feeding it into the existing training layout.

---

## 0. What already exists (don't rebuild these)

| Piece | State | Notes |
|---|---|---|
| `training/corvus_features.py` | ✅ present | **Single source of truth** for features. Pure numpy (no librosa). Mirrored by `lib/dsp.ts` on-device — parity is sacred. |
| `training/corvus_synth.py` | ✅ present | Physically-grounded synthetic generator. The current bootstrap brain. |
| `training/verify_parity.py` / `.mjs` | ✅ present | Confirms Python training features == TS inference features. |
| `data/recordings/<Class>/` | ✅ scaffolded, **empty** | Drop-zone folders. Auto-labels by filename keyword. `None/` = negative class. |
| `scripts/retrain.ps1` | ✅ present | Calls `python training/train_corvus.py --data data/recordings --per-class 300`. |
| `training/train_corvus.py` | ✅ **present & complete** | Loads real WAVs (folder/keyword auto-label) + synthetic backfill → standardize → MLP → exports full model JSON with open-set stats. Reads WAV via `scipy.io.wavfile` (WAV only). |
| `assets/models/corvus-model.json` | ✅ present (~172 KB) | The **currently shipped synthetic brain**. Retraining overwrites it. |
| Python 3.12 + numpy/scipy/sklearn | ✅ **installed** | `retrain.ps1` runs as-is today. (Memory note "no Python" was stale.) Only `yt-dlp`+`ffmpeg` still needed, and only for the YouTube path. |

**Reality check:** the pipeline is fully built and a synthetic model already ships. The
*only* missing input is **real audio data**. Everything that turns audio into a model
exists and runs.

### Fixed conventions (from `corvus_features.py` / `recordings/README.md`)
- **16 kHz mono WAV**, any input sample rate (auto-resampled), mono preferred.
- Clip length **2.0 s** (`corvus_synth.CLIP_SEC`).
- Features = 20 log-mel bands (mean + std over frames) + drone-band energy ratios.
- **~400 Hz high-pass** in the feature path — deliberately discards voice fundamentals
  (85–255 Hz). Consequence: sub-400 Hz interferers (deep wind rumble, HVAC) are already
  attenuated, but sub-250 g micro-drones (Potensic Atom 2 blade-pass ~330 Hz) sit near
  that edge — keep their real audio clean.
- **Label set** (from `corvus_synth.DRONE_PROFILES` + `None`):
  `Skydio X2`, `DJI Phantom`, `Parrot Anafi`, `Potensic Atom 2`, `Manned rotorcraft`,
  `Unknown`, `None`.
  ⚠️ On-disk folders currently only cover Skydio X2 / DJI Phantom / Parrot Anafi /
  Unknown / None — **add `Potensic Atom 2/` and `Manned rotorcraft/`** to match the labels.

---

## 1. The strategy (corrected from "scrape then subtract")

Original idea: scrape contamination (music/voice/wind) so we know what "bad" sounds like,
then **subtract** it out of drone videos.

**Correction:** you can't subtract *arbitrary* non-stationary noise (music/speech from
video A) out of a *different* recording (video B) — spectral subtraction only cancels the
noise profile from the *same* recording, or a truly stationary source (steady wind, hum).

**What the contamination corpus is actually worth — two mechanisms:**

1. **Negative-class training.** Everything non-drone → `None/`. The model has never heard
   real junk (only synthetic), so this is where field false-positives get killed.
2. **Augmentation by mixing** *(the strong version of the idea)*. Take clean-ish drone
   clips + the noise corpus and **mix them yourself** at controlled SNR (e.g. 0–20 dB).
   You get unlimited drone+music / drone+wind / drone+traffic clips with perfect labels —
   the model learns the rotor comb *through* contamination. This is robustness done right.

**Rule of thumb:** collect drone clips that are *already* clean, and collect noise
separately; never try to clean a contaminated drone clip — mix noise back in on purpose
instead.

---

## 2. Logical order of operations

The training plumbing is already built and Python is installed, so this is now a
**data-acquisition** effort, not a build effort — and the constraint is **legal, not
technical**. Ordered by what's safe to do *now* vs. what's gated on counsel.

1. **Sanity-run the existing pipeline** — `scripts/retrain.ps1` today (pure synthetic)
   to confirm it trains + exports on this machine, then `npm run parity`. Establishes a
   known-good baseline. *(Safe now.)*
2. **First-party captures** (§5a) — record your own drones + owned negatives via the
   in-app **TrainingCapture** screen → `data/recordings/<Class>/`. Zero license risk.
   *(Safe now — this is the real unlock.)*
3. **Mixing/augmentation** (§1.2) — mix your clean drone captures with your owned-noise
   captures at controlled SNR for robustness. *(Safe now.)*
4. **Counsel review of open datasets** (§3) — get a ruling on DADS/DREGON/etc. before any
   ingest. *(Gated.)*
5. **YouTube** (§5) — last resort, highest risk, **only after counsel** + needs
   `yt-dlp`+`ffmpeg`. *(Gated + discouraged.)*

⚠️ Any non-WAV audio (datasets, scrapes) must be converted to **16 kHz mono WAV** first —
the trainer reads WAV only (`scipy.io.wavfile`).
7. **Retrain → parity → APK.** `retrain.ps1` → `npm run parity` → `build-apk.ps1`.

---

## 3. Open datasets — ⛔ ON LEGAL HOLD (do NOT ingest yet)

**Reconciled with prior work:** the 2026-06-25 deep-research pass (105-agent `/loop`)
already evaluated these and found **every open dataset carries a license cloud** that is
disqualifying for a **commercial** OCWS product. Standing directive from Josh:
*"do whatever is 100% safe"* → **hold all open datasets until counsel clears them.**

| Dataset | Content | Why it's held |
|---|---|---|
| **DroneAudioDataset (DADS)** | Propeller noise + augmented | MIT tag, but **aggregates CC-BY-NC Freesound clips** → non-commercial contamination. |
| **DREGON** — Inria | UAV 8-mic array, real rotors | **Non-commercial** license. |
| **DroneAudioset** — arXiv 2510.15383 | Large SAR drone audio | License unverified — treat as held until confirmed. |
| **2025 multiclass** — arXiv 2509.04715 | Best phone-mic fit | License **unverified** (flagged as best fit *if* it clears). |
| **HF drone-audio-detection-samples** | Labeled drone/non-drone | Provenance/license unverified. |
| **ESC-50 / UrbanSound8K / AudioSet** (negatives) | Environmental / urban / weak-label | Mixed CC-BY / CC-BY-NC / YouTube-sourced — verify per-clip before any `None/` use. |

➡️ **These are a counsel-gated backlog, not a to-do.** Don't pull them into
`data/recordings/` until legal signs off. The *technique* (§1 mixing, §4 negatives) stays
valid — it just needs license-clean audio to feed it.

**⚠️ Session-level data-leakage gotcha** (EchoHawk, arXiv 2606.29589): if clips from the
*same source recording* land in both train and test, accuracy looks great then **collapses
in the field**. Split train/test **by source recording**, never by clip. (The current
trainer uses a stratified-random split — see blocker #6.)

---

## 4. Negative / `None/` corpus (the contamination library)

Target categories (each becomes robustness against a real false-positive source):
- Wind (light → gusty), rain
- Road/traffic, distant highway
- Human voices / crowd / PA
- Lawn equipment, HVAC, generators, power tools *(rotor-ish harmonics — the hard negatives)*
- Music (many genres — common in YouTube contamination)
- Birds/insects/nature ambience
- **Deployment-environment baseline**: 5+ min of the actual site (README tip).

Sources: ESC-50 + UrbanSound8K cover most; YouTube fills specifics (a particular
lawnmower, the site's HVAC). Same clips double as the **mixing noise bank** for §1.2.

---

## 5. YouTube acquisition — ⚠️ conflicts with the "100% safe" directive

**Read this before scraping anything.** Sentinel is a commercial product, and the standing
directive is *"do whatever is 100% safe."* If open datasets are on hold for merely being
*non-commercial-licensed*, then **YouTube scraping is strictly worse**: YouTube's ToS
prohibits bulk download outright, and individual videos carry their own unknown copyrights.
Using scraped audio to train a commercial model is the **highest-risk** path on the table —
it contradicts the very policy that benched the cleaner datasets.

**Recommendation:** treat YouTube as a **last resort**, and only after counsel weighs in.
The genuinely safe sources come first (§5a). If you do scrape, prefer clips you can point to
a permissive license for (CC-BY with attribution), not arbitrary uploads.

### 5a. The safe primary path — first-party captures
The app already ships a **TrainingCapture** screen (`TrainingCaptureScreen` +
`trainingCapture`/`trainingStore`/`wavEncoder`) that records labeled 16 kHz WAV and exports
straight into `data/recordings/<Class>/`. Audio **you** record is unambiguously yours:
- Field-record your own **Skydio X2** (highest value, "most important"), Potensic Atom 2, etc.
- Capture 5+ min of clean **`None`** baseline in the deployment environment.
- Record real negatives you own: your lawnmower, HVAC, traffic near your site, voices.
This is the path the whole retrain flow was designed around — zero license risk.

### 5b. If/when YouTube is cleared (supplement only)

**Priority targets:**
- **Skydio X2** — highest value (thin in public datasets; README flags it "most important").
- Potensic Atom 2, Manned rotorcraft (helicopter flyover) — to replace synthetic placeholders.
- Environment-specific negatives.

**Pipeline (once yt-dlp/ffmpeg installed):**
1. Curated seed URL list per class (hand-vetted — avoid music-bed montages for positives).
2. `yt-dlp -x --audio-format wav` → `ffmpeg` resample to 16 kHz mono.
3. Auto/hand-segment into 2 s clips; **stamp each clip with `<videoID>` for the leakage split**.
4. Quick listen-pass / SNR gate to drop clips where the drone is buried or music dominates.
5. Filename includes the class keyword so folder auto-labeling works.

---

## Blockers / gaps summary
1. ✅ ~~Trainer~~ — exists and is complete (`train_corvus.py`).
2. ✅ ~~Python env~~ — Python 3.12 + numpy/scipy/sklearn installed; `retrain.ps1` runs today.
3. 🎯 **Real audio data** — the one true missing input. Everything downstream is ready.
4. ⬜ **`yt-dlp` + `ffmpeg`** — only needed for the YouTube path; install before §5.
5. ⚠️ Trainer reads **WAV only** (`scipy.io.wavfile`) — convert FLAC/OGG/MP3 to 16 kHz mono WAV first.
6. ⚠️ **Data-leakage caveat:** `train_corvus.py` currently uses a *stratified-random*
   `train_test_split`, i.e. its reported held-out accuracy is subject to session-level
   leakage (clips from one recording can span train/test). Optional improvement: add a
   `GroupShuffleSplit` keyed on source file for an honest number. (Doesn't affect the
   shipped model — only the accuracy readout.)
7. ⚠️ Optionally add `Potensic Atom 2/` + `Manned rotorcraft/` (and DJI Mini/FPV/Mavic 3/
   Yuneec) recording folders — the trainer already knows these labels.
