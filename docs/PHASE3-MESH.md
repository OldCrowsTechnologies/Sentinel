# Corvus Sentinel — Phase 3: Offline Mesh & Triangulation (scope)

**Status:** planning / architecture. Phase 1 (acoustic) is built + field-validated;
Phase 2 (RF: Remote ID, SDR/LoRa presence) is scoped in `PHASE2-RF.md` with the
signal core already built (`lib/loraDetect.ts`). This doc scopes turning many
single-phone Sentinels into **one cooperating sensor network** that localizes a
drone by fusing reports across nodes, and using **LoRa as both a sensor and a
long-range mesh backhaul**.

---

## Why mesh

A single phone answers *"is something flying, what is it, and roughly how far?"*
It **cannot** answer *"where is it?"* — one mono mic has no bearing, and an
RMS range estimate is a fuzzy ring, not a point. That single-mic bearing gap is
called out as a hard limitation everywhere in the current docs.

Multiple phones at **known, different GPS positions**, each reporting the same
contact, break that deadlock. Where one node draws a fuzzy range ring, three
overlapping rings intersect at a location. This is the same principle as acoustic
gunshot locators — but built from phones people already carry, with **$0 sensor
hardware**, fully offline.

What mesh buys, in order of value:
1. **Localization** — an actual (lat, lon) + uncertainty ellipse for the drone,
   not just a range band. This is the single biggest capability jump for the product.
2. **Coverage & confirmation** — an area picture instead of one operator's cone;
   two nodes agreeing kills false positives that one node can't rule out.
3. **Resilience** — passive + offline + decentralized → nothing to jam, no
   infrastructure to knock out. This is the EW-resilience story, made literal.

---

## Operating assumption: COMPLETELY OFFLINE

Sentinel deploys in areas where the devices are **fully offline — no internet, no
cell.** This is the *normal* operating condition, not a degraded edge case, and it
constrains every choice below. Nothing in the mesh path may assume a server, a
cloud rendezvous, or a live map fetch.

Two distinct conditions, kept separate (do not conflate them):

- **Offline (no internet/cell) — always assumed.** GPS still works (it's
  receive-only satellite, needs no network). What breaks without internet:
  - **Corvus voice.** The current TTS uses a server-side ElevenLabs proxy
    (`corvusVoice.ts`) — it **will not work offline.** In the field, briefs are
    delivered by **haptics + on-screen text**; this is accepted. **On-device TTS is
    a non-goal** — spoken voice is a back-at-base / connected convenience only. Do
    not claim spoken briefs work offline.
  - **Maps.** Must be **pre-cached per AO** (the offline map + AO-download already
    exists) — no tile server at runtime.
  - **Node discovery.** Must be infrastructure-free. Nearby Connections and Wi-Fi
    Aware pair phones **locally with no internet rendezvous** — that's exactly why
    they're the chosen transports.
  - No specimen upload / sync in the field — it queues offline and drains later
    (already the design).
- **GPS-denied (contested / EW areas) — assume in "certain areas."** This is C-UAS;
  GPS may be jammed on top of being offline. When it is, the mesh cannot use GPS
  for position **or** time, so it falls back to a **mesh-elected reference clock**
  and **relative positioning** (node-to-node geometry), runs **range-only** fusion,
  and **labels the picture as degraded** — never a confident absolute pin built on
  a denied fix. Same no-false-precision discipline as the acoustic range band.

**Design rule:** if a feature needs the internet, it is not in the field path —
it's a back-at-base convenience. The entire detect → mesh → fuse → display →
alert loop must close with the radios in airplane mode and only local links up.

---

## What already exists to build on (real seams)

| Need | Already in repo | Gap to close |
|------|-----------------|--------------|
| Per-node detection | `lib/mlClassifier.ts`, `threatTracker.ts` (`Detection`) | none — feed it to the mesh |
| Per-node position + time | `lib/locationService.ts` (`GeoFix` = lat/lon/accuracy/ts) | none — this is also the clock |
| Contact records carry GPS | `threatTracker.ts` `Threat.lat/lon/locationAccuracy` | none — designed for this |
| LoRa signal processing | `lib/loraDetect.ts` (dechirp + PAPR, unit-tested) | hardware IQ feed (`rfSensorService.processIqFrame`) |
| RF integration seam | `lib/rfSensorService.ts` (`RF_MODULE_AVAILABLE` gate) | mesh transport + node protocol (new) |

The **only genuinely new code** is the mesh layer: a transport, a message format,
a time base, and a fusion/multilateration step. Everything upstream (detect,
classify, stamp with GPS) already produces exactly the inputs it needs.

---

## The physics: how phones actually triangulate

Three methods, worst-to-best accuracy, honest about what each costs. Build the
cheap one first; it degrades gracefully into the good ones.

### A. Range-only multilateration (start here — no new sensing)
Each node already estimates distance (RMS-based, in `mlClassifier.ts`). For a
candidate drone position **p**, each node *i* at GPS **xᵢ** predicts a range
‖p − xᵢ‖ and compares it to its measured range rᵢ. Score every candidate on a
grid (or with a particle/Gauss-Newton solve) by summed squared range error,
weighted by each node's confidence. The minimum is the estimate; the curvature
around it is the uncertainty ellipse.

- **Needs:** ≥3 nodes with overlapping detections of the same contact.
- **Accuracy:** only as good as the RMS range, which is rough and needs per-device
  calibration (`refRms`/`refDistanceFeet`). Expect a *region*, not a pinpoint —
  but a region is already far beyond what one phone gives.
- **Why first:** uses data the app already produces. Zero new signal processing.

### B. TDOA / hyperbolic multilateration (the accuracy ceiling)
Don't use *how loud* — use *when* the same acoustic event arrives at each node.
Time differences between nodes define hyperbolas; their intersection is the
source. This is how ShotSpotter-class systems get meters-level accuracy.

- **Needs:** (1) a shared clock across nodes tight enough that timing error ×
  speed-of-sound is small — sound moves ~343 m/s, so **1 ms of clock skew ≈ 0.34 m**
  of position error, very forgiving compared to RF TDOA; and (2) a way to
  recognize *the same* acoustic event at multiple nodes (cross-correlate a shared
  signature window, e.g. a blade-pass transient).
- **Hard parts:** phones are tens–hundreds of meters apart, so the same event is
  faint/absent at distant nodes; correlating rotor noise (quasi-periodic, not a
  sharp impulse) is harder than correlating a gunshot. Realistic as a **v2**
  once range-only is proven and nodes are time-synced.
- **Payoff:** turns "region" into "point." This is the upgrade that makes the
  localization claim genuinely strong.

### C. Angle-of-arrival fusion (if/when nodes get bearing)
If a node ever gains bearing — stereo mic + cross-correlation (backlog task 6),
or a directional RF antenna (Tier-3, `PHASE2-RF.md`) — each node contributes a
*ray*, and rays from two nodes intersect. AoA + range together (even from 2
nodes) localizes well. Fold this in as nodes acquire the capability; the fusion
engine should accept per-node **range, and/or bearing, and/or TDOA** and use
whatever it's given.

**Design rule:** the fusion engine consumes a *likelihood contribution* per node,
not a fixed measurement type. Range → annulus likelihood; bearing → wedge; TDOA →
hyperbola. That keeps A/B/C as the same solver with different terms, so upgrading
sensing never means rewriting fusion.

---

## Mesh transport — two tiers, because range and bandwidth trade off

Nodes are offline and spread across an area of operations. No single radio covers
both "phones clustered at a checkpoint" and "phones spread across a km of
perimeter." Use two, matched to the LoRa dual-role insight below.

### Tier S — short range, high bandwidth (nodes near each other)
- **Android Nearby Connections** (P2P Wi-Fi + BT, no internet) or **Wi-Fi Aware
  (NAN)**. Tens–~100 m, hundreds of kbps.
- Carries **full** contact reports, shared audio signature windows for TDOA
  cross-correlation, track-table sync, and operator chat/markers.

### Tier L — long range, low bandwidth (nodes across the AO)
- **LoRa transceiver** (SX127x/126x) or the SDR. Kilometers, but only tens of
  bytes per second. Carries **compact** contact beacons only (see message format).
- **The dual-role insight:** the *same* LoRa hardware Phase 2 wants for *detecting*
  drone control links can also *carry* the mesh backhaul between distant nodes.
  One add-on, two jobs.
- **Honest constraint:** one LoRa radio can't listen for drone chirps and transmit
  mesh traffic at the same instant. You get one of:
  (a) **time-division** on a single radio — mostly-listen, brief scheduled TX
  windows for beacons (cheap, slightly hurts detection duty cycle); or
  (b) **two radios** — one RX-only for detection, one for mesh (best, more cost/power).
  Start with (a); document the duty-cycle cost honestly.

A node with no LoRa still participates over Tier S; LoRa nodes bridge clusters.

---

## Time base — GPS is the free shared clock

Every node already pulls a GPS fix (`locationService.ts`), and **GPS carries time,
not just position.** That gives all nodes a common time reference without any
network sync protocol — the natural clock for (a) ordering/merging reports and
(b) TDOA later. Caveats to handle honestly:
- Expo's location timestamp is coarser than raw GPS PPS; good enough for
  report ordering and range-only fusion, **marginal for tight TDOA**. If TDOA
  needs better, that's a native GPS-time / PPS module — a known, scoped upgrade.
- **GPS-denied fallback:** if GPS drops, nodes fall back to a mesh-elected
  reference clock (e.g. NTP-style exchange over Tier S) and range-only fusion,
  and the app **says so** — degraded mode, not silent bad data. Same honesty
  discipline as the acoustic range band.

---

## Data model — the contact report

One compact, self-describing message, small enough to survive a LoRa payload
(target ≤ ~40 bytes packed; the JSON below is the logical shape).

```jsonc
{
  "nodeId": "a3f1",          // stable per-device short id
  "seq": 1024,               // monotonic per node (dedup / loss detection)
  "t": 1751490000000,        // GPS-based epoch ms (shared clock)
  "lat": 40.6895, "lon": -74.1745, "posAcc": 6,   // node fix + accuracy (m)
  "type": "Skydio X2",       // classifier label
  "conf": 0.91,              // 0..1
  "rangeFt": 210, "rangeSd": 90,   // estimate + honest 1σ
  "bearing": -1,             // -1 = none (mono mic); else degrees
  "unknownBuild": false,     // open-set flag (the differentiator)
  "kind": "acoustic"         // acoustic | rid | lora | wifi  (sensor fusion)
}
```

Notes:
- Mirrors `threatTracker.Detection` almost field-for-field — it's that record plus
  a node id, sequence, and sensor `kind`. Minimal new surface.
- `rangeSd` carries **uncertainty explicitly** so fusion can weight a confident
  close contact over a vague distant one — and so the UI never shows false precision.
- `kind` lets the same pipe carry acoustic **and** RF (Remote ID, LoRa presence,
  Wi-Fi OUI) detections. Mesh fusion and sensor fusion become one mechanism.

---

## Fusion architecture — decentralized, no single point of failure

Every node runs the same loop; there is no required "server." This is the
resilient/jam-proof story in software form.

```
per node:
  local detect (acoustic / RF)  ──► local Detection (+GPS +time)
        │                                    │
        │ broadcast contact report           ▼
        ├──────────────► Tier S / Tier L ───► neighbors' reports in
        ▼                                    │
  shared TRACK TABLE  ◄──── merge (by type + space-time proximity) ◄──┘
        │
        ▼
  MULTILATERATION (method A now; B/C as sensing allows)
        │
        ▼
  fused tracks: (lat, lon, uncertainty ellipse, type, contributing nodes)
        │
        ▼
  UI: map pins + ellipses (MapScreen) · alerts · ATAK/CoT out (PHASE2-RF.md)
```

- **Track table merge** generalizes today's single-node dedup (`findExisting`
  keys on type + distance) to *cross-node* dedup: same type, overlapping
  space-time → one track fed by many nodes.
- **Any node can be the fusion viewer**; all nodes converge to the same picture
  because they see the same reports. A node dropping out just thins coverage.
- **Output reuses what's built:** fused tracks render on the existing offline
  `MapScreen` (range rings become uncertainty ellipses), and drop straight into
  the ATAK / Cursor-on-Target export already flagged as the military unlock.

---

## Suggested build order

1. **Node protocol + Tier S transport.** Define the contact-report message; ship
   detections over Nearby Connections between 2–3 phones. *Done when:* one phone
   sees another's live detections on its own screen.
2. **Range-only fusion (Method A).** Cross-node track merge + grid/least-squares
   multilateration; render fused position + uncertainty ellipse on `MapScreen`.
   *Done when:* 3 phones around a real drone put a pin within the ellipse.
3. **GPS time base + honest degraded mode.** Shared-clock ordering; GPS-denied
   fallback that labels itself. *Done when:* fusion is stable and mode is visible.
4. **Tier L / LoRa backhaul (dual-role).** Compact beacons over LoRa with
   time-division against detection; bridge two phone clusters. *Done when:* a
   contact detected by a far cluster appears on a cluster a km away.
5. **(v2) TDOA (Method B).** Shared signature windows + cross-correlation for
   meters-class localization. *Done when:* TDOA tightens the ellipse vs range-only
   on the same setup, measured.
6. **(as available) AoA (Method C).** Fold in stereo bearing (backlog #6) or
   directional-antenna bearing (Tier-3) as extra fusion terms.

---

## Honesty guardrails (carry into every pitch)

- **Localization accuracy scales with node count and geometry.** 1 node = range
  band (today). 2 = a region. 3+ well-spread = a real fix. Say the number of
  nodes and show the uncertainty ellipse — never a bare pin.
- **Range-only is rough** until RMS range is calibrated per device; the ellipse
  must reflect that. TDOA is the path to tight, and it's honestly a v2.
- **LoRa can't detect and mesh on one radio simultaneously** — it's time-division
  or two radios. State the duty-cycle cost.
- **GPS-denied = degraded mode, labeled as such.** No silent bad positions.
- **Mesh doesn't change what acoustic can/can't hear** — it fuses more listeners;
  it doesn't extend one mic's range. Same sensor-fusion framing as `PHASE2-RF.md`:
  each tier catches a different threat class, none alone is complete.

---

## IP note

The single-mic classifier is likely clear of existing patents (per the Asset
Summary), but **multi-modal fusion + offline mesh triangulation is exactly the
layer where a freedom-to-operate search is warranted** and where a provisional
has the most value. This document describes that layer — treat it as
file-before-you-demo material. (Not legal advice — for IP counsel.)
