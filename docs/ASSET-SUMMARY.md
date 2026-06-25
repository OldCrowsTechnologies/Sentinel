# Corvus Sentinel — Asset Summary

**Purpose:** a factual snapshot for valuation / advisor (Nate) / potential-buyer
conversations. Honest by design — separates what's *built* from what's *proven*
from what's *protected*. Not marketing.

**One line:** an on-device, fully-offline acoustic drone detector (Android app,
React Native/Expo) that classifies drone rotor signatures from a phone mic, with
a phone-native Remote-ID (Bluetooth) layer and an external-SDR RF roadmap.

---

## What's BUILT (working, in the APK)
- Real-time acoustic capture → on-device classification (pure-TypeScript MLP,
  no TFLite/cloud) → threat tracking → operator brief.
- **Open-set "unknown build / possible homemade" flag** — the differentiator:
  detects a drone-present signature that doesn't match the known library.
- Range band (honest, no false precision), rotate-to-peak coarse-direction aid.
- GPS-stamped intercepts, After-Action Report, background monitoring + per-
  intercept notifications.
- **Tier-2 RF: Remote ID over Bluetooth** (drone + operator position).
- Offline tactical map (operator, RID pins, acoustic range rings, AO download).
- Specimen library (capture unknown contacts) + offline-queue auto-upload.
- In-app labeled **training capture** (record/label/export WAVs) and **Analysis**
  (SQLite mission-log viewer + export) for tuning.
- Ambient-noise rejection: trained-in 400 Hz high-pass + VAD + confidence gating.
- Disabled **SDR/LoRa scaffold** (Tier-3, slaved off until hardware).

## What's PROVEN / VERIFIED
- **Train/inference parity to ~1e-14** — on-device math provably equals the
  trainer (re-verified after every feature-path change).
- **Unit tests** (8/8) on the DSP, Remote ID parser, WAV encoder.
- **One real-world field detection** — a live Skydio X2 identified in seconds.

## What's NOT yet validated (honest gaps)
- **Accuracy metrics on real audio** — the model is trained on *synthetic*
  signatures. No confusion matrix (detection rate / false-positive rate / range)
  on real drones yet. *This is the #1 gap between "demo" and "fundable."*
- Background reliability, GPS behavior, Remote ID (needs a real broadcaster to
  validate), and the offline map (needs on-device confirmation).
- Noise rejection thresholds (high-pass cutoff, VAD) un-tuned against real data.

## What's PROTECTED (IP)
- **Nothing filed.** No provisional, no NDA discipline in place yet.
- Research (adversarially verified) suggests single-mic acoustic *classification*
  is comparatively clear of existing patents; the **multi-modal fusion** layer is
  where a freedom-to-operate search is warranted. **Recommendation: file a
  provisional before demos circulate.** (Not legal advice — for IP counsel.)

## Differentiation (why a strategic buyer would care)
- **EW/jam-resilient:** passive + acoustic + offline → nothing to jam or spoof;
  catches the **RF-silent / fiber-optic / autonomous** drones built to defeat RF
  detection — a current, unsolved C-UAS problem.
- **$0 sensor hardware**, deployable on phones people already carry; rugged/EOD
  (ATAC-class) host + ATAK integration is the defense on-ramp.
- **Data flywheel:** field captures grow the library.
- Honest framing throughout (no fabricated specs) — survives expert scrutiny.

## Honest limitations to state plainly
- Acoustic has shorter range than radar/RF and degrades in high noise/wind.
- Single mic gives **no bearing/elevation**; geolocation degrades under GPS denial.
- Strongest as one layer of a multi-modal stack, not a standalone radar replacement.

## The three cheap moves that multiply worth
1. **Provisional patent** — converts replicable code into a defensible asset.
2. **One real-data confusion matrix** — "it works, *measured*."
3. **One pilot / LOI / paid EOD interest** — proof of demand.
