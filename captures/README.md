# Corvus Sentinel — RF capture corpus (Tier-3 SDR)

Raw `.iq8` captures from the RTL-SDR, one folder per **subject** (the thing that's
transmitting). Each shot is a `.iq8` (headerless raw IQ) + a `.json` sidecar that
makes it self-describing. This is the RF analogue of `data/recordings/` for acoustic.

Captured with `tools/rf_field.mjs` (labeled, gives instant in-field feedback).
The `.iq8` format + 1.024 Msps sample rate match the on-device path exactly, so every
file replays byte-identically through the shipped detectors (`detectEnergy` primary,
`detectLora` chirp tag).

## `.iq8` format
Interleaved **unsigned 8-bit** I, Q (rtl_tcp native). Decode: `(byte - 127.5) / 127.5`.
Headerless — the sample rate and center freq live **only in the `.json` sidecar**, so
keep the pair together. 1 second ≈ 2 MB at 1.024 Msps.

## Layout & naming
```
captures/<subject>/<band>_<label>_<NN>.iq8   + .json
```
- **subject** — kebab-case, e.g. `dji-mini4`, `elrs-tx-915`, `tbs-crossfire`, `frsky-r9`, `site-noise`
- **band** — `915MHz` / `868MHz` / `433MHz` (or `NNN.NNNMHz` for a custom center)
- **label** — `signal`, `hover`, `throttle`, `idle`, `armed`, `bind`, `noise`, `baseline`
- **NN** — auto-incremented; nothing is ever overwritten

## The one rule for building later: shoot matched pairs
The analysis tools (`rf_probe`, `analyze_capture`) score **signal vs noise**. For every
band/subject you record with the TX **on**, also grab a `baseline`/`noise` shot on the
**same band with the TX off**. Same gain, same spot. That pair is what tunes the detector
threshold honestly.

## Capturing (field workflow)
```
# 0. rtl_tcp must be serving the dongle:  rtl_tcp -a 127.0.0.1 -p 1234
# 1. baseline first (TX OFF):
node --experimental-strip-types tools/rf_field.mjs site-noise 915 baseline 5
# 2. then the link (TX ON):
node --experimental-strip-types tools/rf_field.mjs elrs-tx 915 signal 8 --note "10m LOS, 100mW"
```
Read the on-screen verdict: `NO LINK` → move closer / re-key / try 433 or 868 before
moving on; `LINK PRESENT` → you got it, next subject.

## Analyzing (bench, after the field)
```
node --experimental-strip-types tools/rf_probe.mjs        captures/elrs-tx/915MHz_signal_01.iq8 captures/site-noise/915MHz_baseline_01.iq8
node --experimental-strip-types tools/analyze_capture.mjs captures/elrs-tx/915MHz_signal_01.iq8 captures/site-noise/915MHz_baseline_01.iq8
node --experimental-strip-types tools/rf_characterize.mjs captures/elrs-tx/915MHz_signal_01.iq8 <offsetKHz>   # carrier vs bursts + duty
node --experimental-strip-types tools/rf_spectrogram.mjs  captures/elrs-tx/915MHz_signal_01.iq8              # visual
node --experimental-strip-types tools/rf_hoptrack.mjs     captures/elrs-tx/915MHz_signal_01.iq8              # FHSS hop pattern
```

## Common control-link bands (US)
- **ELRS / LoRa 900** — 902–928 ISM, capture centered **915 MHz** (FHSS across the band).
- **ELRS / LoRa 868** — EU; center **868 MHz**.
- **FrSky/others 433** — center **433.92 MHz**.
- **ELRS 2.4 / DJI OcuSync (2.4 & 5.8 GHz)** — **out of RTL-SDR range.** Needs a HackRF/Airspy;
  not capturable with this dongle. Note it, don't chase it here.

## Legal / safety
Receive-only, passive. Record only links you own or have the operator's OK to record at a
public/permitted field. Nothing here transmits.

*Corvus · Old Crows Wireless Solutions · We Always Find the Signal.*
