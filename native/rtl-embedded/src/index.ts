/**
 * index.ts -- JS bridge + Option-A RtlTransport adapter for the embedded RTL-SDR
 * native module (Route C). See docs/RF-EMBEDDED-DRIVER-PLAN.md §7 (Option A).
 *
 * SKELETON. This wires the (stub) native module to the app's EXISTING seam:
 *   rfSensorService.registerRtlTransport(makeEmbeddedRtlTransport())
 * so the entire tested lib/rtlTcp.ts + lib/rfSensorService.ts pipeline is reused
 * VERBATIM -- the native module just parses the 5-byte rtl_tcp command frames and
 * pushes raw u8 IQ back. No TCP loopback, no react-native-tcp-socket, no new dep.
 *
 * IMPORTANT: this file is additive and NOT imported by the app yet (that wiring
 * happens after prebuild links the native module). It references the app's types
 * only structurally to avoid creating an import edge into lib/ during scaffolding.
 */

import type {
  RtlEmbeddedNativeModule,
  RtlIqDataEvent,
} from './RtlEmbedded.types';

// ---------------------------------------------------------------------------
// Native module handle.
// TODO(native): once the Expo module is linked at prebuild, replace this stub
// with:  import { requireNativeModule } from 'expo-modules-core';
//        const Native = requireNativeModule<RtlEmbeddedNativeModule & EventEmitter>('RtlEmbedded');
// The stub below lets this file typecheck in the managed project pre-prebuild.
// ---------------------------------------------------------------------------
const NOT_LINKED = 'RtlEmbedded native module is not linked yet (run prebuild). See native/rtl-embedded/README.md';

const Native: (RtlEmbeddedNativeModule & {
  addListener(event: 'onIqData', cb: (e: RtlIqDataEvent) => void): { remove(): void };
}) | null = null;

// ---------------------------------------------------------------------------
// Minimal structural mirrors of the app-side interfaces (lib/rtlTcp.ts,
// lib/rfSensorService.ts). Duplicated here (not imported) so the scaffold has no
// import edge into lib/ and cannot conflict with concurrent route-1 work. When
// this module is wired in, prefer importing the real types from '../../lib/*'.
// ---------------------------------------------------------------------------
interface RtlSocketLike {
  write(data: Uint8Array): void;
  close(): void;
}
interface RtlTransportLike {
  connect(
    host: string,
    port: number,
    onData: (chunk: Uint8Array) => void
  ): Promise<RtlSocketLike>;
}

/** Synthesize the 12-byte "RTL0" dongle header so RtlTcpClient.receive() strips it
 *  unchanged (plan §6.2 option b). tuner byte + gain-count are cosmetic for us. */
function rtl0Header(): Uint8Array {
  const h = new Uint8Array(12);
  h[0] = 0x52; h[1] = 0x54; h[2] = 0x4c; h[3] = 0x30; // "RTL0"
  // bytes 4..7: tuner type (big-endian u32) -- 5 == R820T in rtl_tcp convention
  h[7] = 0x05;
  // bytes 8..11: gain count -- left 0; unused by our pipeline
  return h;
}

/**
 * Build an RtlTransport backed by the embedded native module. Drop-in for
 * rfSensorService.registerRtlTransport(). The returned socket forwards the exact
 * 5-byte rtl_tcp command frames (from RtlTcpClient) into native, and native's
 * IQ bulk stream is delivered back through `onData`.
 *
 * host/port are ignored (kept for interface parity with the TCP transport).
 */
export function makeEmbeddedRtlTransport(): RtlTransportLike {
  return {
    async connect(_host, _port, onData): Promise<RtlSocketLike> {
      if (!Native) throw new Error(NOT_LINKED);

      const devices = await Native.listDevices();
      const dev = devices[0];
      if (!dev) throw new Error('No RTL2832U USB device attached');
      if (!dev.hasPermission && !(await Native.requestPermission(dev.deviceName))) {
        throw new Error('USB permission denied');
      }

      // Open with placeholder config; RtlTcpClient.configure() immediately follows
      // via write() of the 5-byte SET_SAMPLE_RATE/SET_GAIN frames.
      await Native.open(dev.deviceName, {
        sampleRateHz: 1_024_000,
        centerHz: 433_920_000,
        gainTenthDb: 'auto',
      });

      // Deliver the synthetic header once so the existing header-strip path is a no-op change.
      onData(rtl0Header());

      const sub = Native.addListener('onIqData', (e: RtlIqDataEvent) => {
        onData(e.data);
      });

      await Native.startStream();

      return {
        write(frame: Uint8Array): void {
          // Forward the 5-byte rtl_tcp command verbatim; native parses it (plan §7 Option A).
          // Fire-and-forget: RtlSocket.write is sync in the app's interface.
          void Native.sendCommand(frame);
        },
        close(): void {
          sub.remove();
          void Native.close();
        },
      };
    },
  };
}

export * from './RtlEmbedded.types';
