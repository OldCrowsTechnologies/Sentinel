# Corvus Sentinel — Build List (post-demo backlog)

Running list of capabilities to build after the ECSO Blue Angels demo. Newest at
the top. Each item: what it is, why, the approach, and rough effort.

---

## 1. Gunshot detection & localization (acoustic) — likely separate product/contract

**Status:** planned (post-demo). **Highly requested by ECSO; life-safety.**

**Concept.** Reuse the Sentinel acoustic + C2 + fusion platform to detect gunfire, push
an **instant C2 alert (faster than a 911 call)**, classify weapon type (rifle / handgun
/ shotgun), and — with multiple sensors — **triangulate the shot location**. Sensors:
dedicated **fixed mics in schools / county buildings** and/or unit-mounted mics.
(Detection needs MICROPHONES; external *speakers* on units are an optional
warning/deterrence **output**, not part of detection.)

**END GOAL: runs through the SAME C2 as drone detection.** This is the key architectural
decision. The C2 already carries a *generic* detection: the `detections` table + the
`ContactReport` type both have a **`kind`** field (today: acoustic / rid / lora / wifi). A
gunshot is just **`kind = 'gunshot'`** with the weapon class in `label`, energy in `peak_db`,
and lat/lon/range like any other contact. So a gunshot event flows into the **same map, log,
instant alerting, per-agency isolation, and (with joint-ops) mutual aid** with only a small
schema/UI addition — NOT a second system. One command picture: drones + gunshots + whatever
comes next. That unified pane is the product moat.

**What Sentinel already gives for free (the head start):**
- **C2 tier** (cloudSync + Supabase + realtime + dashboard): instant alerting, live map,
  per-agency isolation — reusable as-is. The "faster than 911" alert path already exists.
  Gunshot events reuse it via the `kind` field (above); dashboard adds a gunshot marker/alert
  style + a "shots fired" banner.
- **On-device ML + DSP + training pipeline** (`mlClassifier`, `dsp`, `train_corvus`): the
  scaffolding retargets from drone rotor signatures to gunshot signatures.
- **Multilateration/fusion engine** (`meshFusion`): reusable solver that already
  anticipates TDOA terms ("same solver, different rows").

**The hard parts (honest — this is its own product, not a bolt-on):**
1. **Impulse capture.** Gunshots are ~1–3 ms, 140–165 dB transients. Phone mics AGC/clip
   and sample at 16 kHz — inadequate. Needs higher sample rate + high-SPL-capable mics →
   favors **dedicated fixed sensors** over phones.
2. **Low false positives.** Gunshot vs firework vs backfire vs door-slam is the domain's
   Achilles heel (cf. ShotSpotter controversy). Needs a large labeled corpus of real
   gunfire + confounders. Detection is achievable; low-enough FP for life-safety is the work.
3. **Weapon-ID limits.** Rifle / handgun / shotgun is plausible (muzzle energy + supersonic
   shockwave). **Exact caliber is research-grade — do NOT headline it.** Sell "class +
   confidence," not "it's a .223."
4. **TDOA triangulation.** Localization uses time-difference-of-arrival needing sub-ms clock
   sync across sensors (sound ≈ 343 m/s → 1 ms ≈ 0.34 m). **Fixed, networked sensors with
   GPS/PTP time + known positions make this tractable; mobile unsynced phones do not** —
   which is exactly why the schools/buildings fixed-sensor idea is the right architecture.
5. **Validation + liability.** Life-safety + legal exposure (wrongful dispatch). Requires
   rigorous accuracy validation and "decision-support aid, not authoritative" positioning.

**Recommended architecture:** a **fixed dedicated-sensor** line (small edge node: high-SPL
mic + compute like the existing RF/edge hardware or a Pi/ESP32-class board, GPS time, known
location) feeding the SAME C2. Phone-based detection as a secondary best-effort layer.

**Phased lift:**
- **P1 — single-sensor DETECT + instant C2 alert (no location).** Reuses classifier
  framework + C2. Medium lift + data collection. Highest life-safety value per effort.
- **P2 — weapon-class (rifle/handgun/shotgun) + confidence.** More data; medium.
- **P3 — fixed-sensor TDOA triangulation.** Hardware + time sync + TDOA solver. Medium-high.
- **P4 — caliber estimate.** R&D; may not reach reliable accuracy — flag as stretch.

**Overall lift:** a serious multi-month **R&D + hardware** effort and its own product/
contract — but the C2/alerting/fusion backbone being done removes a large chunk, and the
fixed-sensor framing is very buildable. Fastest high-value slice: **P1 (detect + instant
alert)** reuses most of the platform and delivers the "faster than 911" value quickly.

**Data need:** labeled gunfire corpus (weapon types, distances, indoor/outdoor) + confounders
(fireworks, construction, backfire). Academic datasets + range captures; mirror the Fritz
field-capture approach.

---

## 1b. Acoustic direction-finding (DOA) via mic-array sensor node

**Status:** planned. From the UWF **GUARD/Vigil** work (see
[GUARD-VIGIL-INTEGRATION.md](GUARD-VIGIL-INTEGRATION.md)). Mic array (ReSpeaker/UMA-8) +
SRP-PHAT/GCC-PHAT gives **true acoustic bearing** — closes Sentinel's #1 gap (single-mic =
no direction) and feeds the Shots-Fired TDOA plan. Belongs on the **external sensor node**
(phones lack the array). High value.

## 1c. Proper HF-dataset model integration (class-weighted)

**Status:** planned. The MIT `geronimobasso/drone-audio-detection-samples` (180k clips) is a
real asset, but a naive retrain regressed fixed-wing detection (100%→17–33%). Needs
class-weighted/balanced training + real-clip held-out tuning, NOT a dump. Tooling +
findings in [GUARD-VIGIL-INTEGRATION.md](GUARD-VIGIL-INTEGRATION.md). Build-11 stays live.

## 2. Multi-agency joint operations / geofenced mutual aid

**Status:** planned (post-demo)
**Raised:** during ECSO demo build, considering Santa Rosa SO as a second customer.

**The need.** Each agency is its own tenant and must stay isolated by default —
Escambia SO must not see Santa Rosa SO's routine activity, and vice versa (already
enforced by Row-Level Security). BUT in shared areas of responsibility (e.g.
Pensacola Beach during a joint event), deputies from both agencies need to see each
other's units and interact on one picture.

**Current state.**
- Hard per-agency isolation is already enforced in the database (RLS via
  `my_org_ids()`), so the "don't leak everyone's routine ops to each other" half is
  done the moment each agency is its own org.
- Cross-agency visibility is NOT built — isolation is currently total.

**Interim (works today, zero code):** the **Joint-Operation org** pattern. Stand up
a shared org (e.g. "Pensacola Beach Joint Ops"); participating deputies from both
agencies enroll into it for the event, and both commands log into its C2 with a
joint command code. Everyone in the joint op sees everyone in it; neither sees the
other agency's routine (home-org) activity. This is the classic task-force / unified-
command model and needs only seat codes. Use this for the first joint deployments.

**The real build (this item):** **geofenced mutual aid.** A standing sharing
agreement between adjacent agencies where any unit **physically inside a defined
shared zone** (the joint AO) automatically becomes visible to the partnering agency,
while everything outside the zone stays private — no manual "switch to joint mode."

Design sketch:
- A `sharing_agreements` table (org_a, org_b, shared polygon/zone, active window).
- A `zones` concept (GeoJSON polygon per shared AO).
- RLS extension: a command/deputy may read another org's `positions`/`detections`
  rows **only** when the row's lat/lon falls inside an active shared zone between the
  two orgs. (Postgres can do point-in-polygon in RLS via PostGIS, or a precomputed
  `in_zone` flag stamped on write.)
- Realtime: same filtering applied to the subscription payloads.
- C2 UI: shared units render with an agency tag/color so command can tell whose is
  whose; a toggle to show/hide partner units.

**Why it matters commercially:** "buy it for your county, and it still works when you
back up your neighbors" — a real differentiator when selling to adjacent SLTT
agencies. Turns each sale into a lever for the next.

**Effort:** medium. RLS + a sharing/zone layer + modest C2 UI. The data model already
supports multi-org membership, so much of the plumbing is reusable.
