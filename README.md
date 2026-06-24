# Corvus Sentinel

**Persistent air-defense monitor — acoustic drone detection for OCWS.**
Old Crows Wireless Solutions · *We Always Find the Signal.*

Corvus Sentinel listens through the phone's microphone, classifies rotor
acoustic signatures on-device with a trained neural net, tracks contacts over
time, and briefs you (screen + haptics + optional Corvus voice). Built with
Expo / React Native; ships as a sideloadable Android APK.

---

## What actually works in this MVP

- **Trained acoustic brain.** A 5-class model (None / Skydio X2 / DJI Phantom /
  Parrot Anafi / Unknown) trained on the documented blade-pass signatures.
  Inference runs **fully on-device in pure TypeScript** — no TFLite, no tfjs.
- **Verified train/inference parity.** The feature math in `lib/dsp.ts` is
  proven identical to the Python trainer (`bash training/run_parity.sh`,
  tolerance < 1e-6). This is what makes the model fire on real audio.
- **Real microphone pipeline.** 16 kHz mono PCM via `react-native-audio-api`,
  windowed and classified continuously.
- **Threat tracking + briefs.** Dedup, trajectory, approach detection, severity,
  Corvus voice (ElevenLabs) with haptic fallback.
- **After-Action Report.** One-tap OCWS-branded HTML session report.

> The bundled model is trained on **synthetic** (physically-grounded) audio so
> the app runs immediately. For field accuracy, retrain on real recordings —
> see “Retraining” in `BUILD.md`. Same script, no code changes.

## Project layout

```
Corvus Sentinel/
├── App.tsx                 # controller: wires audio → model → tracker → voice
├── index.js                # entry (registerRootComponent)
├── app/
│   ├── SentinelScreen.tsx  # main monitoring UI
│   ├── DetectionsScreen.tsx# session log
│   └── SettingsScreen.tsx  # voice/haptics/threshold
├── lib/
│   ├── dsp.ts              # FFT + log-mel features (mirrors the trainer)
│   ├── mlClassifier.ts     # loads JSON brain, MLP forward + softmax
│   ├── audioCapture.ts     # real-time mic → analysis windows
│   ├── threatTracker.ts    # dedup, trajectory, alerts
│   ├── corvusVoice.ts      # ElevenLabs TTS + haptics
│   ├── reportGenerator.ts  # HTML After-Action Report
│   └── theme.ts            # OCWS palette
├── assets/
│   ├── models/corvus-model.json   # the trained brain (~140 KB)
│   └── branding/                  # icon + splash (placeholder radar/crow)
├── training/
│   ├── corvus_features.py  # feature extraction — SOURCE OF TRUTH
│   ├── corvus_synth.py     # synthetic signature generator (bootstrap data)
│   ├── train_corvus.py     # train + export model JSON (accepts real WAVs)
│   ├── verify_parity.py    # emits reference cases
│   ├── verify_parity.mjs   # runs lib/*.ts against them
│   └── run_parity.sh       # one-command parity check
├── data/drone-signatures.json
├── app.json · eas.json · package.json · tsconfig.json · babel.config.js · metro.config.js
└── BUILD.md                # full build/test/retrain guide
```

## Quick start

```bash
bash SETUP.sh                       # install deps
npm run parity                      # prove the brain is consistent on-device
eas build -p android --profile preview   # build the APK (see BUILD.md)
```

## The model in one paragraph

5-second-ish mono windows at 16 kHz → Hann-windowed 512-pt FFT → 20-band
log-mel energies (mean + std across frames) + 4 drone-band energy ratios = a
44-dim feature vector → standardize → MLP (64, 32, softmax) → class + confidence.
The mel filterbank, scaler, and weights all live in `corvus-model.json`; the
device reads them directly, so retraining never requires touching app code.

## Notes / honest limitations

- **Bearing is unavailable** in this MVP (single mono mic). Distance is a rough
  RMS-based estimate and needs per-device calibration (`mlClassifier.ts`
  `refRms`/`refDistanceFeet`).
- Synthetic-trained accuracy looks high in-lab; **real-world numbers will be
  lower** until you retrain on DADS + your own Skydio captures.
- Background monitoring is configured (foreground-service permissions) but
  long-running background reliability should be validated on your target device.

---

**Contract-only software.** Government / enterprise deployment.
OCWS Sales · info@oldcrowswireless.com · 850-861-7582
