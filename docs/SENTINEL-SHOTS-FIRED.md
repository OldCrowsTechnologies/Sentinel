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

**BOM sketch (per node — refine later):**
- High-SPL MEMS or electret mic rated to ~135–150 dB SPL (no clipping on close shots).
- ADC / codec at ≥48 kHz.
- Compute: Raspberry Pi Zero 2 W / ESP32-S3 class, or reuse the Corvus RF/edge board.
- GPS module (for disciplined time + known position) or wired PTP/NTP for sync.
- PoE or local power; weatherproof enclosure for exterior; tamper switch for schools.
- Uplink: building LAN/Wi-Fi or cell → same Supabase.

**Why fixed:** known position (no localization guesswork), stable power/compute, real mic,
and network time sync — the four things phones can't guarantee.

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

- [ ] Fixed-sensor hardware: reuse the Corvus RF/edge board vs a Pi/ESP32 design? (cost, mic quality)
- [ ] Time-sync method for TDOA: GPS-disciplined vs PTP over building LAN?
- [ ] Buyer/contract: SO vs school district (safety grants) — same C2 tenant or separate org?
- [ ] Evidentiary posture: decision-support only, or pursue court-admissible standards?
- [ ] How far to chase caliber (P4) vs stop at weapon class (P2)?

---

## 12. Next actions

- [ ] P1 mini-spec: finalize fixed-sensor BOM + the `kind:'gunshot'` schema delta + dashboard
      "SHOTS FIRED" alert design.
- [ ] Stand up a data-collection plan + first authorized range capture session.
- [ ] Prototype the impulse-detection front-end + confounder classifier on public datasets.

## Working log
- 2026-07-15 — thread created; unified-C2 architecture decided (gunshot = a `kind`). Reuse
  inventory + phasing + schema delta captured.
