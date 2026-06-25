# Corvus Sentinel — Phase 2: RF Detection (scope)

**Status:** planning. Phase 1 (acoustic) is built and field-validated. This doc
scopes the RF expansion for review (incl. with OCWS strategic advisor).

## Why RF
Acoustic answers *"is something flying and what is it?"* RF answers *"is there a
control/ID link, where is the drone, and where is the operator?"* — often
**earlier and at longer range** than sound. Together they are sensor fusion:
acoustic catches the RF-silent/homemade threat; RF catches cooperative COTS and
localizes the pilot. Neither alone is complete.

## The three detection tiers

| Tier | Sensor | Catches | Hardware | Status |
|------|--------|---------|----------|--------|
| 1. Acoustic | phone mic | any rotor/engine drone, incl. homemade | none | **built** |
| 2. Phone-native RF | phone BT + Wi-Fi | **Remote ID** (drone + operator GPS), Wi-Fi-link drones | none | planned (#1) |
| 3. SDR RF | external SDR | LoRa/ExpressLRS, DJI OcuSync, non-cooperative links | add-on | planned |

### Tier 2 — phone-native RF (no hardware)
- **Drone Remote ID (highest value).** ASTM F3411 / OpenDroneID: compliant
  drones broadcast ID, **drone position, and operator location** over Bluetooth
  (Legacy + Long Range) and Wi-Fi (Beacon/NaN). A phone can receive this. Gives
  operator-localization that acoustic never can. **Android-first** (iOS locks
  Wi-Fi beacon access; BT RID partial).
  - Limit (state honestly): only **cooperative** drones broadcast RID. Homemade /
    hostile drones usually won't — those remain an **acoustic / Tier-3** problem.
- **Wi-Fi-link detection.** Toy/older/Wi-Fi-mode drones expose a control SSID;
  match known manufacturer MAC OUIs. Android `WifiManager` scan. Coarse but free.

### Tier 3 — SDR RF (needs an add-on)
- **What the phone CANNOT do:** tune sub-GHz (433/868/915 MHz) or decode
  proprietary links. Needs an SDR (RTL-SDR ~$30 / HackRF) over USB-OTG, or a LoRa
  transceiver (SX127x/126x).
- **LoRa / ExpressLRS (ELRS):** the dominant long-range control link on DIY/FPV/
  **homemade** drones — i.e. the same threat class as our acoustic "unknown
  build" flag. Detecting *presence* via the chirp signature is very achievable;
  full decode is harder (needs SF/BW or brute force).
- **DJI OcuSync / Lightbridge (2.4/5.8 GHz):** proprietary; presence/RF-fingerprint
  detection feasible with SDR.
- **Bonus:** a directional antenna gives **bearing** — the azimuth a single mic
  can't provide.

## Integration & form factor
- **Host:** rugged tactical Android (ATAC-class / EOD phones) — the app ports
  directly; inherits IP68/MIL-STD, bigger battery (SDR draws power), USB-OTG.
- **Mount:** rugged expansion back / case holding SDR + external 900 MHz antenna,
  or MOLLE companion tethered USB-C. Antenna placement is the key RF constraint.
- **ATAK / Cursor-on-Target:** publish detections (acoustic + RF) as ATAK markers
  → drops into the situational-awareness picture EOD/military already run. This is
  the real military adoption unlock and a strong partner/channel story.

## Suggested build order
1. **Tier-2 Remote ID over BLE** (most value, no hardware). Parser is pure TS and
   testable; scan needs a native BLE module + dev build; **validate with a real
   RID broadcaster**.
2. Tier-2 Wi-Fi-link detection (Android scan + OUI match).
3. Tier-3 SDR presence detection (LoRa/ELRS chirp) — partner/hardware track.
4. ATAK/CoT output once detections are trusted.

## Honesty guardrails (carry into every pitch)
- RF complements, not replaces, acoustic. Say which drones each tier does/doesn't
  catch. Remote ID = cooperative only; homemade stays acoustic/SDR.
- No fabricated precision. Presence/identification claims must match what the
  sensor actually delivers — same discipline as the acoustic range band.
