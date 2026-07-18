# Sentinel — Unified Sensor Node (one device, every modality)

> **Goal.** One physical sensor that does it all: **Bluetooth Remote ID** (pilot +
> drone), **ExpressLRS / LoRa control-link** detection (drone), and **acoustics for
> both gunshot and drone** — and contributes to **location/triangulation**. This is
> the convergence of the drone product, the [Shots-Fired sensor](SENTINEL-SHOTS-FIRED.md),
> and the [Phase-3 mesh](PHASE3-MESH.md) onto a single node design.
>
> **Status:** design + build plan. The base node ([`sensor-node/`](../sensor-node/))
> is built and proven for gunshot; this doc scopes the additions that make it
> multi-modal. Hardware delta is small — **+ an RTL-SDR and a mic array**; most of
> the rest is software reuse. Cost delta is in [SENTINEL-HARDWARE-BOM.md](SENTINEL-HARDWARE-BOM.md) §9.

---

## 0. Why one node (and why not the phone)

The C2 is **generic by design** — every report carries a `kind` discriminator
(`acoustic | rid | lora | wifi | gunshot | …`), so adding a modality is adding a
*sensor type*, not a product. The phone app stays the **mobile** layer (acoustic +
Bluetooth Remote ID). But **triangulation needs fixed, known-position, time-synced
sensors with mic arrays** — roaming phones can't TDOA and have no array. So the
"all modalities + location" device is the **fixed/vehicle node**, not the phone.
This matches the GUARD/Vigil finding (DOA → sensor node; see
[GUARD-VIGIL-INTEGRATION.md](GUARD-VIGIL-INTEGRATION.md)).

---

## 1. Capability matrix — what each modality needs

| Modality | Radio / sensor | On the node today? | Work to add |
|---|---|---|---|
| **Acoustic — gunshot** | mic | ✅ `shotDetect` (97.8% / 8,015 shots) | none |
| **Acoustic — drone** | same mic | 🟡 detector exists (`mlClassifier`) | **software:** run it on the node's mic stream alongside `shotDetect` |
| **Acoustic — bearing (DOA)** | **mic array** (≥2 mics) | ❌ single mic | **+ mic array**; port GUARD SRP-PHAT / GCC-PHAT → bearing |
| **Bluetooth Remote ID** | BLE radio | ✅ **Pi has onboard BLE** | **software:** port the scanner to Linux (bluez/noble); parser `openDroneId.ts` reused as-is |
| **ELRS / LoRa control link** | **RTL-SDR** (sub-GHz IQ) | ❌ | **+ RTL-SDR**; reuse `rfSensorService` + dechirp/energy detectors, `rtl_tcp` runs native on the Pi |
| **Location / triangulation** | GPS + ≥3 nodes | ✅ GPS on gateway/vehicle; fusion solver ready | add RF range/AoA rows (see §3) |
| **Mesh uplink** | LoRa SX1262 + cellular | ✅ in BOM | none |

> **Do not confuse the two sub-GHz radios.** The **SX1262 LoRa radio** in the BOM
> is the **mesh uplink** (node→gateway backhaul). The **RTL-SDR** is a **wideband
> receiver** that *sniffs* ELRS/LoRa/Crossfire control links via raw IQ. Different
> radios, different jobs — the unified node carries **both**.

---

## 2. The GPL angle is a non-issue on the node

On the **phone**, embedding the RTL-SDR driver was blocked by GPL (`rtl_tcp_andro`
is GPLv2+, and linking it into the proprietary app would infect it — see the RF
notes). **On a Raspberry Pi that problem disappears:** `rtl_tcp` runs as a
**separate OS process** (`apt install rtl-sdr`), and our node connects to it over a
local socket — arm's-length, not linked into our code. So Route-A (companion
`rtl_tcp` + our TCP client) is clean, trivial, and permanent on the node. No
clean-room driver (Route C) needed here — that was a phone-only constraint.

---

## 3. RF triangulation — getting an actual *location* from radio

Today RF is **presence-only**: one RTL-SDR = "a control link is near this node,"
no range, no bearing. The fusion engine ([`lib/meshFusion.ts`](../lib/meshFusion.ts))
is explicitly built as *"same solver, different terms — range / AoA / TDOA."* Three
ways to give it RF terms, cheapest → most accurate:

| Method | How | Hardware | Accuracy | When |
|---|---|---|---|---|
| **RSSI trilateration** | received signal *strength* → path-loss → range; ≥3 fixed nodes trilaterate (identical to the acoustic loudness→range already fused) | the RTL-SDR (have it) | **coarse** (RF multipath / antenna-orientation noise) | **do first** |
| **AoA / direction-finding** | coherent multi-channel SDR runs DF → *bearing*; ≥2 nodes cross bearings | **KrakenSDR** (5 coherent RTL2832U) + 5-antenna array, ~$500/node | good angular fixes | accuracy upgrade |
| **TDOA** | arrival-time difference across synced nodes | RTL-SDR + GPS-PPS | **poor for RF** — GPS-PPS ≈1 µs ⇒ ~300 m at light-speed (great for sound, bad for radio) | not recommended for RF |

**Plan:** RSSI trilateration first (reuses the dongle + the existing solver; only
work is an RSSI→range calibration and letting RF `kind` into fusion). Add **AoA
(KrakenSDR)** where you need real precision. Reserve **TDOA for gunshots** (sound is
343 m/s, so GPS-PPS µs sync = sub-metre — the right tool there, wrong tool for RF).

---

## 4. Hardware — what to add, where to buy, how to assemble

Base node (Pi 4 / CM4 + I2S mic + LoRa SX1262 + GPS + cellular + power) and its
enclosures are fully specced in [SENTINEL-HARDWARE-BOM.md](SENTINEL-HARDWARE-BOM.md)
§1–§4. **Unified-node additions only** (full pricing in that doc's new §9):

| Add | Part | ~$ | Where | Notes |
|---|---|---:|---|---|
| **Sub-GHz RX (control links)** | **Nooelec NESDR SMArt v5** (RTL2832U + R820T2) + telescopic antenna | ~$35 | Nooelec / Amazon | USB; the exact chip the phone path uses |
| **Acoustic bearing (seed)** | 2× Adafruit SPH0645 I2S mic (SEL→GND / SEL→VDD on shared BCLK/WS/DOUT) | ~$14 | Adafruit 3421 ×2 | 2-element array @48 kHz for the cost of one wire |
| **Acoustic bearing (real DOA)** | ReSpeaker 6-Mic Array HAT *or* miniDSP UMA-8 | ~$70–100 | Seeed / miniDSP | what GUARD's SRP-PHAT expects |
| **RF direction-finding (later)** | KrakenSDR + 5× magnetic-mount whips | ~$500 | KrakenRF / CrowdSupply | only if RSSI trilateration isn't precise enough |
| **USB power/hub** | powered USB hub (RTL-SDR + Kraken draw) | ~$15 | Amazon | keeps the Pi's USB rail clean |

**Assembly (unified fixed/vehicle node):**
1. Build the base node per [BOM §1](SENTINEL-HARDWARE-BOM.md) (Pi + I2S mic + LoRa + GPS + power).
2. **Mic array:** wire the 2nd SPH0645 to the same `BCLK/WS/DOUT`, its **SEL→VDD**
   (right channel) vs the first's **SEL→GND** (left) → stereo pair @48 kHz. For real
   DOA, use the ReSpeaker/UMA-8 HAT instead (USB or GPIO).
3. **RTL-SDR:** plug into a **powered USB hub** (not the Pi directly — the dongle +
   any coherent array pull current); antenna out the enclosure via an SMA bulkhead.
   `sudo apt install rtl-sdr`; run `rtl_tcp -a 127.0.0.1 -p 1234` (systemd unit).
4. **BLE:** onboard — enable bluez; no hardware.
5. **GPS:** as in BOM (MAX-M10S → GPIO/UART) — gives position + PPS for time sync.
6. Everything reports to C2 as its own `kind`; ≥3 nodes → fusion triangulates.

---

## 5. Software port list (mostly reuse)

| Task | Reuse | New |
|---|---|---|
| Drone acoustic on node | `lib/mlClassifier.ts`, `corvus-model.json` | run it in `node.mjs` on the mic ring buffer (parallel to `shotDetect`) |
| Bluetooth Remote ID on node | `lib/openDroneId.ts` (parser) | Linux BLE scan (`@abandonware/noble` / bluez) → parse → `pushDetection(kind:'rid')` |
| ELRS/LoRa control link on node | `lib/rfSensorService.ts`, `lib/loraDetect.ts`, `lib/rfEnergyDetect.ts`, `lib/rtlTcp.ts` | point the TCP transport at the Pi's local `rtl_tcp` (native binary; no Android driver dance) |
| Acoustic DOA (bearing) | fusion AoA rows | port GUARD SRP-PHAT/GCC-PHAT (Python→node, or run as a sidecar) → bearing per detection |
| RF range for trilateration | fusion range rows | RSSI→range path-loss calibration; set `range_ft` on RF reports |
| Fusion of all `kind`s | `lib/meshFusion.ts` (range/AoA/TDOA-ready) | allow RF `kind` into the solve; weight by modality |

Everything already funnels through the same `ContactReport` + `pushDetection` + C2 —
no backend change; a new modality is a new `kind` value.

---

## 6. Build sequence (biggest unlock first)

1. **Unified bench node** — Pi 4 + mic + RTL-SDR + GPS: gunshot + drone-acoustic +
   control-link + Remote ID all reporting to C2. *Mostly software + a $35 dongle.*
2. **RF localization v1** — RSSI→range, RF into fusion, 3 fixed nodes → first RF fixes.
3. **Acoustic DOA** — add the mic array + SRP-PHAT → bearings (also feeds gunshot TDOA).
4. **Gunshot TDOA** — GPS-PPS sync across ≥3 nodes → sub-metre shot localization.
5. **RF AoA** — KrakenSDR when RSSI isn't precise enough.

Steps 1–2 are the big unlock and are **mostly software + a $35 dongle** on hardware
already specced.
