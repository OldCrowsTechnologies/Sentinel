# Corvus Sentinel — Class Taxonomy

The canonical class list and the rules that shape it. Source of truth for the
labels is `training/corvus_features.py:LABELS`; this doc explains the *why*.

## The core principle: classify by propulsion, not brand

A single microphone hears a **propulsion signature** — rotor blade-pass frequency,
number of rotors, electric vs. combustion, turbine whine. So the model classifies
by acoustic **type**. Two consequences:

- ✅ **Categories are reliably separable by sound**: small vs. large multirotor,
  FPV racer, fixed-wing, combustion engine, helicopter, jet, bird.
- ⚠️ **Same-size electric drones are near-identical by ear** (a DJI Mini 3 vs.
  Mini 4 share rotors). Reliable **brand/model** ID for those comes from
  **Remote ID** (BLE, already in the app) and SDR — not the mic.

So the app calls out the **most specific class the sound supports**: a confident
brand when the signature is distinctive, otherwise the acoustic category, plus
Remote ID for authoritative identity when the drone is compliant.

## The 20 classes (flat softmax; index order = `LABELS`)

### Non-threat — called out, never alarmed on
`droneness = 1 − Σ P(non-threat)`, so these do NOT count as a drone.

| Class | Acoustic signature | Note |
|---|---|---|
| **None** | ambient / wind / traffic / voices | the "quiet" baseline |
| **Bird** | short tonal chirps & sweeps, bursty | non-stationary → gate suppresses |
| **Manned rotorcraft** | low main-rotor + turbine whine | crewed helo — not a threat |
| **Manned fixed-wing** | broadband roar + turbine, low rumble | jets/prop planes; loudest false-alarm risk |

### UAS acoustic categories — the "every type" coverage
Reported when no specific model confidently matches.

| Class | Blade-pass / signature |
|---|---|
| **Small multirotor** | fast props, high fundamental (~1.4–2.2 kHz) |
| **Medium multirotor** | ~0.8–1.4 kHz (Skydio/Phantom class) |
| **Large multirotor** | big slow props, low fundamental (~0.3–0.65 kHz) |
| **FPV racer** | 5–6″ props, very high RPM, aggressive throttle AM |
| **Fixed-wing UAS** | single steady prop, clean harmonic stack |
| **Combustion UAS** | LOW engine firing (~40–130 Hz) + many harmonics — **one-way-attack / Shahed-class** |

### Specific models — brand ID (acoustic best-effort; RID authoritative)
`Skydio X2`, `DJI Phantom`, `Parrot Anafi`, `Potensic Atom 2`, `DJI Mini 3 Pro`,
`DJI Mini 5 Pro`, `DJI FPV`, `DJI Mavic 3`, `Yuneec`.
(The last five are **real-data-only** — no synthetic profile — so they appear in a
model only once you drop captures into their folder. The trainer auto-excludes
empty classes; parity/alignment stay correct.)

### Open-set catch-all
| Class | Meaning |
|---|---|
| **Unknown** | a UAS is present but doesn't match any known type/model → "Unknown build" |

## The 40 Hz high-pass (feature-path decision)

The low-frequency classes — **Combustion UAS**, **Manned rotorcraft**, **Manned
fixed-wing** — live mostly below 400 Hz. The old 400 Hz high-pass (tuned to kill
voice) erased them. It was lowered to **40 Hz** so those signatures survive; voice
rejection now leans on the **stationarity gate** (voice is bursty → suppressed;
engine/rotor combs are steady → kept) + runtime VAD + confidence gating.

**Trade-off:** more low-band energy reaches the model, so voice-rejection must be
**re-validated in the field** (Analysis screen: record voices, confirm drone score
stays ~0). Revert = set `HIGH_PASS_FC = 400.0` and retrain. The `fc` travels in the
model JSON, so parity holds without a `dsp.ts` code change.

## Open-set grouping (exported by `train_corvus.build_open_set`)

- `nonThreatIndices` — None, Bird, Manned rotorcraft, Manned fixed-wing.
- `categoryIndices` — the six UAS categories (the acoustic-type fallback).
- `specificDroneIndices` — the model leaves (brand match + OOD novelty distance).
- `threatIndices` — everything that isn't a non-threat.

The device (`lib/mlClassifier.ts:openSetVerdict`) uses these to produce
`calloutLabel`: a confident **brand** → else the **category** → else "Unknown
build" → else the **non-threat** class. That's how the app "calls out every class."

## Identity comes from fusion
- **Acoustic** (this model): the *category*, and best-effort brand.
- **Remote ID** (BLE, `openDroneId.ts`): exact make/model/serial for compliant drones.
- **SDR** (Tier-3): control-link protocol.
