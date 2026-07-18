# `rtl-embedded` — embedded RTL-SDR USB driver (Route C) — SKELETON

An in-house, clean-room, **permissively-licensed (MIT)** native Android driver that lets Corvus
Sentinel talk to an RTL2832U dongle (Nooelec NESDR Nano 3 = RTL2832U + R820T2/R860) **directly
over USB** — no companion app, no GPLv2 `librtlsdr`.

> **Status: skeleton / non-functional.** The structure, USB-host plumbing, JS bridge, and the
> integration adapter are in place. The RTL2832U demod init and R820T2 PLL sequences are `TODO`
> markers that a native dev fills in from public datasheets and validates on hardware. See the
> full design in [`docs/RF-EMBEDDED-DRIVER-PLAN.md`](../../docs/RF-EMBEDDED-DRIVER-PLAN.md).

## Why this exists

The shipped RF path (`lib/rtlTcp.ts` + `lib/rfSensorService.ts`) needs a **separate** RTL2832U
driver app exposing the dongle as a localhost `rtl_tcp` server. Route C removes that dependency by
owning USB enumeration + chip bring-up + the IQ bulk loop inside the Sentinel APK.

## Layout

```
native/rtl-embedded/
  README.md                     ← this file (+ clean-room provenance record)
  expo-module.config.json       ← Expo autolinking entry (Android)
  src/
    index.ts                    ← JS bridge + Option-A RtlTransport adapter (reuses rtlTcp.ts verbatim)
    RtlEmbedded.types.ts        ← native <-> JS type contract
  android/
    build.gradle                ← Expo module build config
    src/main/AndroidManifest.xml
    src/main/res/xml/rtl_device_filter.xml   ← USB-attach filter (VID/PID)
    src/main/java/com/oldcrows/rtlembedded/
      RtlEmbeddedModule.kt      ← Expo module surface (listDevices/open/setFreq/startStream/…)
      RtlUsbDevice.kt           ← USB Host: enumerate, permission, claim, ctrl/bulk primitives
      Rtl2832Driver.kt          ← demod bring-up: FIFO, reset, SDR mode, IF, resampler   [TODO cleanroom]
      R820T2Tuner.kt            ← tuner: init block, IF/filter, fractional-N PLL, gain    [TODO cleanroom]
      RtlCommand.kt             ← decodes the 5-byte rtl_tcp command frames (Option-A RPC)
      IqStreamer.kt             ← USB bulk IQ streaming loop → 'onIqData'
```

## How it integrates (Option A — recommended)

The native module pushes **raw interleaved-u8 IQ** to JS and accepts the app's existing **5-byte
`rtl_tcp` command frames**. `src/index.ts` wraps this as an `RtlTransport`, so the whole tested
pipeline is reused unchanged:

```ts
// after prebuild links the module:
import { makeEmbeddedRtlTransport } from '../native/rtl-embedded/src';
import { registerRtlTransport } from '../lib/rfSensorService';

registerRtlTransport(makeEmbeddedRtlTransport()); // that's the entire wiring
```

No TCP loopback, no `react-native-tcp-socket`, no new npm dependency. `lib/rtlTcp.ts`
(`decodeIqU8`, frame assembly) and `lib/rfSensorService.ts` are untouched. See plan §7.

## Filling it in (milestones — plan §9)

1. **M0** USB claim: enumerate + permission + claim iface + log endpoints.
2. **M1** register plumbing: implement `demodWrite/demodRead/sysWrite/i2cWrite`, read back status.
3. **M2** demod SDR mode + 1.024 Msps resampler → stream non-zero IQ (`TODO(hw)` in `Rtl2832Driver`).
4. **M3** R820T2 init + PLL lock at 433/868/915 MHz; confirm a known CW tone lands at the right bin.
5. **M4** wire `makeEmbeddedRtlTransport()` into `rfSensorService`; run a real link past `detectLora`.
6. **M5** manual gain, hot-plug/detach, thermal duty-cycle, async URB pool, R860/"v4" variant.

Grep for `TODO(cleanroom)` (register sequences to author from datasheets) and `TODO(hw)`
(hardware-in-the-loop validation points) and `TODO(native)` (Android plumbing).

## Build / prebuild notes

- Do **not** commit generated native projects. This module is discovered by Expo autolinking via
  `expo-module.config.json` at `npx expo prebuild` time. Wiring it into the actual build (adding it
  to the app's dependencies / config plugin) is a deliberate step for whoever picks up M0 — the
  scaffold does not modify `package.json` or `app.json`.
- `minSdk 24`, USB Host API. Requires a physical device with USB-OTG for M2+ (emulator can't).

---

## Clean-room provenance record (plan §8)

This driver is authored **clean-room** from public documentation. **GPL `librtlsdr` / `r82xx.c` /
`rtl_tcp.c` were NOT used** as source — not copied, not translated, not read-while-writing.

**Public, non-GPL sources of register/hardware facts:**
- Realtek *RTL2832U DVB-T COFDM Demodulator + USB 2.0* datasheet (Rev 1.4).
- Rafael Micro **R820T2 Register Description** PDF (officially released; mirrored by rtl-sdr.com)
  and the R820T datasheet.
- Android USB Host API documentation (`developer.android.com`).
- Osmocom / rtl-sdr-blog **prose** docs and the Linux kernel `dvb-frontends/rtl2832.c` read only as
  a *description of register semantics*, never copied as code.

**Rules enforced in review:**
1. No GPL source open while writing; if a value's only known source is GPL, mark it `TODO(hw)` and
   re-derive on hardware rather than copy.
2. Cite the public source in a comment for every non-obvious constant/sequence.
3. Compute, don't magic-number (IF word, resampler ratio, PLL words are derived from formulas + the
   28.8 MHz crystal constant).
4. MIT/Apache-2.0 header on every native file; list this module as our own permissive OSS component.

Registers, VID/PIDs, and PLL math are functional hardware-interface facts, not protectable
expression — using the public register descriptions is exactly what keeps this permissive.
