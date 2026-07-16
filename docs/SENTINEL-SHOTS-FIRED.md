# Sentinel — Shots Fired (acoustic gunshot detection)

> **Working thread.** Living design + build doc for adding acoustic gunshot detection,
> weapon classification, and shot localization to the Sentinel platform — **running
> through the same C2** as drone detection. Backlog one-liner lives in
> [SENTINEL-BUILD-LIST.md](SENTINEL-BUILD-LIST.md) (item 1); this is the deep thread.

**Status:** scoping / pre-build (post-demo). **Sponsor interest:** ECSO (highly requested,
life-safety). Likely a **separate product line / contract**, same platform.

---

## 0. Core principle — one C2, many sensor types

Sentinel's command layer is **generic by design**. Both the on-device report and the
backend row already carry a **`kind`** discriminator:

- `lib/meshTypes.ts:25` — `type ContactKind = 'acoustic' | 'rid' | 'lora' | 'wifi'`
- `supabase/migrations/0001_c2_core.sql:89` — `detections.kind text not null`

**A gunshot is just another `kind`.** It flows into the same map, live log, instant
alerting, per-agency RLS isolation, and (future) joint-ops mutual aid. We are adding a
**sensor type**, not a second product. One command picture: drones + gunshots + next.

---

## 1. Reuse inventory — what's already built

| Capability | Where | Reuse for Shots Fired |
|---|---|---|
| Multi-tenant C2 backend (RLS, realtime) | `supabase/migrations/*` | **As-is** — gunshot rows are `kind='gunshot'` |
| Instant alert path ("faster than 911") | `lib/cloudSync.ts` (`pushDetection`) | **As-is** — same insert → realtime → C2 |
| C2 dashboard (map, roster, log, alerts) | `c2-dashboard/index.html` | +gunshot marker/color + "SHOTS FIRED" banner |
| Report message + `kind` seam | `lib/meshTypes.ts` (`ContactReport`) | +`'gunshot'` kind, +weapon fields |
| Fusion / multilateration solver | `lib/meshFusion.ts` | **Extensible** — TDOA terms anticipated (`meshFusion.ts:16-18`) |
| On-device ML inference framework | `lib/mlClassifier.ts` | Framework reused; new features + model |
| Training + export pipeline | `training/train_corvus.py`, `corvus_features.py` | Retarget to gunshot corpus + impulse features |
| Field-capture workflow | `docs/field-capture-guide.md` (Fritz drone captures) | Same playbook for gunshot corpus |

**Bottom line:** roughly the front half (command, alerting, fusion, multi-tenant, ML
scaffolding) is already built. New work is the **sensor, the classifier, TDOA, and data**.

---

## 2. New work (the actual R&D)

1. **Impulse capture.** Gunshots are ~1–3 ms transients at ~140–165 dB at source. Phone
   mics auto-gain/clip and sample at 16 kHz — inadequate for the muzzle blast + timing.
   → favors **dedicated fixed sensors** (high-SPL mic, higher sample rate).
2. **Low-false-positive classifier.** Gunshot vs firework vs backfire vs door-slam is the
   domain's hardest problem (cf. ShotSpotter). Needs a real labeled corpus + confounders.
3. **Weapon class.** Rifle / handgun / shotgun is feasible (muzzle energy + supersonic
   ballistic shockwave presence). **Exact caliber = R&D stretch — do NOT headline it.**
4. **TDOA localization.** Time-difference-of-arrival needs sub-ms clock sync across sensors
   (sound ≈ 343 m/s → 1 ms ≈ 0.34 m). Fixed, networked sensors with GPS/PTP time + known
   positions make this tractable; roaming phones do not.
5. **Validation + liability.** Life-safety + wrongful-dispatch exposure → rigorous accuracy
   validation and "decision-support aid, not authoritative" positioning.

---

## 3. Target architecture

```
 School mic ─┐
 Bldg mic  ──┼─► [edge node] detect → ContactReport(kind:"gunshot",     ─► SAME Supabase ─► SAME C2
 Unit mic  ──┘   impulse capture      label:"Rifle", peak_db, lat/lon)      (detections)      drones + gunshots,
                 + weapon class                                                                one command view
        └────────── multi-sensor TDOA triangulation → fused shot location ──────────┘
```

**Primary sensor = fixed dedicated edge node** (schools, county buildings): high-SPL mic +
small compute (Pi/ESP32-class, or the existing RF/edge hardware) + GPS time + known lat/lon.
Phone/unit-mic detection is a **secondary best-effort layer**.

---

## 4. Data model / schema delta

**Add the kind** (small, backward-compatible):
- `lib/meshTypes.ts`: `ContactKind = ... | 'gunshot'`; add to the `KINDS` set (`meshTypes.ts:51`).
- Reconcile the DB comment (`detections.kind` says `control-link` but the TS union doesn't) —
  make DB + TS agree and add `gunshot`.

**A gunshot detection row (reuses existing columns):**
```
kind        = 'gunshot'
label       = 'Rifle' | 'Handgun' | 'Shotgun' | 'Unknown firearm'
confidence  = 0..100
peak_db     = muzzle-blast energy (reuse the RF peak_db column semantics)
lat/lon     = sensor position (P1) or fused shot location (P3)
range_ft    = est. distance to shooter (single sensor)
bearing     = AoA if the sensor is an array; else -1
ts          = shot time (GPS-disciplined)
```

**Proposed new columns (P2+):**
```sql
alter table detections add column if not exists shot_count   int;    -- rounds in burst
alter table detections add column if not exists weapon_class text;   -- rifle/handgun/shotgun
alter table detections add column if not exists supersonic   boolean;-- shockwave present
```

---

## 5. Classifier plan

The current model is tuned for **sustained tonal** drone signatures
(`corvus_features.py`: SR 16 kHz, NFFT 512, 20 mel bands, mean+std over the clip + band
ratios → MLP 64×32). Gunshots are the opposite — **short transients** — so:

- **Higher sample rate** (≥44.1/48 kHz) to capture the muzzle-blast spectrum + precise onset.
- **Onset / impulse detection** front-end (energy spike + short attack) to trigger analysis.
- **Transient features:** attack time, peak SPL, spectral shape of the "crack," decay
  envelope, presence/timing of the supersonic shockwave vs muzzle blast (N-wave), low-freq
  thump. (Different feature set than mel-mean/std.)
- **Confounder discrimination** as a first-class label set (firework, backfire, door, hammer,
  nail-gun, construction).
- Model: start with the same MLP framework on the new features; escalate to a small CNN on a
  spectrogram/waveform window if FP rate demands it. Keep on-device + parity-tested like the
  drone model.

---

## 6. Sensor / hardware plan (fixed node)

**Full per-deployment BOM with part numbers, prices, and links lives in
[SENTINEL-HARDWARE-BOM.md](SENTINEL-HARDWARE-BOM.md)** (school / roof / vehicle).
The brain + software are built and proven — [`sensor-node/`](../sensor-node/),
Raspberry Pi running the shared `detectShots()` unchanged. Summary of what the
research resolved vs the original sketch:

- **Brain = Raspberry Pi, not ESP32.** A Pi runs `lib/shotDetect.ts` unchanged
  (the exact 97.8%-recall detector); an ESP32 is a firmware rewrite AND can't fit
  a ResNet-scale classifier. Pi 4 (2 GB) to prototype (~$45), CM4+eMMC for
  production (~$97). ESP32-S3 is viable only as a trigger-only satellite.
- **Mic = a $7 120-dB I2S MEMS breakout (SPH0645) to start**, NOT the
  ~135–150 dB part the sketch called for. Measured: clipping doesn't hurt
  detection, and C3GD is 78.5% clipped yet trains to 97% caliber accuracy. The
  high-AOP dual-mic design (Infineon IM73A135 + a sensitive mic, per ShotSpotter
  US11361636) is a **P2** refinement needing a custom PCB — no high-AOP part is
  sold on an I2S breakout.
- **Time sync is NOT a P1 cost.** A single node has nothing to synchronize
  against. GPS-PPS / PTP is Phase-3-mesh only (§7). This deletes a whole subsystem
  and $40–310/node from the P1 build.
- **Enclosure = UV-stabilized polycarbonate + adhesive ePTFE acoustic vent**
  (Gore GAW334) over a downward port; ABS is indoor-only (fails in UV). Pass sound
  through a waterproof wall via the membrane — the industry-converged answer.
- **Power: PoE** for fixed (one cable = power + data, and the IDF UPS carries the
  sensor net through building power loss); 12 V buck + supercap for vehicle.

**Why fixed (corrected):** known **surveyed position** (what makes TDOA possible),
guaranteed power, and controlled always-on placement. **NOT** "phones can't hear
shots" — measured on 8,015 real shots, phones matched dedicated mics for detection
(§ working log). Keep that claim out of the pitch; it's false and checkable.

---

## 7. Localization / TDOA plan

- Reuse `lib/meshFusion.ts` — it already isolates per-node residuals so **TDOA rows** can be
  added "without reworking the solve" (`meshFusion.ts:16-18`).
- Range-only (loudness) is too coarse for shots; **TDOA** (arrival-time differences between
  fixed sensors) is the method. Needs shared clock (GPS/PTP) sub-ms.
- ≥3 sensors that hear the shot → 2D fix + uncertainty ellipse (same ellipse machinery the
  drone fusion already renders on the map).

---

## 8. Phasing (all land in the SAME C2)

| Phase | Deliverable | Acceptance |
|---|---|---|
| **P1** | Single fixed sensor: **detect gunshot → instant C2 alert** (no location) | "SHOTS FIRED — <site>" appears on the ECSO dashboard within ~2 s; low FP on a confounder test set |
| **P2** | **Weapon class** (rifle/handgun/shotgun) + confidence; shot count | ≥X% class accuracy on held-out range data (set target with data) |
| **P3** | **Multi-sensor TDOA triangulation** → fused shot location + ellipse on the map | Location within target CEP on a live-fire test with ≥3 sensors |
| **P4** | **Caliber** estimate (stretch) | Flag as R&D; only ship if accuracy is defensible |

**P1 is the fastest proof point** — reuses almost the entire platform and lands the
"faster than 911" value.

---

## 9. Data collection plan

- **Positives:** real gunfire across weapon types (handgun / rifle / shotgun), calibers,
  distances, indoor/outdoor, urban/rural. Sources: supervised range captures (mirror the
  Fritz airfield MP4→WAV workflow) + academic/public gunshot datasets.
- **Confounders (critical):** fireworks, vehicle backfire, door slams, hammer/nail-gun,
  construction, thunder, balloon pops. These are the FP killers — collect aggressively.
- **Metadata:** weapon, caliber, distance, mic type, environment, GPS + time.
- **Legal/safety:** captures only at authorized ranges / with LE cooperation; document chain
  of custody for any evidentiary aspirations (or explicitly disclaim evidentiary use).

---

## 10. False positives, validation, liability

- Publish an honest confusion matrix (positives + every confounder class), like the drone model.
- Two-stage gate (impulse detector → classifier) to cut nuisance triggers.
- Position as a **decision-support aid, not a certified safety-of-life system** (same framing
  as the drone product's "Straight Talk" slide).
- Legal review before any deployment that could trigger dispatch.

---

## 11. Open questions / decisions

- [x] **Fixed-sensor hardware: Raspberry Pi** (runs the shared detector unchanged;
      ESP32 = rewrite + can't fit the classifier). Pi 4 proto → CM4 production. See BOM.
- [x] **Time-sync for TDOA: GPS-PPS grandmaster on the roof node + PTP over wired LAN**
      to indoor nodes (~1–5 µs, far inside the sub-ms budget). And: **not needed until
      Phase 3** — P1 uses no timing hardware at all.
- [ ] Buyer/contract: SO vs school district (safety grants) — same C2 tenant or separate org?
- [ ] Evidentiary posture: decision-support only, or pursue court-admissible standards?
- [ ] How far to chase caliber (P4) vs stop at weapon class (P2)?
- [ ] **Vehicle speed-gating threshold** (~30 mph?) and whether to pursue a multi-mic
      coherence array for at-speed detection (the only mechanism with real headroom; big lift).
- [ ] **Human-in-the-loop or not?** ShotSpotter's cost IS its review center; skipping it is
      the 10–50× cost win but takes the wrongful-dispatch liability onto the classifier directly.

---

## 12. Next actions

- [x] P1 mini-spec: `kind:'gunshot'` schema seam (done, `meshTypes.ts`), fixed-sensor BOM
      (done, [SENTINEL-HARDWARE-BOM.md](SENTINEL-HARDWARE-BOM.md)), sensor node built + proven
      ([`sensor-node/`](../sensor-node/)). Remaining: dashboard "SHOTS FIRED" banner + marker.
- [ ] Buy the §1 bench kit (~$85) and run the node on a real Pi hearing real shots.
- [ ] Stand up a data-collection plan + first authorized range capture session.
- [ ] Train the confounder classifier on C3GD (positives) + FSD50K CC0/CC-BY (confounders).

## Working log
- 2026-07-15 — thread created; unified-C2 architecture decided (gunshot = a `kind`). Reuse
  inventory + phasing + schema delta captured.
- 2026-07-16 — **P1 built.** `kind:'gunshot'` seam landed; license-clean data path (C3GD +
  FSD50K, NOTICE + mechanical license filter); stage-1 impulse trigger tuned on **8,015 real
  shots → 97.8% recall** (`tools/shot_eval.mjs`); full Raspberry Pi sensor node + deploy
  scaffolding ([`sensor-node/`](../sensor-node/)). **Key measured finding: phones matched
  dedicated mics for detection (97.7% vs 97.8%)** — the doc's "phones are inadequate" premise
  is false for detection; fixed nodes win on surveyed position/power/placement instead.
  Hardware research → full BOM (school/roof/vehicle) with links. **Vehicle at highway speed is
  an open research problem** (Boomerang caps 60 mph); shipping vehicle node speed-gated. **P1
  needs no GPS/timing hardware.**
