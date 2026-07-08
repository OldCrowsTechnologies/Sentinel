/**
 * rtlTransportNative.ts -- the native RtlTransport that finally lets Sentinel
 * see the SDR. Backed by react-native-tcp-socket, it opens a real TCP connection
 * to a local rtl_tcp server -- the RTL2832U USB driver app running on the phone
 * (127.0.0.1:1234), or a networked rtl_tcp on the LAN for bench testing -- and
 * pumps received IQ bytes into RtlTcpClient (via rfSensorService's data callback).
 *
 * WHY this is the seam: on Android an app can't claim a USB SDR without native
 * code. The proven, arms-length path is a companion driver app that owns USB
 * enumeration/permission and re-exports the dongle as rtl_tcp; we just need a
 * native TCP socket, which is the ONLY native dependency this adds.
 *
 * Requires a native dev build (the module is autolinked at prebuild). Under
 * Expo Go / any bundle without the native module, the require() fails, we
 * register nothing, and the app degrades to the honest "no SDR" state instead of
 * crashing. Receive-only: nothing here ever transmits.
 */

import { registerRtlTransport, type RtlTransport } from './rfSensorService';
import type { RtlSocket } from './rtlTcp';

// Defensive, lazy require so an import in a managed/Expo-Go bundle (no native
// module) can't crash the app at load time. Returns the module or null.
function loadTcpSocket(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-tcp-socket');
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

// react-native-tcp-socket delivers 'data' as a Buffer (a Uint8Array subclass),
// so this is usually a passthrough; the string branch covers versions/configs
// that hand back a latin1-encoded string, decoded 1:1 to preserve raw bytes.
function toUint8(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data; // Buffer included
  if (typeof data === 'string') {
    const out = new Uint8Array(data.length);
    for (let k = 0; k < data.length; k++) out[k] = data.charCodeAt(k) & 0xff;
    return out;
  }
  const anyd = data as { length?: number } | null;
  if (anyd && typeof anyd.length === 'number') return Uint8Array.from(anyd as ArrayLike<number>);
  return new Uint8Array(0);
}

/**
 * Build a native RtlTransport, or null if the TCP socket module isn't present
 * (managed workflow / Expo Go). rfSensorService treats null as "no module".
 */
export function createNativeRtlTransport(): RtlTransport | null {
  const TcpSocket = loadTcpSocket();
  if (!TcpSocket || typeof TcpSocket.createConnection !== 'function') return null;

  return {
    connect(host: string, port: number, onData: (chunk: Uint8Array) => void): Promise<RtlSocket> {
      return new Promise<RtlSocket>((resolve, reject) => {
        let settled = false;
        const socket = TcpSocket.createConnection({ host, port, tls: false }, () => {
          if (settled) return;
          settled = true;
          resolve({
            // Uint8Array is accepted by react-native-tcp-socket's write (wrapped
            // in Buffer internally); rtl_tcp commands are 5 bytes each.
            write: (d: Uint8Array) => {
              try {
                socket.write(d);
              } catch {
                /* socket may have closed mid-scan; capture timeout handles it */
              }
            },
            close: () => {
              try {
                socket.destroy();
              } catch {
                /* already gone */
              }
            },
          });
        });
        socket.on('data', (chunk: unknown) => onData(toUint8(chunk)));
        socket.on('error', (err: Error) => {
          if (!settled) {
            settled = true;
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      });
    },
  };
}

/**
 * Register the native transport if the native module is available. Safe no-op
 * (returns false, leaves the "no module" state) otherwise. Call once at startup.
 */
export function installRtlTransport(): boolean {
  const t = createNativeRtlTransport();
  if (t) registerRtlTransport(t);
  return t != null;
}
