# Sentinel Shots Fired — Hardware BOM & Build Guide

> Parts, prices, and links to build a Corvus Sentinel gunshot sensor node in
> three form factors: **fixed indoor (school), outdoor/roof, and patrol vehicle.**
> The brain, software, and deployment scaffolding are done and proven
> ([`sensor-node/`](../sensor-node/), 97.8% recall on 8,015 real shots). This is
> the shopping list to put it on real hardware.

**Price confidence:** ✅ = a datasheet/retailer page was read and the price
confirmed during research. ≈ = search-snippet or street price, **confirm before
ordering.** Prices USD, mid-2026. Nothing here is invented — where a number
couldn't be confirmed it's marked ≈ or "verify."

**Read this first — three findings that change what you buy:**
1. **P1 needs no timing hardware.** No GPS, no PTP. A single node has nothing to
   synchronize against; TDOA needs ≥3 synced nodes. GPS/PTP is a **Phase-3 mesh**
   cost, not a prototype cost. Don't buy it now (saves $40–310/node).
2. **You don't need an exotic high-SPL mic for P1.** Measured: clipping doesn't
   hurt *detection*, and C3GD is 78.5% clipped yet trains to 97% caliber accuracy.
   A $7 120-dB mic is fine to start. High-AOP dual-mic is a **P2** refinement.
3. **Vehicle scope is parked + in-town, NOT highway** — which is the tractable
   regime. A **parked/idling cruiser is already validated**: C3GD (the corpus the
   trigger scored 97.8% on) was recorded on *stationary* mics, so a parked unit
   inherits that number directly. **In-town motion (~15–45 mph) is engineering,
   not open research**, because the wind self-noise that made highway unbeatable
   (a speed⁶ term) collapses ~20–30 dB by in-town speeds, leaving mostly
   stagnation pressure that flush-mount + windscreen defeat. Highway (where
   Boomerang's $10k 7-mic mast caps at 60 mph) is out of scope. See §4.

---

## 0. One node design, three jackets

Every deployment is the **same core**: a Raspberry Pi + a microphone + a network
path, running [`sensor-node/node.mjs`](../sensor-node/node.mjs). What changes is
power (PoE vs 12 V), enclosure (ceiling vs weatherproof vs vehicle), and uplink
(wired vs cellular). Buy the core once, learn it, then add the jacket.

---

## 1. FASTEST PROTOTYPE — get the code running on real hardware (~$75–110)

The goal here is **one working unit on your bench** hearing a real shot and
lighting up the C2. No enclosure, no PoE, no weatherproofing — those come after
you've seen it work.

| Part | Why | Price | Link |
|---|---|---|---|
| **Raspberry Pi 4 Model B (2 GB)** | Enough RAM to develop the log-mel + CNN classifier without a 512 MB ceiling; runs the exact Node pipeline | ≈$45 | [CanaKit](https://www.canakit.com/raspberry-pi-4-2gb.html) |
| **Official Pi 4 USB-C PSU (5V/3A)** | Clean bench power | ≈$8 | [CanaKit](https://www.canakit.com/raspberry-pi-4-power-supply.html) |
| **Industrial microSD 32 GB** (SanDisk/Kingston) | 24/7 endurance; pair with read-only rootfs | ≈$12 | Amazon/DigiKey |
| **Mic — pick ONE:** | | | |
| • Adafruit **SPH0645LM4H** I2S breakout | **Recommended.** Standard I2S, huge Pi docs, 120 dB AOP. Handle its DC-offset in software (the impulse high-pass absorbs it for free) | **$6.95** ✅ | [Adafruit 3421](https://www.adafruit.com/product/3421) |
| • Adafruit **ICS-43434** I2S breakout | Cleaner data, no DC-offset quirk — but the chip is **EOL**, don't standardize on it | **$8.95** ✅ | [Adafruit 6049](https://www.adafruit.com/product/6049) |
| • Cheap **USB audio dongle** (UGREEN/CM108) | **Zero drivers** — the most robust bring-up path if I2S wiring fights you. Set `"device":"hw:2,0"` | ≈$10 | Amazon |
| Jumper wires / breadboard | Wire the I2S mic to the GPIO header | ≈$5 | Anywhere |

**Bench total: ~$75 (USB mic) to ~$95 (I2S mic + accessories).**

**Wiring the I2S mic** (SPH0645 → Pi 4 header): `3V→3V3`, `GND→GND`,
`BCLK→GPIO18`, `LRCL/WS→GPIO19`, `DOUT→GPIO20`. Then `/boot/firmware/config.txt`:
```
dtparam=i2s=on
dtoverlay=googlevoicehat-soundcard
```
Reboot, `arecord -l` to confirm, then follow [`sensor-node/README.md`](../sensor-node/README.md).

> **Two mics for the price of a wire:** a second identical I2S mic wired to the
> same BCLK/WS/DOUT with its **SEL pin to VDD (right channel)** vs the first's
> **SEL to GND (left)** gives you a **2-element array at 48 kHz** — the seed of
> AoA/mesh work — for the cost of one more $7 breakout.

---

## 2. FIXED INDOOR NODE — school / county building

**Two roles on a LoRa mesh** (see [SENTINEL-SHOTS-FIRED-ARCH.md](SENTINEL-SHOTS-FIRED-ARCH.md)):
most nodes are cheap **leaves** (detect + report over LoRa); a site keeps **≥1
gateway** (a leaf + a cellular uplink) that relays the whole mesh to C2. Every
patrol cruiser is *also* a gateway (§4), so a site gains redundant uplinks the
moment deputies arrive. Both roles carry an on-node battery so the alert path
survives a building power cut.

**Leaf node — ~$100–160 + enclosure**

| Part | Why | Price | Link |
|---|---|---|---|
| Raspberry Pi 4 (2 GB) — or **CM4** for production (§7) | Core | ≈$45 | [CanaKit](https://www.canakit.com/raspberry-pi-4-2gb.html) |
| **LoRa radio** (SX1262 HAT) | Mesh transport — reports hop to a gateway (§5 Layer 2). Cheap, sub-GHz, penetrates walls | ≈$15–20 | Waveshare / Adafruit |
| **Battery UPS HAT + cells** (see Power & backup) | Runs through a power outage; auto-recharge on restore | ≈$40–70 | verify chemistry |
| **Building-power feed:** mains USB-C adapter *or* PoE-splitter (power-only) | Charges the battery + runs normally. Adapter if there's an outlet; PoE-splitter if only an Ethernet drop is run | ≈$8–20 | — |
| Adafruit SPH0645 I2S mic (×1, or ×2 for array) | Sensor | $6.95 ✅ | [Adafruit 3421](https://www.adafruit.com/product/3421) |
| Industrial microSD 32 GB | + read-only OverlayFS | ≈$12 | Amazon |
| Ceiling enclosure — see note | Tamper-resistant housing | ≈$15–40 | — |

**Gateway node — leaf + ~$40–50 + ~$1–2/mo:** add a **cellular HAT** (Waveshare
SIM7080G, LTE-M) + a [Hologram SIM](https://www.hologram.io/pricing). One gateway
serves the whole site's mesh — one SIM per building, not per node. This is the
cost win of the mesh: 9 cheap leaves + 1 gateway, not 10 cellular nodes.

**Cost:** ~9 leaves at **~$100–160** + 1 gateway at **~$150–210** per site.
Compare: ShotSpotter is a subscription in the **~$65–95k per sq mi per YEAR** range.

> **⚙️ Power & backup — surviving an outage (applies to §2 and §3).**
> An alert firing during an outage needs the *whole path* powered — leaf **and**
> gateway. Each carries its own battery; the gateway's cellular is what keeps the
> uplink alive independent of the building's switch/router. And a cruiser rolling
> in (§4) is a fresh battery-backed gateway on the scene.
> - **Use a real battery, not a supercap.** The supercap UPS in the vehicle BOM
>   gives 10–60 s — that's *graceful shutdown*, not ride-through. To keep *running*
>   you need cells. The node averages ~3–4 W (mostly idle-listening; the classifier
>   only wakes on an impulse), so **2× 18650 ≈ 2 h, 4× ≈ 4 h** — and the acute event
>   is minutes. A Pi Zero 2 W (production) draws ~1 W and triples that.
> - **The one real caveat — lithium in a hot ceiling.** A sealed enclosure up there
>   hits 45–60 °C, where standard **Li-ion 18650 degrades fast and raises fire-code
>   questions in an occupied school.** **LiFePO4** cells are the fix (safer, far
>   better heat tolerance) — **but** standard 18650 UPS HATs charge Li-ion (4.2 V),
>   *not* LiFePO4 (3.6 V), so LiFePO4 needs a LiFePO4-capable UPS board (fewer Pi-HAT
>   options — **verify before buying**). This chemistry-vs-heat choice is the open
>   engineering item for the fixed node.
> - **Auto-failover + auto-recharge is off-the-shelf** — a Waveshare / PiJuice /
>   Geekworm-class UPS HAT does exactly the mains-normally → battery-on-loss →
>   recharge-on-restore behavior natively. You buy it, you don't design it.
> - **Half of it is already built:** the node buffers detections and retries on
>   reconnect (deduped on `seq`), so the battery's only job is to keep the Pi powered.

> **⚠️ Legal design constraint — this is not optional.** Continuous audio
> recording in a school is a wiretapping/consent problem and is the fight
> ShotSpotter keeps having in court. The node is already built to **never write
> audio to disk** — RAM ring buffer, transmit only a detection event. Keep it
> that way, and get counsel sign-off before any school install (doc §10).

**Indoor enclosure:** a smoke-detector / occupancy-sensor form factor is
unremarkable, uses ceiling infrastructure schools already have, and sits out of
reach. Off-the-shelf project boxes work for the prototype; a custom ceiling
housing with a **tamper switch** is the production answer. *(No single verified
SKU yet — open item.)*

---

## 3. OUTDOOR / ROOF NODE — weatherproof, acoustic-pass (~$160–270 + install)

The hard part isn't the electronics, it's **passing sound through a waterproof
wall.** The industry-converged answer: an **adhesive ePTFE acoustic vent** over a
small downward-facing port behind a rain hood.

**A roof is the ideal gateway spot.** Elevation gives LoRa its real range (the
5–15 km figure is line-of-sight — height buys it), and sky view gives GPS, which
means a roof node gets a **sub-ms clock for free → it's TDOA-capable**, unlike an
indoor leaf (see [ARCH §5](SENTINEL-SHOTS-FIRED-ARCH.md)). So a roof node is
usually built as a **gateway** (add cellular) and carries a battery like any
fixed node.

| Part | Why | Price | Link |
|---|---|---|---|
| Pi 4 (2 GB) + LoRa radio + battery UPS + power feed | Leaf core (§2). Add cellular HAT (~$40–50) to make it a gateway | ≈$115–185 | above |
| **Hammond 1554T2GY** enclosure | **UV-stabilized polycarbonate** (ABS is indoor-only — it chalks and cracks in sun), independently tested IP68/NEMA 4X, −40→110 °C, RF-transparent | **$41.78** ✅ | [Hammond](https://www.hammfg.com/electronics/small-case/plastic/1554) |
| **Gore acoustic vent** (GAW334, ×4) | The mic port. ePTFE, oleophobic, IP68, ~1.4 dB loss @1 kHz. **Buyable in small qty** | **$10 / 4pc** ✅ | [GroupGets](https://groupgets.com/products/replacement-acoustic-vent-for-audiomoth-case) |
| **Amphenol LTW pressure vent** (VENT-PQ1NBK) | Separate part. A sealed box thermal-cycles daily and pumps moisture past seals without one. Bottom face | **$2.39** ✅ | [DigiKey](https://www.digikey.com/en/products/detail/amphenol-ltw/VENT-PQ1NBK-N8001/8509545) |
| **Cable gland** — Hammond 1427BCG (brass) | IP68; **brass, not nylon** — nylon photodegrades outdoors | ≈$4 | [Hammond 1427NCG](https://www.hammfg.com/electronics/small-case/accessories/1427ncg) |
| Pole-mount kit PMB6687KIT1 (if masting) | Fits the 1554 | ≈$15 | Hammond |

**Cost per node ≈ $160–270** before conduit/install labor (leaf → gateway; includes battery, +cellular if gateway).

**Design rules that are free if you follow them (from the vendor docs):**
- **ePTFE membrane faces outward**; port on a **vertical or downward** face so
  water can't pool; behind a rain hood so no driven rain hits it directly.
- Vent as **close to the mic capsule** as possible, cavity behind it **tiny**, so
  the port resonance sits above ~9 kHz.
- **Two undocumented risks worth one bench test:** no vendor publishes membrane
  data above ~10 kHz or above ~94 dB SPL — exactly where the ballistic shockwave
  and muzzle blast live. A/B a vented vs open port with a real impulsive source
  (starter pistol) once. A day's work; de-risks the whole outdoor design.

**Time sync (roof only, and only for Phase-3 mesh):** the roof node's sky view
makes it the natural **GPS-PPS grandmaster** for the site. **SparkFun MAX-M10S
(~$40)** or **NEO-M9N ($70.95 ✅)** → GPIO18 → chrony gives ~1–5 µs UTC, then
distribute to indoor nodes over PTP on the wired LAN. **Skip this entirely for
P1** and skip the $310 timing-grade ZED-F9T always — it's overkill for gunshot
TDOA.

**Rooftop conduit/electrical** (if hard-wired vs PoE-only) is real install work
governed by code: wet-location-listed LB bodies **with cover+gasket** (Crouse-
Hinds LB27-CG ≈$70 ✅), THWN-2 (not THHN) wire, and raceway mounted ≥7/8" off the
deck to dodge the NEC rooftop-ambient temperature adder. This is electrician
territory — budget labor, not just parts.

---

## 4. PATROL VEHICLE NODE — parked + in-town (~$155–210)

**Scope: parked/idling and in-town driving, not highway** (§0 finding #3).

- **Parked/idling = the easy case, already validated.** C3GD was recorded on
  stationary mics, so a parked cruiser inherits the 97.8% detection number
  directly. This is a fixed node that moves. Engine-idle vibration is low-freq /
  structure-borne — the 300 Hz trigger high-pass + impulse-shape gate handle it.
  And a unit parked on a scene is exactly where a shooting is likely near it.
- **In-town motion (~15–45 mph) is tractable.** The wind self-noise that made
  highway detection an open problem is a speed⁶ term; it collapses ~20–30 dB by
  in-town speeds, leaving mostly stagnation pressure that a flush mount +
  windscreen defeat. So the **speed gate is soft, not a cliff**: full confidence
  parked, a modestly raised threshold in motion, back off only at sustained
  highway speed. Gate on GPS speed.
- **The real nuisance is speed-independent: the deputy's own door/trunk slam at
  ~1 m**, on every stop, at the exact impulse shape the trigger fires on. By
  design that's a **classifier** job (stage 1 passes slams through on purpose —
  pinned by test), and it needs a vehicle confounder corpus you can capture
  yourself trivially: park a cruiser, slam the doors a few hundred times, record.
- **Don't claim a mph rating or "car-wash safe"** — no mount vendor publishes
  either, and neither is substantiable in a Daubert hearing.

| Part | Why | Price | Link |
|---|---|---|---|
| Raspberry Pi 4 (2 GB) | Core | ≈$45 | above |
| **Pololu D24V50F5** buck (6–38V → 5V/5A) | Automotive-grade wide input | **$29.95** ✅ | [Pololu](https://www.pololu.com/product/2851) |
| **Automotive TVS diode (SMBJ) + inline fuse** | Load dump can spike >40 V past the buck's ceiling — clamp it | ≈$5 | DigiKey |
| **Supercap UPS HAT** (25F, 10–60 s) | Graceful shutdown on ignition-off; no SD corruption | ≈$25–35 | Amazon |
| **GPS module** (MAX-M10S) | Vehicle needs position anyway; also feeds the **speed gate** | ≈$40 | [SparkFun](https://www.sparkfun.com/products/18037) |
| **LTE-M cellular HAT** (Waveshare SIM7080G) — car has no LAN | Uplink (makes it a gateway) | ≈$40–50 | Waveshare |
| Cellular data (Hologram, alert-only) | Tiny JSON alerts | **~$1–2/mo** | [Hologram](https://www.hologram.io/pricing) |
| **LoRa radio** (SX1262 HAT) | Joins/forms the mesh — relays site nodes *and* other cruisers | ≈$15–20 | Waveshare |
| Mic + mount (see below) | | | |

**Cost per node ≈ $170–230** + ~$1–2/mo cellular.

**Every cruiser is a mobile gateway** — see [ARCH §6](SENTINEL-SHOTS-FIRED-ARCH.md).
It already has cellular (uplink) + GPS (position **and** a sub-ms clock), so adding
the LoRa radio makes it a full gateway *and* a TDOA-capable sensor. Consequences:
a cruiser arriving at a site adds a **redundant uplink** (restores the path to C2
even if building comms were cut), and **3 cruisers around an incident triangulate
it with zero installed nodes.** Coverage travels with the deputies — the thing
ShotSpotter's fixed model can't do. *(Note: the supercap UPS is graceful-shutdown
only; if you want a cruiser to keep sensing while parked-and-off, swap in a small
battery like the fixed nodes.)*

**Mounting & wind (the honest version):**
- **Best location: roof centerline, flush** — attached boundary layer, least
  turbulence. Behind the lightbar is the *worst* spot (separated wake). A
  lightbar-internal mic is also acoustically dead (sealed polycarbonate box).
- **Mount precedent:** the only fleet-accepted roof penetration is the **NMO
  antenna through-hole** (Larsen MB8X ≈$39, or no-hole trunk-lip NMOTLP ≈$132).
  For the **demo**, a magnetic NMO mount (Larsen NMOMMRMPL, $55.53 ✅) is fine;
  it survives highway drag but **fails the car-wash test**, so it's demo-only.
- **No vendor rates any mount for mph or "car-wash safe"** — don't put those
  numbers on a spec sheet. Defensible language: *"installed per NMO through-hole
  standard practice, consistent with existing police antenna installations."*
- **Wind mitigation** that actually helps at low speed: flush/recessed port +
  porous screen, aimed down/aft, never in direct airflow. Conveniently the **same
  geometry** the car-wash and rain problems demand.

### 4b. Drone carry-on node — relay + overwatch (~$45–75)

A **featherweight** package that makes an LE drone a mesh member. It is a flying
relay, a GPS-timed gateway, and camera overwatch — **not** an acoustic sensor (a
multirotor's rotor noise makes it deaf to distant shots; see
[ARCH §6.1](SENTINEL-SHOTS-FIRED-ARCH.md)). Weight/power are the constraints, so it
carries the relay node, not the classifier.

| Part | Why | Price | Link |
|---|---|---|---|
| **Pi Zero 2 W** (or ESP32-S3 for lighter/lower-power) | ~1 W featherweight brain; relay role only | ≈$17 | [PiShop](https://www.pishop.us/product/raspberry-pi-zero-2-w/) |
| **LoRa radio** (SX1262) | Joins the mesh from altitude — huge line-of-sight relay reach | ≈$15–20 | Waveshare / Adafruit |
| Small LiPo tap or drone-battery step-down | Power off the airframe or a tiny cell | ≈$8–15 | — |
| (Overwatch uses the **drone's own EO/IR camera** — no added sensor) | Eyes-on the ground-triangulated location | — | — |

**Why altitude is the win:** line-of-sight is LoRa's #1 limiter, and a drone at
~100 m has an RF horizon over a whole area — it bridges ground nodes, extends the
mesh over terrain, and gives instant aerial backhaul if ground comms were cut.
**On-demand asset** (20–40 min flight), governed by its own FAA envelope (Part
107 / public-safety COA) — an operational constraint, not an engineering one.
**Authenticated join (§ security) matters doubly** for an over-the-air node.

---

## 5. Connectivity — reaching C2 without the building's network

The requirement: a node must **not** depend on the building's internet or IT —
firewalls, months-long approval cycles, outages, or a ceiling with no usable
network drop nearby. Here are the layers, cheapest-independence first.

**The key fact that makes this simple:** the node does a plain HTTPS POST to
Supabase ([`c2.mjs`](../sensor-node/c2.mjs)) over **whatever network interface
the Pi has.** So "don't use the building's internet" is a *network-interface*
choice, not a code change. Swap the uplink; the software is byte-for-byte identical.

### Layer 1 — Cellular per node  ✅ buildable now, no code change

Each node carries its own **LTE-M / CAT-M1 modem + SIM** and connects straight to
the carrier network → C2. Completely independent of the building: no switch port,
no firewall exception, no school-district IT ticket. It works the moment it powers
on, in a building you've never coordinated with.

- **Hardware:** Waveshare SIM7080G HAT (≈$40–50) or Sixfab LTE-M kit ($80).
  LTE-M penetrates buildings better than NB-IoT and is the right tier for tiny alerts.
- **Data cost:** a gunshot alert is a few hundred bytes. Hologram SIM **~$1–2/mo
  per node** at this volume.
- **Why this is the answer, not a footnote:** it removes the single biggest
  sales-cycle blocker — getting a device onto a school's managed network. You skip
  that conversation entirely. This is why cellular is the **primary** uplink for
  fixed installs here, not a failover.
- **Works with the current code unchanged** — the modem is just the Pi's default route.
- **Tradeoff:** needs cell coverage at the node (a basement IDF or rural site may
  not have it), and it's a recurring per-SIM cost that scales with node count —
  which Layer 2 fixes.

### Layer 2 — LoRa backhaul: many nodes share one uplink  ⚙️ architected, not built

Eight nodes in one school shouldn't mean eight SIMs. Instead, the nodes form a
**LoRa** link to **one gateway node** that holds the single uplink (cellular, or
the one sanctioned wired drop).

- LoRa is **license-free sub-GHz ISM, kilometer range, penetrates walls, tiny
  payloads** — and a gunshot alert *is* tiny (the compact contact report is already
  ≤40 bytes by design, see PHASE3-MESH.md).
- **N nodes → 1 gateway → 1 uplink.** One SIM for a whole building instead of N.
- Reuses the exact LoRa hardware Phase-3 mesh wants (SX127x/126x) — one radio, two jobs.
- **Status: architected (PHASE3-MESH Tier-L), not yet built for the gunshot node.**
  The compact report format exists; the LoRa transport + gateway relay is new code.

### Layer 3 — Fully offline / local C2: no cell either  ⚙️ roadmap, biggest add

The deepest case, and Sentinel's stated *normal* operating assumption for some
deployments (PHASE3-MESH §"COMPLETELY OFFLINE"): no internet **and** no cell —
rural, or comms-denied. Then the live picture can't come from a cloud C2 at all.

- **A local C2 instance** — a relay/dashboard the command post runs on a laptop or
  Pi on a local LAN, that nodes reach over LoRa or local Wi-Fi. Alerts render
  locally in real time, no internet in the loop.
- **Opportunistic cloud sync** when any uplink appears (a drive-by, a sat terminal),
  so the agency's tenant picture stays whole.
- **This is the honest tension:** the C2 is the product, and today the C2 is cloud
  (Supabase). A local-C2 relay is the missing piece for true no-comms operation.
  **Status: not built** — it's the largest architectural add, and it's *shared*
  with the phone product's offline-first requirement, so it's not gunshot-specific work.

### What to actually do

**Decided architecture: LoRa-leaf mesh + gateways** (see
[SENTINEL-SHOTS-FIRED-ARCH.md](SENTINEL-SHOTS-FIRED-ARCH.md)). Cheap LoRa leaves,
a few cellular gateways per area, and **every cruiser is a mobile gateway** so
coverage travels with the deputies.

| Situation | Uplink | Status |
|---|---|---|
| **Single-node bench / first demo** | Cellular on that one node (it *is* a gateway) | ✅ works today, no building IT |
| **A site (school) of many nodes** | **LoRa leaves → 1+ gateway → uplink** | ⚙️ build Tier-L transport + gateway relay |
| **Mobile / no fixed infrastructure** | **Cruisers = mobile gateways**, mesh forms ad-hoc | ⚙️ + authenticated dynamic join (ARCH §7) |
| **Rural / comms-denied** | **Local C2 relay + opportunistic sync** | ⚙️ net-new, scope before promising |

For the very first bench demo, a single node with cellular *is* a one-node
gateway and works today — it's the fastest path to "faster than 911" on a real
Pi. The mesh (LoRa transport + gateway relay + authenticated join) is the next
build, and it's what turns one node into the product.

---

## 6. WHAT NOT TO BUY YET

- **GPS / PTP / timing hardware for P1** — nothing to sync against with one node.
- **A high-AOP mic ($130+ custom front-end)** — clipping doesn't hurt P1
  detection. Revisit at P2 for caliber robustness.
- **Timing-grade ZED-F9T ($310)** — 5 ns is ~1000× more than gunshot TDOA needs.
- **Sixfab Power Management HAT** — the elegant ignition-sense answer, but
  **retired/unavailable**. Use the buck + supercap combo above.
- **Anything ABS for outdoors** — indoor-only, fails in UV. PC or die-cast only.
- **Grey-market "IP67 acoustic membrane" strips** — no dB spec, no traceability.
  Genuine Gore is $2.50/vent. No economic case for the knockoff.

---

## 7. PRODUCTION vs PROTOTYPE (the ~100-unit view)

| Axis | Prototype | Production (~100 units) |
|---|---|---|
| Brain | Pi 4 (2 GB), ≈$45 | **CM4 (2 GB / 32 GB eMMC), ≈$97** — eMMC kills the SD-corruption field-failure mode | 
| Budget alt | — | Pi Zero 2 W ($17) + **read-only OverlayFS** if a lighter model is locked |
| Mic | SPH0645 breakout $6.95 | Bare mic on a custom PCB; **dual-sensitivity** (Infineon IM73A135 135 dB-AOP analog @ $1.42/100 + SPH0645-class for SNR) per ShotSpotter US11361636 |
| SD | Industrial microSD + OverlayFS | eMMC (on CM4) — no card to corrupt |
| Mic port | Gore GAW334 from GroupGets | Gore **AVP434** industrial line (−40→100 °C, silicone adhesive; the 85 °C acrylic on GAW334 is the likely cause of AudioMoth's membrane-failure reports — a roof is hotter than a rainforest) |

**Unit economics vs ShotSpotter:** their cost isn't hardware (~$1,500/sq mi of
sensors) — it's the **24/7 human review center**, which exists because their
classifier can't dispatch alone. If Sentinel's classifier is good enough to skip
that center, the cost advantage is **10–50×**. That's a classifier-quality
question and a liability decision (no human backstop), not a hardware one — decide
it deliberately.

---

## 8. Bottom line

- **To start this week:** buy the §1 bench kit (~$85), wire the SPH0645, run
  [`sensor-node/README.md`](../sensor-node/README.md). You'll have a real Pi
  hearing real shots into the C2.
- **First real deployment:** the §2 indoor PoE node (~$95–130) is the fastest
  high-value slice — lowest install complexity, and the "faster than 911" alert
  is the whole pitch.
- **Roof and vehicle** add weatherproofing and power complexity; do them second,
  and ship the vehicle **speed-gated and honest.**
