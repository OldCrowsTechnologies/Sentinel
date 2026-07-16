# Sentinel Shots Fired — Escambia County Deployment Case Study

> A modeled county-wide rollout for **test and billing**: what gets covered, how
> many units, and materials cost. Three tiers — **county facilities, schools,
> mobile** — on one C2. Companion to [SENTINEL-HARDWARE-BOM.md](SENTINEL-HARDWARE-BOM.md)
> (per-node parts) and [SENTINEL-SHOTS-FIRED-ARCH.md](SENTINEL-SHOTS-FIRED-ARCH.md)
> (how it works). Visual coverage package: the published artifact.

**Confidence:** figures are tagged where sourced. The **two soft numbers** are (1)
per-building node counts — planning heuristics until a **Crow's Eye LiDAR survey**
produces exact counts + a coverage map (ARCH §10.5), and (2) the **ECSO fleet
size**, which is not published and needs a records request. Everything else is from
the district / county / ECSO / Census. Costs are **materials only** — they exclude
install labor, monitoring software, and margin.

---

## 1. The customer and the opening

- **Buyer:** Escambia County Sheriff's Office (ECSO) — ~229 patrol deputies, ~400+
  sworn, **6 precincts**, ~$102 M/yr budget, 300,000+ calls/yr. [sources: escambiaso.com, WEAR-TV]
- **The opening is already there.** In **April 2024** the school district deployed
  **OPENGATE weapons detectors to every middle and high school** — ~25 units at
  ~$16,000 each (~$400 K), funded by an **FLDOE physical-security grant**. [WEAR/WKRG/Fox10]
  The district has already crossed the "buy detection hardware" threshold **and**
  has a live grant channel. Acoustic gunshot sensing is the complementary layer:
  OPENGATE stops a weapon at the door; Sentinel covers **after entry, the grounds,
  and everywhere there is no checkpoint.**
- **Why the courthouse is the flagship,** not a school: the **M.C. Blanchard
  Judicial Building** is county-owned, so the decision-maker is the county / Sheriff
  — the *same* customer who runs ECSO. One building, one owner, high-threat, no
  school-board vote. Easiest first "yes" and the best proof site.

---

## 2. Coverage model — nodes per building

**Planning heuristic** (pending per-site Crow's Eye survey): enough leaves that
every occupiable space is within detection range of ≥1 mic, and common areas are
heard by ≥3 (so they localize), plus ≥1 cellular **gateway** per site (a roof node
where possible — elevation for LoRa reach, sky view for GPS/TDOA). Rough density
~1 node per 5,000–8,000 ft² interior, more in big comprehensive high schools.

The exact counts are the **deliverable of the survey**, not a guess baked into a
contract — that is the whole point of the Crow's Eye pairing: the coverage map is
the acceptance document.

---

## 3. Tier A — County facilities  (county / ECSO capital funded)

Unit costs (materials, incl. housing): leaf **$150**, fixed gateway **$230**, roof
gateway **$270** (see [BOM §0](SENTINEL-HARDWARE-BOM.md)).

| Facility | Sites | Nodes/site (leaf + gw) | Nodes | $ / site | Tier $ |
|---|---:|---|---:|---:|---:|
| **M.C. Blanchard Judicial Building** (flagship, 5 floors) | 1 | 22 + 3 (2 fixed, 1 roof) | 25 | $4,030 | $4,030 |
| County admin / Governmental Center | 1 | 16 + 2 | 18 | $2,860 | $2,860 |
| Public libraries (West Florida) | 6 | 6 + 1 | 42 | $1,130 | $6,780 |
| ECSO HQ + 6 precinct substations | 7 | 7 + 1 | 56 | $1,280 | $8,960 |
| Other priority county facilities (of ~69) | 20 | 7 + 1 | 160 | $1,280 | $25,600 |
| **Tier A total** | **35** | | **301** | | **$48,230** |

---

## 4. Tier B — Schools  (FLDOE grant funded)

Verified district count: **34 elementary, 8 middle, 7 high, 6 alt/charter/special
= 55 listed** (NCES all-in ~69; use 55). ~37,000 students. [escambiaschools.org, NCES]

| School type | Sites | Nodes/site (leaf + gw) | Nodes | $ / site | Tier $ |
|---|---:|---|---:|---:|---:|
| High (Escambia, Northview, Pensacola, Pine Forest, Tate, Washington, West FL) | 7 | 25 + 2 (1 fixed, 1 roof) | 189 | $4,250 | $29,750 |
| Middle (Bailey, Bellview, Beulah, Brown-Barge, Ward, Ferry Pass, Ransom, Workman) | 8 | 15 + 1 | 128 | $2,480 | $19,840 |
| Elementary | 34 | 10 + 1 | 374 | $1,730 | $58,820 |
| Alternative / charter / special / technical | 6 | 9 + 1 | 60 | $1,580 | $9,480 |
| **Tier B total** | **55** | | **751** | | **$117,890** |

**Grant fit:** the FLDOE physical-security grant already absorbed ~$400 K of
OPENGATE. The **15 high+middle schools** (which already have OPENGATE) are the
natural first phase at **~$49,600 materials** — well inside that funding envelope.

---

## 5. Tier C — Mobile  (ECSO fleet + UAS)

Coverage travels with the deputies (ARCH §6). Every cruiser is a mobile gateway;
drones are on-demand relays/overwatch.

| Asset | Count | $ / unit | Tier $ |
|---|---:|---:|---:|
| Patrol cruisers — **modeled** (fleet total not published; needs ECSO Fleet records request) | 250 | $290 | $72,500 |
| Drone carry-on packages (LE UAS program) | 10 | $60 | $600 |
| **Tier C total** | **260** | | **$73,100** |

> ⚠️ **The cruiser count is the model's weakest number.** ECSO publishes a ~30–40
> cars/yr *procurement* rate, not a standing-fleet total. 250 is a planning
> placeholder consistent with ~400 sworn + take-home; **confirm with ECSO Fleet
> Services before this figure feeds a price.** It scales the mobile tier linearly.

---

## 6. Totals

| Tier | Sites/assets | Endpoints | Materials |
|---|---:|---:|---:|
| A — County facilities | 35 | 301 | $48,230 |
| B — Schools | 55 | 751 | $117,890 |
| C — Mobile | 260 | 260 | $73,100 |
| **County-wide total** | | **~1,312** | **~$239,220** |

Materials only. A loaded program cost (install labor + monitoring software +
margin) would run some multiple of this — still one-time-plus-SaaS, not a per-square-
mile annual rent.

---

## 7. Why this wins vs ShotSpotter (the billing argument)

ShotSpotter/SoundThinking is a subscription at **~$65–95 K per square mile per
year** — *outdoor gunshot triangulation only*, in the zones a city pays to cover.

- Covering just Escambia's ~50 mi² urban core at ~$70 K/mi² = **~$3.5 M per YEAR,
  recurring**, outdoors only — no school interiors, no courthouse, no mobile.
- Sentinel's **entire county-wide materials cost (~$239 K, one-time)** ≈ **7% of a
  single year** of that modest ShotSpotter footprint — and it covers **school
  interiors, every courthouse and county building, and the mobile fleet.**
- It's **owned, not rented**; the classifier and the confusion matrix are
  **auditable** (a public CC-BY corpus, a re-runnable harness — 97.8% recall on
  8,015 real shots), which is exactly the transparency cities cancelling
  ShotSpotter say they can't get.

The moat isn't price alone — it's **auditable accuracy + one command picture
(drones + gunshots + mobile) + coverage you own.**

---

## 8. Suggested phasing

| Phase | Scope | Endpoints | Materials | Funding |
|---|---|---:|---:|---|
| **0 — Flagship** | M.C. Blanchard courthouse | 25 | ~$4 K | County capital |
| **1 — Grant schools** | 7 high + 8 middle (already have OPENGATE) | 317 | ~$50 K | FLDOE grant |
| **2 — Schools out** | 34 elementary + 6 alt | 434 | ~$68 K | FLDOE grant |
| **3 — County** | admin, libraries, ECSO, priority facilities | 276 | ~$44 K | County capital |
| **4 — Mobile** | cruiser fleet + drones | 260 | ~$73 K | ECSO capital |

Phase 0 is the demoable proof (one county-owned building, one decision-maker);
Phase 1 rides the existing grant + OPENGATE relationship.

---

## 9. Data-package gaps to close before billing-grade

1. **ECSO standing fleet count** — records request to Fleet Services. Top cost driver.
2. **Per-building node counts** — from Crow's Eye LiDAR surveys (also the coverage-map
   deliverable). Replaces the §2 heuristic with measured numbers.
3. **Per-campus acreage / sq ft** — Escambia Property Appraiser parcel data, to firm
   up node density per site.
4. **Countywide shots-fired call volume** — ECSO records request; strengthens the
   "faster than 911" ROI vs the current 300 K calls/yr.
5. **Loaded cost** — add install labor, the monitoring/SaaS line, and margin to turn
   materials into a quote.

**Sources:** escambiaschools.org · nces.ed.gov · escambiaso.com · myescambia.com ·
firstjudicialcircuit.org · Census (via Wikipedia) · WEAR-TV / WKRG (OPENGATE, ECSO budget).
