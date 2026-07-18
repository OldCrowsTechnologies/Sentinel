/**
 * rtlTransportEmbedded.ts -- the EMBEDDED RtlTransport (Route C, Option A).
 * Backed by the in-house clean-room `RtlEmbedded` Expo native module
 * (native/rtl-embedded/), it claims the RTL2832U over USB DIRECTLY -- no companion
 * driver app, no react-native-tcp-socket, no TCP loopback. See
 * docs/RF-EMBEDDED-DRIVER-PLAN.md §7 (Option A).
 *
 * WHY this shape: the native module parses the EXACT 5-byte rtl_tcp command frames
 * that RtlTcpClient (lib/rtlTcp.ts) already emits and pushes raw interleaved-u8 IQ
 * back through the 'onIqData' event -- so the entire tested rtlTcp.ts +
 * rfSensorService.ts pipeline is reused VERBATIM. The only seam is this adapter.
 *
 * Requires a native build that links the module (autolinked at prebuild via
 * native/rtl-embedded/expo-module.config.json). Under Expo Go / any bundle where
 * the module isn't present, requireNativeModule throws, we return null, and
 * rfSensorService falls back to the companion-app TCP transport (rtlTransportNative)
 * or the honest "no SDR" state. Receive-only: nothing here ever transmits.
 *
 * STATUS: the JS seam is complete; the native module's register bring-up
 * (RTL2832U demod + R820T2 PLL) is hardware-gated (plan §9, M2/M3). Until that is
 * filled in and validated on the dongle, this transport connects but yields no IQ.
 */

import { registerRtlTransport, type RtlTransport } from './rfSensorService';
import type { RtlSocket } from './rtlTcp';

// Minimal structural mirror of the native module surface (see
// native/rtl-embedded/src/RtlEmbedded.types.ts). Kept local so this file has no
// build-time edge into the module package (which is android-only + prebuild-linked).
interface RtlUsbDeviceInfo {
  deviceName: string;
  vendorId: number;
  productId: number;
  hasPermission: boolean;
  tuner?: string | null;
}
interface RtlEmbeddedNative {
  listDevices(): Promise<RtlUsbDeviceInfo[]>;
  requestPermission(deviceName: string): Promise<boolean>;
  open(
    deviceName: string,
    config: { sampleRateHz: number; centerHz: number; gainTenthDb?: number | 'auto' }
  ): Promise<RtlUsbDeviceInfo>;
  sendCommand(frame: Uint8Array): Promise<void>;
  startStream(): Promise<void>;
  stopStream(): Promise<void>;
  close(): Promise<void>;
  addListener(event: string, cb: (e: { data: unknown }) => void): { remove(): void };
}

// Defensive, lazy require so bundles without the native module (Expo Go, the
// current demo APK, any pre-prebuild build) can't crash at load time. Returns the
// native module or null.
function loadEmbedded(): RtlEmbeddedNative | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireNativeModule } = require('expo-modules-core');
    return requireNativeModule('RtlEmbedded') as RtlEmbeddedNative;
  } catch {
    return null;
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const outLen = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return o === outLen ? out : out.subarray(0, o);
}

// The 'onIqData' payload is raw interleaved u8 IQ. Expo delivers a Kotlin ByteArray
// as a Uint8Array over JSI; some bridge configs hand back a base64 string instead.
function toUint8(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === 'string') return base64ToBytes(data);
  const anyd = data as { length?: number } | null;
  if (anyd && typeof anyd.length === 'number') return Uint8Array.from(anyd as ArrayLike<number>);
  return new Uint8Array(0);
}

/** Synthesize the 12-byte "RTL0" dongle header so RtlTcpClient.receive() strips it
 *  unchanged (plan §6.2 option b). The embedded USB stream carries no such header;
 *  emitting it once keeps the header-strip path in rtlTcp.ts a no-op change.
 *  Byte 7 = tuner type 5 (R820T) per the rtl_tcp convention; gain-count left 0. */
function rtl0Header(): Uint8Array {
  const h = new Uint8Array(12);
  h[0] = 0x52; // 'R'
  h[1] = 0x54; // 'T'
  h[2] = 0x4c; // 'L'
  h[3] = 0x30; // '0'
  h[7] = 0x05; // tuner type: R820T
  return h;
}

const SAMPLE_RATE = 1_024_000; // must match rfSensorService.SAMPLE_RATE

/**
 * Build an embedded RtlTransport, or null if the native module isn't linked
 * (Expo Go / managed / pre-prebuild). host/port are ignored -- kept for parity
 * with the TCP transport's RtlTransport signature. rfSensorService treats null as
 * "no module" and callers fall back to the companion-app transport.
 */
export function createEmbeddedRtlTransport(): RtlTransport | null {
  const Native = loadEmbedded();
  if (!Native || typeof Native.listDevices !== 'function') return null;

  return {
    async connect(
      _host: string,
      _port: number,
      onData: (chunk: Uint8Array) => void
    ): Promise<RtlSocket> {
      const devices = await Native.listDevices();
      const dev = devices[0];
      if (!dev) throw new Error('No RTL2832U USB device attached');
      if (!dev.hasPermission && !(await Native.requestPermission(dev.deviceName))) {
        throw new Error('USB permission denied for RTL-SDR');
      }

      // Open + run the chip bring-up. RtlTcpClient.configure() immediately follows
      // this via write() of the 5-byte SET_SAMPLE_RATE / SET_GAIN / SET_FREQ frames.
      await Native.open(dev.deviceName, {
        sampleRateHz: SAMPLE_RATE,
        centerHz: 433_920_000,
        gainTenthDb: 'auto',
      });

      // Deliver the synthetic header once, before any IQ, so the existing
      // header-strip path in RtlTcpClient.receive() consumes it unchanged.
      onData(rtl0Header());

      const sub = Native.addListener('onIqData', (e: { data: unknown }) => {
        onData(toUint8(e.data));
      });

      await Native.startStream();

      return {
        write: (frame: Uint8Array) => {
          // Forward the 5-byte rtl_tcp command verbatim; native parses + applies it
          // (plan §7 Option A -> RtlCommand.dispatch). Fire-and-forget: the app's
          // RtlSocket.write is synchronous.
          void Native.sendCommand(frame).catch(() => {
            /* device may have detached mid-scan; capture timeout surfaces it */
          });
        },
        close: () => {
          sub.remove();
          void Native.stopStream().catch(() => {});
          void Native.close().catch(() => {});
        },
      };
    },
  };
}

/**
 * Register the embedded transport if the native module is linked. Safe no-op
 * (returns false) otherwise, leaving the caller to fall back to the companion-app
 * TCP transport. Prefer this over the TCP path when both are available: it needs
 * no second app and no loopback socket.
 */
export function installEmbeddedRtlTransport(): boolean {
  const t = createEmbeddedRtlTransport();
  if (t) registerRtlTransport(t);
  return t != null;
}
