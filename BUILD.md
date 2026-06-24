# Corvus Sentinel — Build & Test Guide

Target: installable **Android APK** for field testing against a Skydio X2.
Expo project: **`oldcrowswireless/corvus-sentinel`**
(https://expo.dev/accounts/oldcrowswireless/projects/corvus-sentinel)

> Stack note: this app uses `react-native-audio-api` for real-time microphone
> PCM, which requires **React Native 0.76+ on the New Architecture**. The project
> is therefore on **Expo SDK 53 (RN 0.79, New Arch ON)** — not SDK 51. A managed
> APK builds in Expo's cloud via EAS (no Mac needed for Android); it cannot be
> built unattended from inside this chat because EAS needs your login.

---

## 0. Turnkey (one command each)

From the project folder:

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1      # install + version-align + expo-doctor
powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1  # eas login -> link -> build APK
```

```bash
# macOS / Linux
bash scripts/setup.sh
bash scripts/build-apk.sh
```

`build-apk` prompts you to `eas login` (your `oldcrowswireless` account) the
first time, links to the existing `corvus-sentinel` project, and starts the
cloud APK build. Retrain the brain later with `scripts\retrain.ps1`
(Windows) or `bash scripts/retrain.sh`.

**Background monitoring:** on Android the app runs a microphone **foreground
service** with a persistent "Corvus Sentinel — Monitoring" notification, so
detection keeps running with the screen off. Grant the notifications permission
on first run.

The sections below are the same steps done manually.

---

## 1. Prerequisites

- Node.js 18+ and npm 9+
- An Expo account with access to the `oldcrowswireless` org
- `npm install -g eas-cli`
- Python 3.10+ (only to retrain the model)

## 2. Install

```bash
cd "Corvus Sentinel"
npm install
npx expo install --fix     # snap native module versions to the SDK
npx expo-doctor            # should report no critical issues
cp .env.example .env       # optional: add EXPO_PUBLIC_ELEVENLABS_API_KEY
```

## 3. Link to the existing Expo project

```bash
eas login
eas init     # detects owner "oldcrowswireless" + slug "corvus-sentinel",
             # links, and writes extra.eas.projectId into app.json
```

## 4. Build the APK

```bash
eas build --platform android --profile preview
# or: npm run build:android
```

EAS returns a download URL. Install on the device:

```bash
adb install -r corvus-sentinel.apk     # or open the link on the phone
```

The `preview` profile produces a release APK (`distribution: internal`) —
sideload directly, no Play Store.

## 5. First run on device

1. Launch **Corvus Sentinel**; grant **microphone** + **notifications**.
2. Tap **START** — the input-level meter should move.
3. Fly the Skydio X2 within ~10–30 ft; watch the threat list populate
   (type, confidence %, rough distance).
4. Tap **REPORT** to generate + share the After-Action Report (HTML).

## 6. Voice briefs (optional)

Add an ElevenLabs key to `.env`:

```
EXPO_PUBLIC_ELEVENLABS_API_KEY=sk_xxx
```

Rebuild. Without a key, briefs still fire as on-screen alerts + haptics
(locked Corvus voice ID `Oq6YjhFgak69fZQyDSCd` is used when a key is present).

---

## Retraining the brain (production accuracy)

The bundled model was trained on physically-grounded **synthetic** signatures so
the app works out of the box. For field accuracy, retrain on real audio — no
code changes:

1. Sort recordings into class folders (see `data/recordings/README.md`):
   `data/recordings/{None, Skydio X2, DJI Phantom, Parrot Anafi, Unknown}/*.wav`
   (DADS / DroneAudioSet files work once sorted; any sample rate is auto-resampled to 16 kHz.)

2. Retrain (mix real + synthetic while your Skydio corpus is small):

   ```bash
   python3 training/train_corvus.py --data data/recordings --per-class 300
   ```

3. Verify on-device math still matches the trainer, then rebuild:

   ```bash
   bash training/run_parity.sh        # or: npm run parity
   eas build --platform android --profile preview
   ```

`train_corvus.py` prints held-out accuracy + a confusion matrix and overwrites
`assets/models/corvus-model.json`. The on-device DSP reads its config (mel
filterbank, band ranges, scaler, weights) from that JSON, so retraining is
fully self-contained.

## Verifying train/inference parity

`bash training/run_parity.sh` proves `lib/dsp.ts` + `lib/mlClassifier.ts`
produce identical features and probabilities to the Python trainer
(tolerance < 1e-6). Run it after any change to feature code on either side.
