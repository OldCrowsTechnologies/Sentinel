# Corvus Sentinel — Embedded RTL-SDR USB Driver (Route C) — Clean-Room Design

**Status:** design / scaffolding. This doc scopes **Route C**: an embedded, self-contained,
clean-room, permissively-licensed native Android USB driver for the Nooelec NESDR Nano 3
(RTL2832U demodulator + R820T2 / R860 tuner) so the app can talk to the dongle **directly over
USB**, with **no companion app** and **no GPLv2 `librtlsdr`**.

It is a sibling to the shipped rtl_tcp path (`lib/rtlTcp.ts`, `lib/rfSensorService.ts`), which
depends on an external RTL2832U driver app exposing the dongle as a localhost `rtl_tcp` server.
Route C removes that external dependency at the cost of writing (and hardware-validating) the
low-level init sequences ourselves.

> **Non-goals.** This is a *presence* sensor, not a DVB-T receiver and not a LoRa demodulator.
> The DSP core (`lib/loraDetect.ts`) is done and unchanged. We only need enough of the chip to
> get **clean interleaved-u8 IQ at a chosen center frequency, sample rate, and gain**. Anything
> the demod does beyond "act as a raw ADC/DDC that streams IQ over USB bulk" is out of scope.

---

## 1. Why an embedded driver (and why it's hard)

On Android an ordinary app cannot claim a USB SDR without native USB-host code. The two shipped
paths so far:

- **Route 1 / rtl_tcp (shipped seam):** a *separate* app (RF Analyzer, SDR Touch, "RTL2832U USB
  driver" by Martin Marinov) owns USB enumeration + permission and re-exports the dongle as a
  local `rtl_tcp` server. We connect a TCP socket to `127.0.0.1:1234`. Pros: zero low-level RF
  code on our side, already built and unit-tested. Cons: users must install and launch a second
  app; fragile UX; not "self-contained"; that companion app is itself GPL.
- **Route C / embedded (this doc):** we own USB enumeration, chip init, and the IQ bulk loop
  natively, inside the Sentinel APK. Pros: single install, no companion app, offline-friendly,
  fully ours. Cons: we must reproduce the RTL2832U + R820T2 bring-up sequence **clean-room** from
  public documentation, and validate it on real hardware.

The reason this is normally avoided is licensing, not feasibility: the canonical implementation
(`librtlsdr`) is **GPLv2**, which would virally infect our proprietary app if linked or
translated. Route C is explicitly a **clean-room reimplementation from public datasheets and
register descriptions** — see §8.

---

## 2. Architectural fact this design leans on

The entire app already treats the SDR as a source of **raw interleaved unsigned-8-bit IQ**
(`I0,Q0,I1,Q1,…`), each byte biased at 127.5. That is exactly the RTL2832U's native USB bulk
format — the same bytes `rtl_tcp` forwards. The decode already exists and is unit-tested:

```
lib/rtlTcp.ts  decodeIqU8(buf):  i[k] = (buf[2k]   - 127.5)/127.5
                                 q[k] = (buf[2k+1] - 127.5)/127.5
```

So an embedded driver only has to:

1. **Claim** the USB device (Android USB Host API — `UsbManager`, runtime permission).
2. **Init** the RTL2832U demod + R820T2/R860 tuner (reset, sample rate / resampler, IF, AGC;
   tuner PLL for center frequency; gain).
3. **Stream** IQ via USB **bulk** transfers on the RTL2832U's bulk-IN endpoint.
4. **Surface** those u8 bytes to JS, where the *existing* `decodeIqU8` → `detectLora` pipeline
   consumes them unchanged.

Nothing downstream of the raw-u8 boundary changes. That boundary is the whole integration
surface, and it is tiny.

---

## 3. USB enumeration & permission flow (Android USB Host)

Well-documented, low-risk. Public reference: Android USB Host guide
(`developer.android.com/develop/connectivity/usb/host`) and `android.hardware.usb.*`.

### 3.1 Identify the device

RTL2832U dongles enumerate as a vendor-specific USB device. Target VID/PID pairs (publicly known,
same table used by every open RTL-SDR tool's udev rules):

| VID (idVendor) | PID (idProduct) | Notes |
|---|---|---|
| `0x0BDA` | `0x2838` | Realtek — **generic RTL2832U** (most NESDR incl. Nano 3) |
| `0x0BDA` | `0x2832` | Realtek — RTL2832U (DVB-T mode variant) |
| `0x0BDA` | `0x2831` | RTL2831U (older) |
| `0x0BDA` | `0x2834`/`0x2837`/`0x2839` | clone/OEM variants |
| `0x1D19` | `0x1101`…`0x1105` | Dexatek clones |
| `0x0CCD` | `0x00A9`/`0x00B3`/… | Terratec clones |
| `0x1B80` | `0xD3A4`/`0xD393`/… | misc OEM |

Ship the list as data; match on `(vendorId, productId)`. Fall back to interface-class heuristics
only if a device is otherwise unmatched (avoid grabbing unrelated vendor-specific devices).

Provide an `res/xml/device_filter.xml` `<usb-device>` filter so Android can offer "open Sentinel
when this device is attached" (via `USB_DEVICE_ATTACHED` intent). This is optional but improves UX
and is additive to the manifest at prebuild time.

### 3.2 Permission

1. `UsbManager.getDeviceList()` → find a device matching the VID/PID table.
2. If `!usbManager.hasPermission(device)`, call `usbManager.requestPermission(device, pendingIntent)`
   with a `PendingIntent` for a private broadcast action (use `FLAG_IMMUTABLE` on API 31+).
3. On the broadcast, read `EXTRA_PERMISSION_GRANTED`. If granted, `usbManager.openDevice(device)`
   → `UsbDeviceConnection`.
4. `connection.claimInterface(iface, /*force=*/true)` on interface 0.

### 3.3 Endpoints

RTL2832U interface 0 exposes:
- one **bulk IN** endpoint (`UsbConstants.USB_ENDPOINT_XFER_BULK`, `USB_DIR_IN`) — the IQ stream
  (endpoint address `0x81` on stock firmware);
- control transfers (endpoint 0) are used for all register access.

Find the bulk-IN endpoint by iterating `iface.getEndpoint(n)` and matching type+direction rather
than hard-coding `0x81`.

---

## 4. RTL2832U register/init sequence (functional, clean-room)

**Source of register meaning:** Realtek *RTL2832U DVB-T COFDM Demodulator + USB 2.0* datasheet
(Rev 1.4, publicly circulated) plus the **publicly published register semantics** documented by
the open RTL-SDR community (osmocom wiki, rtl-sdr-blog docs, Linux kernel `dvb-frontends/rtl2832.c`
*as documentation of register meaning only*). We describe **what** each step does and **which
register/bit** it touches; we do **not** transcribe GPL code. See §8 for the clean-room boundary.

### 4.1 Register access model

The RTL2832U is programmed through **USB control transfers**, not raw register pokes. Two access
primitives (this much is architectural and public):

- **Demod register** read/write: control transfer to the demod address space, addressed by
  `(page, address)` with a 1- or 2-byte value. Demod writes conventionally use `bmRequestType`
  host→device, `wIndex` encoding the page, `wValue` the address.
- **USB/system block** read/write (the `USB_*`, `SYS_*`, `GPIO`, I²C-repeater blocks): control
  transfer to a different address block.
- **Tuner (I²C) access:** the RTL2832U has an **I²C repeater**; tuner registers are written by
  wrapping the tuner's 7-bit I²C address + payload in a demod control transfer that the repeater
  forwards on the internal I²C bus. The R820T2 sits at I²C address `0x1A` (7-bit) → `0x34` write.

> These primitives are the *interface contract* of the chip (documented behavior), not
> copyrightable expression. The exact byte layout is recovered from the datasheet + register
> descriptions and **must be re-derived**, not copied. Mark the helper functions `ctrlWrite`,
> `demodWrite`, `demodRead`, `i2cWrite` with a "clean-room: derived from datasheet §X" comment.

### 4.2 Demod bring-up (functional order)

1. **USB init.** Configure the USB block: enable the bulk FIFO, set `USB_SYSCTL` / `USB_EPA_*`
   so endpoint A (bulk IN) is in bulk mode with the right max transfer size; reset the EPA FIFO.
2. **Demod soft reset.** Assert then deassert the demod soft-reset bit (`DEMOD_CTL` / `SOFT_RST`)
   to bring the DDC into a known state.
3. **Enable the digital path for I/Q output.** Put the demod in the mode where it outputs the
   ADC's I/Q after the digital down-converter rather than DVB-T MPEG-TS. (This is the "SDR mode"
   the community documents: disable the DVB-T frame processing, route the 8-bit I/Q to the bulk
   FIFO.) Set the ADC I & Q enables.
4. **Set the DDC IF frequency (`pset_iffreq`).** The tuner delivers a low-IF signal; the demod's
   digital down-converter must mix it to zero. IF is programmed via demod page-1 registers
   `0x19/0x1A/0x1B` as a 22-bit value:

   ```
   if_word = round( (if_hz * 2^22) / xtal_hz ) with sign convention negated
   ```

   For the R820T2 the tuner IF is a fixed **3.57 MHz** (public R820T2 figure); with the standard
   **28.8 MHz** crystal this yields the well-known constant. Compute it, do not hard-code a magic
   number — this keeps it clean-room and crystal-portable.
5. **Set sample rate (resampler ratio `rsamp_ratio`).** The ADC runs off the 28.8 MHz clock; a
   fractional resampler decimates to the requested output sample rate. Program the resampler
   registers (page-1 `0x9F/0xA1` region) with:

   ```
   rsamp_ratio = floor( (xtal_hz * 2^22) / sample_rate_hz ) & ~3
   ```

   Valid output rates are the documented RTL bands **225001–300000 Hz** and **900001–3200000 Hz**
   (the app uses 1.024 Msps — see `rfSensorService.SAMPLE_RATE`). Optionally program the crystal-
   error correction registers (`0x3E/0x3F`) — leave at 0 for v1.
6. **AGC / IF gain path.** For presence detection we mirror the shipped config
   (`RtlTcpClient.configure` → auto gain + AGC on): enable the demod's digital AGC loop, or, for
   manual gain, disable it and drive the tuner's LNA/VGA gains directly (§5.4). Set the spectrum
   inversion bit consistent with the IF sign chosen in step 4.
7. **Flush / reset the bulk FIFO** immediately before streaming so the first frame is aligned.

**Confidence:** steps 1–2, 5, 7 are well-documented and low-risk. Steps 3, 4, 6 (exact SDR-mode
routing bits and IF sign/inversion interplay) are the parts most likely to need **hardware-in-the-
loop** confirmation — a logic-level "does IQ come out and is the spectrum the right way round"
check against a known CW source (see §7 milestones).

---

## 5. R820T2 / R860 tuner init + PLL tuning (functional, clean-room)

**Source:** the **R820T2 Register Description** PDF officially released by Rafael Micro and
mirrored publicly by rtl-sdr.com (`rtl-sdr.com/.../R820T2_Register_Description.pdf`), plus the
R820T datasheet. This is the *authoritative public* register map — using it is exactly what makes
this route clean-room. The R860 (found in newer/"v4" NESDRs) is register-compatible with the
R820T2 for our purposes; treat identically and gate any deltas behind a detected-tuner switch.

The R820T2 exposes **32 one-byte registers (0x00–0x1F)**; the low 5 (0x00–0x04) are read-only
status (incl. PLL lock). All writes go through the RTL2832U I²C repeater (§4.1). Writes are
typically done as a contiguous block from a shadow array (cache the 32 bytes, modify, flush the
changed ones) — this pattern is public/architectural, not GPL-specific.

### 5.1 Tuner reset / standard init

Write the documented **initial register block** that powers up the analog front-end: enable the
internal LDO/regulator, LNA, mixer, and VGA; set the loop-through / power-management bits to the
"tuner active" state. The concrete initial values come from the register description PDF; write
them as a named, commented constant table `R820T2_INIT[]` with a datasheet cite per meaningful
byte, **re-derived from the PDF**, not lifted from `r82xx.c`.

### 5.2 Set the IF / tracking filter

Configure the tuner output IF to the **3.57 MHz** low-IF that step 4.4 assumes, and set the
tracking RF filter + image-rejection to the band being scanned. For our fixed sub-GHz bands
(433/868/915 MHz — `RF_SCAN_BANDS`) the filter settings are nearly constant, which simplifies v1:
we can precompute one filter config per band instead of the full continuous auto-tune tables.

### 5.3 PLL tuning (center frequency)

The R820T2 LO is a **fractional-N PLL with sigma-delta modulator**. Public tuning math:

```
lo_hz   = rf_hz + if_hz                       # low-IF: LO sits IF above the RF of interest
mix_div = smallest power-of-2 divider s.t. vco is in the PLL's valid VCO band
vco_hz  = lo_hz * mix_div
nint    = floor(vco_hz / (2 * xtal_hz))
vco_fra = vco_hz - 2 * xtal_hz * nint
sdm     = round( vco_fra * 65536 / (2 * xtal_hz) )   # 16-bit fractional word
```

Then:
1. Select the VCO divider (`mix_div`) register bits for the current band.
2. Write `nint` (integer-N) and the divider-select register.
3. Write the 16-bit `sdm` fractional word (two registers, hi/lo).
4. **Poll the PLL-lock status bit** (read-only reg 0x02). If not locked near a band edge, nudge
   the range (the public drivers step by ~0.1/1.0 MHz and retry) and re-solve.

`xtal_hz` is the shared 28.8 MHz reference (the RTL2832U clocks the tuner). Keep `if_hz`
consistent with the demod DDC (§4.4) — the two must agree or the signal won't land at baseband.

### 5.4 Gain

- **Auto (default, matches shipped path):** enable the tuner's internal AGC for LNA + mixer + VGA
  and let the demod digital AGC close the loop. This mirrors `configure({gain:'auto'})`.
- **Manual:** disable auto and write the LNA-gain, mixer-gain, and VGA-gain register nibbles from
  the documented gain-step tables to hit a target dB (the `SET_GAIN` tenths-of-dB semantics in
  `RTL_CMD`). v1 can ship auto-only; manual gain is a fast follow.

**Confidence:** the PLL math and register map are **fully public and well-understood** — this is
the *best-documented* part of the whole stack. The residual risk is the **initial register block
values** (5.1) and per-band **tracking-filter/image-rejection** tuning (5.2), which have known-good
public values but benefit from a quick real-signal sanity check.

---

## 6. Bulk IQ transfer loop & mapping to `decodeIqU8`

### 6.1 The loop

RTL2832U streams continuously once the FIFO is enabled. Read with **large bulk transfers** on the
bulk-IN endpoint. Two Android options:

- **Sync:** `UsbDeviceConnection.bulkTransfer(endpoint, buf, len, timeoutMs)` on a dedicated
  background thread. Simple; adequate at 1.024 Msps (≈2.05 MB/s).
- **Async (preferred for headroom):** `UsbRequest.queue()` with a pool of ~8–16 buffers of
  **16 KiB–256 KiB** each, drained via `UsbDeviceConnection.requestWait()`. This is the standard
  double/triple-buffering pattern and avoids sample drops during GC pauses.

Buffer sizing: use a multiple of the URB size (multiples of 512-byte USB packets; 64–256 KiB is
typical). The app captures `FRAME_SAMPLES = 32768` complex samples (= **65536 bytes**) per band
snapshot (`rfSensorService`), so a 64 KiB read yields roughly one frame.

### 6.2 The format is already exactly right

The bytes off the endpoint are **interleaved unsigned-8-bit I,Q**, bias 127.5 — *identical* to
what `rtl_tcp` sends *minus the 12-byte "RTL0" header* (`rtlTcp.ts isRtlHeader`). So:

- **No transform in native.** Hand the raw `ByteArray` up as-is.
- On the JS side the existing `decodeIqU8` already does the `(b-127.5)/127.5` conversion; the
  existing `RtlTcpClient` already does frame assembly and the `capture(nSamples)` windowing.

The only subtlety vs. the TCP path: the embedded stream has **no 12-byte dongle header**. Two easy
choices — either (a) have the native side never emit a header and set `headerSeen=true` at the
adapter, or (b) synthesize a 12-byte `RTL0…` preamble once so `RtlTcpClient.receive()` strips it
unchanged. Option (b) is a one-line native prepend that lets us reuse `RtlTcpClient` **verbatim**.

---

## 7. Integration options — A vs B

Both feed the same `lib/loraDetect.ts` DSP. The question is *how the native u8 IQ reaches JS* and
*how tune/rate/gain commands reach native*.

### Option A — Embedded native module directly backing `RtlTransport`

The native module exposes a JS bridge (Expo Module). A thin TS adapter implements the existing
`RtlTransport` interface (`rfSensorService.registerRtlTransport`). Crucially, the adapter returns
an `RtlSocket` whose `write(bytes)` forwards the **existing 5-byte rtl_tcp command frames**
(`RTL_CMD.SET_FREQ`, `SET_SAMPLE_RATE`, `SET_GAIN`, …) into the native module, which parses the
command byte + u32 param and calls the corresponding chip routine (§4/§5). Native pushes IQ bytes
back through the `onData` callback (with the one-line synthesized header from §6.2).

```
detectLora ── rfSensorService ── RtlTcpClient (UNCHANGED) ── RtlSocket adapter
                                                                    │ write(5-byte cmd)   ▲ onData(u8 IQ)
                                                                    ▼                     │
                                                      Expo native module (Kotlin) ── USB bulk / control
```

- **Reuses:** *all* of `rtlTcp.ts` (command encode + frame assembly + `decodeIqU8`) and *all* of
  `rfSensorService.ts`, **verbatim**. The 5-byte command frame becomes a tiny local RPC.
- **Adds:** one small TS adapter + the native module. **No new npm dependency.**
- **Cost:** no TCP loopback; lowest latency/CPU; single process; fewest moving parts.
- **Risk:** native must implement a (trivial) 5-byte command parser.

### Option B — Embedded native module runs a localhost `rtl_tcp` server

The native module owns USB **and** binds a TCP server on `127.0.0.1:1234` speaking the `rtl_tcp`
wire protocol (12-byte header + 5-byte commands + raw IQ). JS connects with a real socket
(`react-native-tcp-socket`) exactly as the companion-app path does today.

- **Reuses:** the *entire* existing path with **literally zero JS change** — it is a drop-in
  replacement for the companion app.
- **Adds:** `react-native-tcp-socket` (new npm dep, new prebuild), **and** a full native `rtl_tcp`
  server (accept loop, per-client command parser, backpressure) — strictly *more* native code than
  A, plus the same USB/chip code.
- **Cost:** loopback socket overhead + a server thread + a client socket; two extra failure modes
  (bind races, socket teardown).
- **Upside:** it also transparently works with the *real* `rtl_tcp` ecosystem and desktop tooling,
  and keeps native/JS maximally decoupled.

### Recommendation → **Option A**

Recommend **A**: it reuses the already-unit-tested `rtlTcp.ts`/`rfSensorService.ts` pipeline
verbatim while deleting the TCP loopback, the `react-native-tcp-socket` dependency, and an entire
native `rtl_tcp` server — the least code and the fewest moving parts to reach the same IQ. Keep B
as a documented fallback: if the native USB layer proves flaky, a localhost `rtl_tcp` server is the
most compatible shape and lets us swap between embedded and companion-app sources with no JS diff.

---

## 8. Licensing — why this is clean-room permissive, and how to keep it

**Goal:** ship this inside the proprietary Sentinel APK with a **permissive** (MIT/BSD/Apache-2.0)
in-house driver, incurring **no GPL obligation**.

- **The problem is `librtlsdr` (GPLv2).** Copying it, translating it to Kotlin, or deriving from
  reading its source would make our driver a derivative work → GPL. We must not do any of that.
- **What is *not* restricted:** the **facts** — VID/PIDs, register addresses, bit meanings, the
  PLL tuning math, the USB control-transfer contract. These come from **public, non-GPL sources**:
  - Realtek *RTL2832U* datasheet (Rev 1.4).
  - Rafael Micro **R820T2 Register Description** PDF (officially released; mirrored by rtl-sdr.com)
    and the R820T datasheet.
  - Android USB Host public API docs.
  - Osmocom / rtl-sdr-blog *prose* documentation and the Linux kernel `rtl2832.c` **as a
    description of register semantics** — read for *what a register means*, never copied as code.
  Register maps and hardware interface contracts are functional facts, not protectable expression.

**Rules to keep it clean (enforce in review):**
1. **No GPL source open while writing.** Author from datasheets/register-descriptions only. If a
   value's only known source is GPL code, treat it as *needs hardware re-derivation* (§7 flags
   these) rather than copying.
2. **Cite the public source** for every non-obvious constant/sequence in a code comment
   (`// clean-room: R820T2 Register Description §<reg>` / `// RTL2832U datasheet §<x>`).
3. **Compute, don't magic-number.** Derive IF word, resampler ratio, and PLL words from formulas +
   the crystal constant so the code demonstrably encodes public math, not copied literals.
4. **Provenance record.** Keep a short `native/rtl-embedded/CLEANROOM.md` listing sources consulted
   and explicitly stating `librtlsdr`/other GPL was **not** used. (README in the module folder
   carries this.)
5. **License header** MIT/Apache-2.0 on every new native file; add the module to the app's OSS
   attributions as our own permissive component.

This mirrors how permissive RTL drivers for other platforms (e.g. some MIT SDR stacks) were built:
same registers, independently authored, cited to the public register descriptions.

---

## 9. Effort / risk estimate & phased milestones

**Overall:** medium effort, medium-high *validation* risk (all of it hardware-in-the-loop). The
software surface is small and the DSP is done; the risk is entirely "did we bring the chip up
correctly," which is only answerable with the dongle in hand. Rough order: **~2–4 focused weeks**
for a native dev with USB experience to reach reliable IQ, plus calendar time for hardware loops.

| Phase | Deliverable | Risk | Notes |
|---|---|---|---|
| **M0 — USB claim** | Enumerate, permission, claim iface, read EEPROM/USB block, log endpoints | Low | Proves the Android USB Host layer end-to-end; no RF yet. Scaffold here (§Deliverables). |
| **M1 — Register plumbing** | `ctrlWrite/demodWrite/demodRead/i2cWrite` verified by reading back known demod + tuner status registers (incl. tuner ID / PLL-lock) | Low–Med | Confirms the control-transfer + I²C-repeater contract before any tuning. |
| **M2 — Demod SDR mode + bulk IQ** | Enable I/Q output, set 1.024 Msps resampler, stream bulk; get *noise* IQ that isn't stuck/zero | **Med** | The SDR-mode routing bits (§4.3) are the first real reverse-validation point. |
| **M3 — Tuner PLL lock** | R820T2 init block + PLL to 433/868/915 MHz; confirm lock bit; inject a known CW/beacon and see the tone at the right bin | **Med** | Validates §5 + IF/inversion agreement with §4.4. Use a cheap 433 MHz keyfob or signal gen. |
| **M4 — Pipeline integration (Option A)** | RtlSocket adapter → `RtlTcpClient`; run a real LoRa/ELRS link past `detectLora`; confirm `RfLinkDetection` fires | Low | Pure glue; DSP already tested. Compare against the rtl_tcp path on the same signal. |
| **M5 — Robustness** | Manual gain, hot-plug/detach, permission-revoke, thermal duty-cycle, buffer-underrun handling, R860/"v4" tuner variant | Med | Field-hardening; async URB pool; graceful `getRfModuleStatus` states. |

**Gating dependency:** M2–M3 require a physical NESDR Nano 3 (and ideally the R860/"v4" variant) on
a real Android USB-OTG host. Until then, M0–M1 and the M4 glue can be built and unit-shaped against
the existing tests, but **cannot be signed off**.

**Kill/fallback criteria:** if M2/M3 stall on undocumented SDR-mode bits, fall back to **Option B**
shape but *still embedded* (our own `rtl_tcp` server) — or, worst case, keep the companion-app
Route 1 as the shipping path and hold Route C as R&D. No downstream code depends on which route
wins, by construction (§2).

---

## 10. What ships in this changeset (scaffold only)

- **This document.**
- `native/rtl-embedded/` — a compile-shaped Kotlin USB-host module + TS bridge stub + README,
  with explicit `TODO(cleanroom)` / `TODO(hw)` markers everywhere the register sequences and
  hardware validation go. It does **not** function yet; it is a correct starting structure for a
  native dev to fill in per §4–§6, wired to integrate via **Option A** (§7).

Nothing existing is modified. No `expo prebuild`, no `package.json`/`app.json` changes — the module
is dropped into the native project at the next prebuild by whoever picks up M0.
