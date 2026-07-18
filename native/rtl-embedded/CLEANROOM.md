# CLEANROOM.md — provenance for the embedded RTL-SDR driver

**Component:** `native/rtl-embedded` (Expo native module `RtlEmbedded`, Route C).
**License:** MIT / permissive, in-house. Ships inside the proprietary Corvus Sentinel APK.
**Purpose of this file:** record that this driver is a **clean-room** reimplementation authored
from public datasheets and register descriptions, incurring **no GPL obligation**. See
[docs/RF-EMBEDDED-DRIVER-PLAN.md](../../docs/RF-EMBEDDED-DRIVER-PLAN.md) §8 for the full rationale.

## The rule we are following

`librtlsdr` and `r82xx.c` are **GPLv2**. Copying them, translating them to Kotlin, or deriving from
*reading their source* would make this driver a derivative work → GPL. **We do not do any of that.**

What is *not* restricted is the **facts**: USB VID/PIDs, register addresses, bit meanings, the PLL
tuning math, and the USB control-transfer contract. Register maps and hardware interface contracts
are functional facts, not protectable expression. We author from those facts only.

## Sources consulted (public, non-GPL)

- **Realtek RTL2832U DVB-T COFDM Demodulator + USB 2.0 datasheet** (Rev 1.4, publicly circulated) —
  USB block, demod register pages, DDC IF word, resampler ratio.
- **Rafael Micro R820T2 Register Description PDF** (officially released; mirrored by rtl-sdr.com) and
  the **R820T datasheet** — tuner register map, init block, fractional-N PLL math, gain tables.
- **Android USB Host API docs** (`developer.android.com/develop/connectivity/usb/host`) — enumeration,
  runtime permission, `claimInterface`, bulk/control transfers.
- **Osmocom / rtl-sdr-blog prose documentation** and the Linux kernel `dvb-frontends/rtl2832.c` —
  read **only as a description of what a register means**, never copied as code.

## Rules enforced in review (plan §8)

1. **No GPL source open while writing.** Author from datasheets / register-descriptions only. If a
   value's only known source is GPL code, treat it as `TODO(hw)` — re-derive on hardware — not copy.
2. **Cite the public source** for every non-obvious constant/sequence in a code comment
   (`// clean-room: R820T2 Register Description §<reg>` / `// RTL2832U datasheet §<x>`).
3. **Compute, don't magic-number.** IF word, resampler ratio, and PLL words are derived from formulas
   + the crystal constant (`RTL_XTAL_HZ`) so the code demonstrably encodes public math, not literals.
4. **License header** MIT on every new native file; module listed as our own permissive OSS component.

## Statement

**`librtlsdr`, `r82xx.c`, and any other GPL RTL-SDR source were NOT used** in authoring this module —
not copied, not translated, not read-and-transcribed. The register-level bring-up (`TODO(cleanroom)`
markers in `Rtl2832Driver.kt` / `R820T2Tuner.kt` / `RtlUsbDevice.kt`) remains to be filled in from the
datasheets above and validated on hardware (plan §9, milestones M1–M3). Those constants must likewise
be re-derived from the public register descriptions, with a per-value citation, never lifted from GPL code.

## Status of the code as landed

| Area | State |
|---|---|
| USB enumeration + VID/PID match (`RtlUsbDevice.list/open`, endpoint discovery) | **Done** — public Android API |
| USB runtime **permission** flow (`RtlEmbeddedModule.requestUsbPermission`) | **Done** (M0) — public Android API |
| Register-access primitives (`demodWrite/demodRead/sysWrite/i2cWrite/i2cRead`) | `TODO(cleanroom)` (M1) |
| Demod SDR-mode + resampler + IF (`Rtl2832Driver`) | math derived; register writes `TODO(cleanroom)` (M2) |
| R820T2 init block + PLL tune + gain (`R820T2Tuner`) | PLL math derived; register writes `TODO(cleanroom)` (M3) |
| Bulk IQ loop (`IqStreamer`) | **Done** shape (sync `bulkTransfer`); async URB pool is M5 |
| JS Option-A adapter (`lib/rtlTransportEmbedded.ts`) → `RtlTcpClient` verbatim | **Done** — inert until prebuild-linked |

M1–M3 are **hardware-gated**: they can only be signed off with a physical NESDR on an Android USB-OTG host.
