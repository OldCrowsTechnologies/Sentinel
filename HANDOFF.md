# Corvus Sentinel — Engineering Handoff

**For:** the next engineer / coding agent picking this up.
**What it is:** an Expo / React Native app that listens through the phone mic,
classifies drone rotor acoustic signatures **on-device**, tracks contacts, and
briefs the operator. Ships as a sideloadable Android APK. Contract software for
Old Crows Wireless Solutions (OCWS).

**Owner / build target:** Expo project `oldcrowswireless/corvus-sentinel`
(https://expo.dev/accounts/oldcrowswireless/projects/corvus-sentinel).

---

## TL;DR — get it building

```bash
# from the project root
npm install
npx expo install --fix      # MUST run: pins native module versions to the SDK
npx expo-doctor             # expect no critical issues
eas login                   # your oldcrowswireless account (interactive, required)
eas init                    # links to the existing corvus-sentinel project
eas build --platform android --profile preview   # cloud build -> APK URL
```

Windows one-shots: `scripts\setup.ps1` then `scripts\build-apk.ps1`.
Prove the model pipeline before/after any DSP change: `npm run parity`.

---

## Status

WORKING + VERIFIED (in this sandbox, Python+Node):
- Trained 5-class acoustic model: None / Skydio X2 / DJI Phantom / Parrot Anafi / Unknown.
  Held-out accuracy 99.2% on synthetic data (see "honest limitations").
- On-device inference is **pure TypeScript** (no TFLite, no tfjs).
- **Train/inference parity proven**: `lib/dsp.ts` + `lib/mlClassifier.ts` reproduce
  the Python trainer's features and probabilities to < 1e-14. This is the core
  invariant — do not break it.
- Real mic capture via `react-native-audio-api` AudioRecorder (16 kHz mono),
  windowed + classified continuously.
- Android background monitoring: mic foreground service + persistent notification
  + interruption handling.
- Threat tracking (dedup, trajectory, approach, severity, lifecycle) — unit-smoke-tested.
- Corvus voice briefs (ElevenLabs) with haptic/console fallback when no API key.
- HTML After-Action Report export. OCWS-branded UI (3 screens).
- Retraining pipeline that accepts real WAVs; graceful synthetic fallback.

NOT YET DONE / NOT VERIFIABLE HERE (needs a machine with npm + the Expo account):
- A real `npm install`, full RN typecheck of the app/screens, and an actual EAS
  build have NOT been run. npm registry + EAS cloud are firewalled in the
  authoring sandbox. First real build will surface any native version drift —
  fix with `npx expo install --fix` / `npx expo-doctor`.
- No on-device field test yet (the whole point of the APK).

---

## Repo map

```
App.tsx                  # controller: owns the engine, keeps it alive across screens
index.js                 # registerRootComponent(App)
app/
  SentinelScreen.tsx     # main monitoring UI (presentational; props from App.tsx)
  DetectionsScreen.tsx   # session log
  SettingsScreen.tsx     # voice/haptics/confidence threshold
lib/
  dsp.ts                 # FFT + log-mel features. MIRRORS the Python trainer.
  mlClassifier.ts        # loads JSON brain; standardize + MLP + softmax (pure TS)
  audioCapture.ts        # AudioRecorder -> analysis windows; Android FGS notification
  threatTracker.ts       # dedup / trajectory / alerts (mono: dedup by type+distance)
  corvusVoice.ts         # ElevenLabs TTS + expo-haptics
  reportGenerator.ts     # HTML After-Action Report (expo-file-system)
  theme.ts               # OCWS palette
assets/
  models/corvus-model.json   # the trained brain (~140 KB) — bundled, imported by App.tsx
  branding/                  # icon/splash (placeholder radar/crow — swap real OCWS logo)
training/
  corvus_features.py     # FEATURE EXTRACTION — SINGLE SOURCE OF TRUTH
  corvus_synth.py        # synthetic signature generator (bootstrap data)
  train_corvus.py        # train + export model JSON; accepts --data <dir> of real WAVs
  verify_parity.py       # emits reference cases (features + probs)
  run_parity.sh          # one-command parity check (py reference vs real lib/*.ts)
data/
  recordings/<class>/    # drop real WAVs here to retrain (see its README)
  drone-signatures.json  # reference acoustic profiles
scripts/                 # setup / build-apk / retrain  (.ps1 Windows + .sh unix)
app.json eas.json package.json tsconfig.json babel.config.js metro.config.js
BUILD.md README.md
```

---

## Architecture / data flow

mic → `AudioCaptureService` (16 kHz mono, 2 s windows, 1 s hop)
  → `DroneClassifier.classifySamples(window)`:
      `dsp.extractFeatures` → 44-dim vector → `standardize` → `forwardMLP` → softmax
  → `ThreatTracker.update({label,confidence,distance,bearing})`
  → UI state + alerts → `CorvusVoice.brief()` on new/approaching threats.

Model JSON is the contract between trainer and app. It carries: `labels`,
`dsp` (sampleRate, nfft, hop, nMels, clipSec, bandRatios, **melFilterbank**),
`scaler` (mean/scale), and `mlp.layers` ([{W:[in][out], b, activation}]).
The device recomputes nothing about mel points — it matmuls the exported
filterbank — which is why parity holds.

---

## The parity contract (read before touching features)

`training/corvus_features.py` and `lib/dsp.ts` implement the SAME math:
DC-removal → Hann(512) → rfft → power → mel filterbank matmul → log → mean+std
across frames → 4 drone-band energy ratios → 44-dim vector.

Rules:
1. Any change to feature math must be made in BOTH files identically.
2. Constants live in `corvus_features.py` (SR, NFFT, HOP, N_MELS, BAND_RATIOS)
   and are exported into the model JSON; `dsp.ts` reads them from the model — so
   don't hardcode divergent values in `dsp.ts`.
3. Run `npm run parity` (or `bash training/run_parity.sh`) after any such change.
   It must print `PARITY OK` (diffs < 1e-6, 5/5 class agreement) or the model
   will misfire on real audio. Treat a parity failure as a build breaker.

---

## Retraining the brain (production accuracy)

The bundled model is trained on physically-grounded SYNTHETIC signatures so the
app runs out of the box. For field accuracy, retrain on real audio — no code
changes:

```bash
# sort recordings: data/recordings/{None, Skydio X2, DJI Phantom, Parrot Anafi, Unknown}/*.wav
python3 training/train_corvus.py --data data/recordings --per-class 300
bash training/run_parity.sh
eas build --platform android --profile preview
```

`train_corvus.py` prints accuracy + confusion matrix and overwrites
`assets/models/corvus-model.json`. Any sample rate is auto-resampled to 16 kHz;
filenames containing skydio/dji/phantom/mavic/parrot/anafi/none/noise are
auto-labeled, so DADS / DroneAudioSet sort in directly.

---

## Constraints & gotchas

- **Stack is pinned for a reason.** `react-native-audio-api` needs RN 0.76+ on the
  **New Architecture**. Project is Expo SDK 53 (RN 0.79, `newArchEnabled: true`).
  Do not downgrade below SDK 52.
- **Version drift:** package.json versions are best-effort; ALWAYS run
  `npx expo install --fix` after `npm install`, then `npx expo-doctor`.
- **EAS build needs interactive login** — cannot be fully headless without an
  `EXPO_TOKEN` env var. For CI, set `EXPO_TOKEN` and use
  `eas build --non-interactive`.
- **Bearing is unavailable (mono mic).** `ClassificationResult.bearing = -1`.
  Stereo direction-finding is a future task (see backlog).
- **Distance is a rough RMS estimate.** Calibrate `refRms` / `refDistanceFeet`
  in `lib/mlClassifier.ts` against real measured SPL-vs-distance.
- **Notification small icon:** `audioCapture.ts` uses `smallIconResourceName:
  'ic_launcher'`. If the FGS notification icon looks wrong, add a monochrome
  drawable and reference it.
- **expo-av is deprecated** (used in `corvusVoice.ts`). Fine on SDK 53; migrate
  to `expo-audio` when convenient.
- The model JSON is imported directly (`resolveJsonModule`) and bundled by Metro.

---

## Suggested next tasks (priority order, with acceptance criteria)

1. **First real build + smoke test.** `npm install && npx expo install --fix &&
   npx expo-doctor`; resolve any flags; `eas build -p android --profile preview`;
   install on a device; confirm mic permission, level meter moves, START works.
   *Done when:* an APK installs and runs without redbox.

2. **Field validation against a Skydio X2.** Record live; confirm Skydio X2 fires
   at close range and "None" holds in quiet. Capture clips for retraining.
   *Done when:* real-world confusion matrix exists.

3. **Retrain on real audio.** Use captured clips + DADS/DroneAudioSet via
   `data/recordings`. *Done when:* parity OK and held-out accuracy reported on
   REAL data (not synthetic).

4. **Distance calibration.** Measure RMS at known distances; fit
   `refRms`/`refDistanceFeet`. *Done when:* estimate within ~±30 ft at 100–300 ft.

5. **Background robustness.** Verify detection continues screen-off for 30+ min;
   confirm FGS notification + battery behavior on the target device.

6. **(Stretch) Stereo bearing.** Use 2-channel capture + cross-correlation/phase
   to populate `bearing`; update `threatTracker` dedup to use it.

7. **(Stretch) CNN upgrade.** Mel-spectrogram CNN for higher multi-class accuracy;
   keep the JSON-export + parity-test discipline (or add a tflite path).

---

## Conventions

- Keep on-device inference dependency-free (no tfjs/tflite) unless task 7 says otherwise.
- Every feature-math change ships with a passing `npm run parity`.
- Don't commit `.env` or `training/parity_cases.json` (already gitignored).
- Prefer `npx expo install <pkg>` over hand-editing native dep versions.
