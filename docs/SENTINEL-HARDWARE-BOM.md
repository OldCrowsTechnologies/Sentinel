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

## 2. FIXED INDOOR NODE — school / county building (~$95–130 + enclosure)

Ceiling-mounted, PoE from the IDF closet. One cable = power + data. The IDF is
usually on a UPS, so **the sensor net rides through a building power event** — a
life-safety argument, not a convenience.

| Part | Price | Link |
|---|---|---|
| Raspberry Pi 4 (2 GB) — or **CM4** for production (§6) | ≈$45 | [CanaKit](https://www.canakit.com/raspberry-pi-4-2gb.html) |
| **Official Raspberry Pi PoE+ HAT** (5V/4A, 802.3at) — *fits Pi 3B+/4, NOT Pi 5* | **$20** ✅ | [raspberrypi.com](https://www.raspberrypi.com/products/poe-plus-hat/) |
| Adafruit SPH0645 I2S mic (×1, or ×2 for array) | $6.95 ✅ | [Adafruit 3421](https://www.adafruit.com/product/3421) |
| Industrial microSD 32 GB | ≈$12 | Amazon |
| Ceiling enclosure — see note | ≈$15–40 | — |
| **Requires:** an 802.3at (PoE+) switch/injector in the IDF | (site infra) | — |

**Cost per node ≈ $95–130** before enclosure. Compare: ShotSpotter is a
subscription in the **~$65–95k per sq mi per YEAR** range.

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

## 3. OUTDOOR / ROOF NODE — weatherproof, acoustic-pass (~$140–190 + install)

The hard part isn't the electronics, it's **passing sound through a waterproof
wall.** The industry-converged answer: an **adhesive ePTFE acoustic vent** over a
small downward-facing port behind a rain hood.

| Part | Why | Price | Link |
|---|---|---|---|
| Raspberry Pi 4 (2 GB) + PoE HAT | Core + power | ≈$65 | above |
| **Hammond 1554T2GY** enclosure | **UV-stabilized polycarbonate** (ABS is indoor-only — it chalks and cracks in sun), independently tested IP68/NEMA 4X, −40→110 °C, RF-transparent | **$41.78** ✅ | [Hammond](https://www.hammfg.com/electronics/small-case/plastic/1554) |
| **Gore acoustic vent** (GAW334, ×4) | The mic port. ePTFE, oleophobic, IP68, ~1.4 dB loss @1 kHz. **Buyable in small qty** | **$10 / 4pc** ✅ | [GroupGets](https://groupgets.com/products/replacement-acoustic-vent-for-audiomoth-case) |
| **Amphenol LTW pressure vent** (VENT-PQ1NBK) | Separate part. A sealed box thermal-cycles daily and pumps moisture past seals without one. Bottom face | **$2.39** ✅ | [DigiKey](https://www.digikey.com/en/products/detail/amphenol-ltw/VENT-PQ1NBK-N8001/8509545) |
| **Cable gland** — Hammond 1427BCG (brass) | IP68; **brass, not nylon** — nylon photodegrades outdoors | ≈$4 | [Hammond 1427NCG](https://www.hammfg.com/electronics/small-case/accessories/1427ncg) |
| Pole-mount kit PMB6687KIT1 (if masting) | Fits the 1554 | ≈$15 | Hammond |

**Cost per node ≈ $140–190** before conduit/install labor.

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
| **LTE-M cellular HAT** (Waveshare SIM7080G) — car has no LAN | Uplink | ≈$40–50 | Waveshare |
| Cellular data (Hologram, alert-only) | Tiny JSON alerts | **~$1–2/mo** | [Hologram](https://www.hologram.io/pricing) |
| Mic + mount (see below) | | | |

**Cost per node ≈ $155–210** + ~$1–2/mo cellular.

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

---

## 5. WHAT NOT TO BUY YET

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

## 6. PRODUCTION vs PROTOTYPE (the ~100-unit view)

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

## 7. Bottom line

- **To start this week:** buy the §1 bench kit (~$85), wire the SPH0645, run
  [`sensor-node/README.md`](../sensor-node/README.md). You'll have a real Pi
  hearing real shots into the C2.
- **First real deployment:** the §2 indoor PoE node (~$95–130) is the fastest
  high-value slice — lowest install complexity, and the "faster than 911" alert
  is the whole pitch.
- **Roof and vehicle** add weatherproofing and power complexity; do them second,
  and ship the vehicle **speed-gated and honest.**
