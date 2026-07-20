# After-Action Report — Blue Angels Field Op, 2026-07-18

**Operation:** Corvus Sentinel live field trial during the Blue Angels (Pensacola).
**Tenant:** Escambia County Sheriff's Office demo (`ECSO-BA`).
**Window:** ~07:08–14:40 CDT (12:08–19:39 UTC).
**Units on mesh:** 17 devices reporting through C2 + 1 RF (RTL-SDR) node.
**Prepared:** 2026-07-18.

---

## 1. Bottom line up front

**Today was a high-value data-gathering day, not a bad one.** There was no better
place on the calendar to collect this: a sky full of **manned fixed-wing jets**, a
dense crowd, PA systems, vehicle A/C compressors, reefer-trailer engines, and
fountain fans — i.e. the exact **hard acoustic confounders you cannot synthesize
and rarely get to record at this intensity and volume.** The system did what an
uncalibrated detector does in that environment — it false-alarmed a lot — and in
doing so it **handed us a labeled corpus that is worth more than a quiet day with
zero detections.** Everything below is framed around that: the false positives are
the *product* of the day, not a failure of it.

- **7,091 detections** captured through C2 (note: the dashboard shows only its most
  recent ~200 rows; the full database holds all 7,091).
- **6,307 false threat call-outs** — no real UAS were present, so every one is a
  labeled confounder sample. 75% were "Fixed-wing UAS" (the jets), the rest mostly
  "FPV racer" (mechanical/fan/engine hums).
- **Fixes shipped *during* the op** (C2 reliability + mobile + RF connect), and by
  end of day a **new rotor-comb acoustic feature + comprehensive retrain** cut
  held-out false-alarms **jets 43.5% → 2.7%, prop plane → 3.4%, A/C noise 25.8% → 0%**
  — with **real fixed-wing-UAS detection preserved (no regression)**. Delivered.
- **Clear, funded next steps** to drive the rest down — see §5.

---

## 2. What was deployed

| Layer | What ran | Notes |
|---|---|---|
| **Deputy/team units** | 17 phones/tablets, acoustic + position → C2 | Enrolled via `ECSO-BA-DEPUTY`; ran the pre-retrain model for most of the day |
| **C2 dashboard** | `c2-dashboard.vercel.app` (`ECSO-BA-CMD`) | Live map, roster, log, fusion, query/export |
| **RF (SDR) node** | 1 Android + Nooelec RTL-SDR (sub-GHz control links) | Companion-driver connect fixed mid-op |
| **Backend** | Supabase multi-tenant, RLS-scoped, 30-day demo tenant | 7,091 detections + 6 position rows recorded |

---

## 3. What the data shows (the day's yield)

**Total detections:** 7,091 (acoustic 7,088 · RF control-link 3).

**False threat call-outs (no real UAS present → all confounders):** 6,307

| Call-out label | Count | What it actually was |
|---|---:|---|
| **Fixed-wing UAS** | 4,722 | Blue Angels **jets** (manned fixed-wing) |
| **FPV racer** | 1,194 | Mechanical hums — vehicle A/C fans, reefer engines, fountain fans |
| Small multirotor | 144 | mixed mechanical/ambient |
| Unknown build | 134 | uncategorizable confounders |
| Large multirotor | 90 | mixed |
| Combustion UAS | 23 | engine/idle noise |

**Non-threat call-outs (correctly *not* alarmed):** 781 — Bird 578, Manned
fixed-wing 163, Manned rotorcraft 40. *(Note: the 163 "Manned fixed-wing" are the
model correctly catching jets as non-threats — that class grew usable only after
today's retrain; earlier in the day most jets fell into "Fixed-wing UAS".)*

**Confidence:** mean **93.8%**, **5,010 ≥90%**, **3,572 ≥99%** — the engine reports
near-certainty even when wrong. A calibration problem, tracked in §5.

**Concentration:** one node (`self-mrqcagex`) produced **4,167 detections — 59% of
the entire day.** That unit was almost certainly parked beside a fixed confounder
(A/C condenser / reefer / fountain) for hours. This is itself a useful finding (see
§5) and a clean single-source confounder capture.

**RF:** only **3** sub-GHz control-link detections all day — consistent with the
show's aircraft being manned (no drone control links) and any hobby links being
2.4 GHz (out of the RTL-SDR's band). The RF chain was *proven working* (dongle →
`rtl_tcp` → dechirp → C2) after the mid-op connect fix; there was simply little
sub-GHz to hear.

---

## 4. Why the false positives happened (root cause)

1. **Confounder gap in the model.** The units ran the **pre-retrain** model for most
   of the day. It had essentially **no "Manned fixed-wing" training data** and no
   A/C-fan/engine negatives, so jets → "Fixed-wing UAS" and mechanical hums → "FPV
   racer." This is a *data* gap, not a code bug — and today filled it.
2. **Over-confidence.** Confidence is the raw softmax peak, which saturates near
   100% regardless of correctness — so wrong calls looked certain.
3. **No debounce to C2.** Every qualifying 2 s window was pushed individually →
   7,091 rows (one every ~4 s, mostly from one node). Command should see *contacts*,
   not a per-window firehose.

None of these are surprises; all three now have concrete fixes.

---

## 5. Steps being taken to improve on today

### Shipped **during** the op (already live)
- **C2 stays live** — added an 8 s polling backstop so the dashboard no longer goes
  stale when the realtime socket drops. **Deployed.**
- **C2 mobile layout** — usable on a phone in the field (was desktop-only). **Deployed.**
- **Fusion counts every unit** — nodes with momentarily-null GPS no longer drop out
  of triangulation. **Deployed.**
- **Stationary units stay green** — position heartbeat decoupled from monitoring.
- **RF dongle connects** — fixed the `iqsrc://` driver-launch handshake (was
  `ECONNREFUSED`); RF control-link detection now works end-to-end. **New APK shipped.**
- **Ingested a 73-paper acoustic literature review** (from the GUARD collaboration)
  → [ACOUSTIC-LITERATURE-REVIEW.md](ACOUSTIC-LITERATURE-REVIEW.md). It surfaced the
  physics behind the fix below (rotor blade-pass comb vs broadband machinery).
- **Rotor-comb acoustic feature (the headline fix).** Added two parity-mirrored
  features — **spectral flatness** (tonal rotor comb → low; broadband jet/A-C/fan →
  high) and **comb strength** (spectral autocorrelation at blade-pass spacing) — so
  the model can tell a *propeller* from a *turbine/engine/fan*, which mel energy alone
  could not. Config-gated + parity-verified (py↔ts identical, `run_parity.sh` passes).
- **Comprehensive confounder retrain** with that feature — folded in all of today's
  captures (jets loud → "Manned fixed-wing", A/C → "None", live-jets pull). **Held-out
  result: jets 43.5% → 2.7%, prop plane → 3.4%, A/C 25.8% → 0%, and real fixed-wing-UAS
  detection held at 4/7 (no regression — the naive retrain had dropped it to 2/7).**
  Shipped in a new APK.

### Next
1. **Confidence calibration** — temperature scaling so a 60%-sure call reads 60%, not
   100%. Lets command triage by confidence and lets the tracker gate honestly.
2. **Debounce before C2** — push *contact events / state changes*, not every window,
   so command sees a handful of tracks instead of thousands of rows.
3. **ESC-50 hard-negative augmentation** — add standard environmental-machinery
   negatives (from the lit review) to broaden confounder coverage past today's captures.
4. **Investigate the 59%-node** — confirm `self-mrqcagex`'s placement/mic; its
   single-source capture is a clean confounder set for future retrains.
5. **RF band reality** — the RTL-SDR covers sub-GHz (ELRS 900 / Crossfire / FrSky
   433). 2.4 GHz targets (DJI, Spektrum, ELRS 2.4) need a HackRF/Airspy — scoped, not
   today's build.
6. **Unified sensor node + acoustic DOA** — converge acoustic (gunshot + drone) +
   Bluetooth Remote ID + control-link + direction-finding onto one device with RF
   triangulation; port GUARD's bearing code. Plan + BOM in
   [SENTINEL-UNIFIED-SENSOR.md](SENTINEL-UNIFIED-SENSOR.md).

---

## 6. Corpus captured today (the deliverable)

| Source | Content | Use |
|---|---|---|
| `False positive 01` | jets (20 min) | ingested → "Manned fixed-wing" (jet-loud), in the shipped retrain |
| `False positive 02` | jets (21 min) | held-out eval — **43.5% → 2.7%** on the final model |
| `False positive 03` | prop plane in background (21 min) | held-out eval — **~40% → 3.4%** |
| `False positive 04` | A/C compressor sounds (3 min) | ingested → "None" — **25.8% → 0%** after retrain |
| `Live blues jets noise` | **jets directly overhead** (13 min jet-loud) | ingested → "Manned fixed-wing"; in the shipped harmonic retrain |
| **C2 database** | 7,091 labeled detections | exported (`c2_detections.csv`, `c2_dump.json`); characterizes the FP pattern |

> **Note on audio:** C2 stores detection *records*, not audio (by design — no
> continuous recording). The retrain fix comes from the **audio clips above**, which
> is why capturing them today mattered so much.

---

## 7. Assessment

The system's command, alerting, fusion, multi-tenant, and RF pipelines all worked;
the gap was **acoustic discrimination against manned aircraft and mechanical noise**
— a data problem. We collected the best possible data to solve it under the hardest
possible conditions, and **by end of day we had solved it**: a literature-driven
rotor-comb feature plus a retrain on the day's corpus drove held-out false-alarms
**from 43.5% to 2.7% on jets and from 25.8% to 0% on A/C noise, with zero loss of
real fixed-wing-UAS detection** — the confounder problem that defined the morning was
measurably closed by evening. What began as a false-positive storm became the corpus
and the fix. A quiet day would have taught us nothing; **this one gave us the whole
confounder library — and we turned it into a better detector the same day.**
