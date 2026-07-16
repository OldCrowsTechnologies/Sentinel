# Sentinel Shots Fired — Pricing, Margin & Acquisition Model

> How we price to **undercut ShotSpotter**, **outsource install + maintenance**, and
> still profit — worked against the Escambia County program
> ([case study](SENTINEL-ESCAMBIA-CASE-STUDY.md)). Structure: the customer **owns
> the hardware** (one-time capex) and pays an **annual service** (C2 + monitoring +
> maintenance); the **Crow's Eye survey** is a third revenue line that also lands the
> install. Hardware is priced thin to win; the **recurring service + survey are the
> margin engines** — per the revenue-model decision.

**Confidence:** benchmarks are tagged. The **four numbers to close with live quotes**
(flagged throughout) are exact volume component prices/lead-times, real per-vehicle
upfit labor, the contract-manufacturer per-unit quote, and in-house build throughput.
Nothing here is a committed price — it's the model and its levers.

---

## 1. What we're undercutting

ShotSpotter/SoundThinking is a **per-square-mile annual subscription**, always rented,
never owned:

- **$65K–$90K per mi²/yr + ~$10K/mi² one-time** [SECONDARY, multi-source]; **NYC
  $85,097/mi²/yr, 3-yr term** [VERIFIED, NYC Comptroller]. Bundles sensors + cloud +
  the 24×7 human review center.
- Because it's ~$65–90K/mi²/yr, cities can only afford small **hot-zone** coverage
  (a few to ~50 mi²) — they **cannot blanket a county**, and they own nothing at the end.

**That is the wedge:** owned hardware, county-wide (interiors + county buildings +
mobile), for a fraction of the multi-year rent.

---

## 2. Build cost per node (materials + build labor)

Two build phases. **Hand-built now** (Josh assembles; ~$25/unit labor+QA+overhead at
~20 units/person/day [ESTIMATE — validate with a pilot time-study]); **contract-
manufactured later** (box-build **$15–40/unit consignment**, NRE $600–1,750 negligible
at volume [VERIFIED]). Volume component discounts are **10–25% on silicon/modules but
~0% on the Pi Zero** (retail is subsidized — a real exception) [VERIFIED].

| Node type | Materials | + Build | **Cost** |
|---|---:|---:|---:|
| Indoor leaf | $150 | $25 | **$175** |
| Indoor gateway | $230 | $25 | **$255** |
| Roof gateway | $270 | $30 | **$300** |
| Vehicle | $290 | $30 | **$320** |
| Drone | $55 | $15 | **$70** |

> **Phase note:** hand-build is fine for the pilot + Phase 1 (courthouse + 15 schools,
> ~340 units). At the county-scale 1,000+ run, move to a CM — it drops per-unit labor,
> frees Josh's time, and early-phase revenue funds the tooling. This is the "until I can
> manufacture them" crossover.

---

## 3. Escambia program — the three revenue lines

Node counts from the [case study](SENTINEL-ESCAMBIA-CASE-STUDY.md): **952 leaves,
100 gateways, 250 vehicles, 10 drones** (~1,312 endpoints, ~90 buildings).

### 3.1 Hardware — capex, one-time (priced thin to win)

Cost = 952·$175 + 100·$255 + 250·$320 + 10·$70 = **$272,800**. Sell at **1.25×**
(keep capex low + grant-friendly):

| | Cost | Sell (1.25×) | Gross |
|---|---:|---:|---:|
| **Hardware** | $272,800 | **~$341,000** | ~$68,000 (20%) |

### 3.2 Install + Crow's Eye survey — one-time services

- **Install (outsourced):** ceiling node **$100–200/drop, ~1–2 hr** [VERIFIED];
  vehicle upfit **~2–4 hr** [ESTIMATE — get an upfitter quote]. Cost ≈ 1,052·$125 +
  250·$300 = **$206,500**. Sell at **1.30×** → **~$268,000** (gross ~$62K). Install is
  50–70% of a security-system budget [VERIFIED] — so this is a real line, marked up, not
  a rounding error.
- **Crow's Eye survey** (~90 buildings): the LiDAR scan → placement + coverage map (the
  acceptance doc). Sell ~$1,100/building avg → **~$99,000** (cost ~$27K → **gross ~$72K,
  73%**). High-margin, and it de-risks + lands the install.

### 3.3 Annual service — recurring (the margin engine)

C2 hosting + monitoring + maintenance. Benchmark: **10–15% of installed value/yr**
[VERIFIED], or RMM **$1.50–5/device/mo** [VERIFIED] + truck rolls **$200–500 (up to
$1,000 loaded)** [VERIFIED]. Cost ≈ RMM ($3·1,300·12 = $47K) + C2 hosting (~$10K) +
support & amortized truck rolls (~$43K) ≈ **$100K/yr**.

**Price $150K/yr** (gross ~$50K, 33%). Note the ceiling: even **$200K+/yr** stays
trivial next to ShotSpotter, so there's real headroom as the recurring engine matures.

> **Battery-replacement cadence is the #1 maintenance-cost lever** [VERIFIED — truck
> rolls dominate]. LiFePO4 cycle life (and whether nodes get trickle building-power vs
> pure battery) directly sets the truck-roll rate. Design decision, not an afterthought.

---

## 4. Program totals & margin

| Line | Customer pays | OCWS gross |
|---|---:|---:|
| Hardware (capex) | ~$341,000 | ~$68,000 |
| Install (outsourced + markup) | ~$268,000 | ~$62,000 |
| Crow's Eye survey | ~$99,000 | ~$72,000 |
| **One-time subtotal** | **~$708,000** | **~$202,000** |
| Annual service (×5 yr) | ~$750,000 | ~$250,000 |
| **5-year total** | **~$1,458,000** | **~$452,000** |

**Blended 5-yr margin ≈ 31%** — healthy, covers outsourced install (built into the
install line), and the recurring service compounds. **The hardware is near-cost to win;
the profit is in survey + recurring** — exactly the intended structure. And the whole
model **repeats per county**, with CM economics improving margin at scale.

---

## 5. The billing argument — 5-year TCO

| | Coverage | 5-year cost | Owned? |
|---|---|---:|---|
| **ShotSpotter** (20–50 mi² urban core) | outdoor gunshot only, hot zones | **~$7M – $18M** (recurring, $65–90K/mi²/yr) | No — rented |
| **Sentinel** (county-wide) | interiors + county bldgs + mobile, **whole county** | **~$1.5M** (capex + 5×service) | **Yes — owned** |

**~5–12× cheaper over five years, for far more coverage, and the county owns it.** Plus
auditable accuracy (public CC-BY corpus, re-runnable harness — 97.8% recall) and one
command picture (drones + gunshots + mobile). *(ShotSpotter mi² figures SECONDARY except
NYC's $85K/mi²/yr VERIFIED; the exact ShotSpotter footprint Escambia would buy is
hypothetical — the point is the structural gulf, not a precise competitor quote.)*

---

## 6. Acquisition timeline — contract close → installed

Stages overlap (procure while finalizing CM; install in waves as units come off the
line). Ranges from the supply research [VERIFIED for procure/assemble; install ESTIMATE].

| Stage | Hand-build phase (pilot / Phase 1) | CM phase (county scale) |
|---|---|---|
| **Procure components** | 2–6 wk (commodity in stock) | 4–12 wk (longest-lead part sets floor) |
| **Assemble + QA** | ~2–4 wk (Josh, ~300 units) | 4–8 wk (repeat) / 8–12 wk (first CM build) |
| **Crow's Eye survey + schedule** | 3–6 wk | 4–8 wk (90 buildings) |
| **Install (outsourced crews)** | 2–4 wk (15 schools) | 6–16+ wk (crew-count dependent) |
| **Net close → installed** | **~2–4 months** (a phase) | **~4–7 months** (full county) |

**Install throughput math:** 1,300 fixed nodes ÷ (2-tech crew × ~6 nodes/day × 5 days)
≈ 22 crew-weeks → **~11 wk with one crew, ~4–5 wk with 2–3 crews**; +250 vehicles at
2–4 hr ≈ 60–125 vehicle-days. **Crew count is the install-schedule lever.**

**Two real schedule risks** (both need live quotes, not guesses): (1) a long-lead
component you haven't quoted — the shortage is over but **verify Pi + SX1262 + MEMS mic +
cells at DigiKey/Mouser** [flagged unknown]; (2) install-crew availability across dozens
of county sites.

---

## 7. Supply lines

- **Shortage is over** (2021–23); the 2025–26 headwind is **memory-price inflation**, not
  availability [VERIFIED]. Pi stock normalized via authorized distributors.
- **Verified:** SIM7080G cellular **~$8.50/unit @ 1k, ~2-wk lead** [VERIFIED]. **Pi Zero
  2 W ~$15 flat — no volume discount** [VERIFIED, plan for it].
- **Verify-live before ordering at volume:** exact 2026 lead-times/prices for Pi 4/CM4,
  SX1262 LoRa, MEMS mic, 18650/LiFePO4 cells — no authoritative live figure available at
  research time [flagged].
- **Contract manufacturing:** NRE $600–1,750 (negligible at 1k), box-build $15–40/unit
  consignment, lead 4–8 wk (8–12 first build) [VERIFIED]. Get one real CM quote to firm
  the per-unit and the Phase-2 crossover.

---

## 8. The four numbers to close before this is a quote

1. **Live volume component prices/lead-times** (Pi, SX1262, MEMS mic, cells) — DigiKey/Mouser.
2. **Real per-vehicle upfit labor** — quote from a public-safety upfitter (MCA, Day Wireless).
3. **CM per-unit box-build quote** at ~1,000 units — sets Phase-2 margin.
4. **ECSO standing fleet count** (case study §5) — scales the mobile tier + install linearly.

Everything else in this model is grounded; these four turn it from a model into a bid.
