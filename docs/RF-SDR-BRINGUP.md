# RF SDR bring-up — getting Sentinel to see the RTL-SDR

## Why the app didn't register the dongle

Sentinel had **no native USB code**. The RF pipeline (dechirp DSP, rtl_tcp protocol
client, scan loop, RF tab) was all built and tested, but the `RtlTransport` seam in
`lib/rfSensorService.ts` was never wired to a real socket, so `getRfModuleStatus()`
always returned "no module". Android/Windows seeing a USB device is the OS; the app
had nothing that claimed it as an SDR.

A USB SDR **cannot** work in Expo Go or a managed build — it needs native code. So
step one is always a **native dev build**.

## What's wired now (route A — companion driver + TCP transport)

- `lib/rtlTransportNative.ts` — a real `RtlTransport` over `react-native-tcp-socket`.
  Lazy/defensive require: inert under Expo Go, active in a dev build.
- `App.tsx` — calls `installRtlTransport()` once at startup (safe no-op if the
  native module isn't present).
- `lib/rfSensorService.ts` — `setRtlEndpoint(host, port)` / `getRtlEndpoint()` so the
  endpoint can point at the on-phone driver app **or** a networked `rtl_tcp` for
  bench testing; connect failures are surfaced via `getRfLastError()`.
- RF tab shows *why* a scan couldn't start (no rtl_tcp server, etc.).

The app talks to the dongle as `rtl_tcp` over a local TCP socket. Something has to
serve that — the companion **RTL-SDR driver app** does USB enumeration + permission
and re-exports the dongle as `rtl_tcp` on `127.0.0.1:1234`.

## Get it on the phone

1. **Build a dev client APK** (EAS prebuilds in the cloud; no local Android SDK needed):
   ```
   eas build --profile development --platform android
   ```
   Install the resulting APK on the phone.
2. **Install a companion RTL-SDR driver app** from the Play Store (e.g. Martin
   Marinov's "RTL2832U driver" / rtl_tcp). Plug in the dongle via USB-C OTG, open the
   driver app, **grant USB permission**, and start its `rtl_tcp` server (127.0.0.1:1234).
3. **Run Sentinel** (`npx expo start --dev-client`, open in the dev build). Go to the
   **RF tab → CONTROL LINKS → SCAN CONTROL LINKS**. It connects to the driver app and
   streams IQ through the dechirp detector; LoRa/ELRS sub-GHz links appear as detections.

## Bench-test on this PC first (optional, real hardware, no phone build)

The dongle currently enumerates on Windows as "Bulk-In, Interface" with a driver
error — it needs the WinUSB driver:

1. Install rtl-sdr Windows tools (osmocom / Zadig). Run **Zadig**, select the RTL
   device (Interface 0), install **WinUSB**.
2. Serve it on the LAN: `rtl_tcp -a <this-PC-LAN-IP> -p 1234`
3. In a dev build, call `setRtlEndpoint('<this-PC-LAN-IP>', 1234)` before scanning
   (phone + PC on same network) to validate the full pipeline against real RF.

Route C (embedded USB driver, no companion app) is tracked separately in
`docs/RF-EMBEDDED-DRIVER-PLAN.md`.
