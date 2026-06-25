/**
 * openDroneId.ts -- pure-TS parser for ASTM F3411 / OpenDroneID Remote ID
 * messages carried in Bluetooth advertisements.
 *
 * This is the testable core of Tier-2 (phone-native RF). It takes the Service
 * Data bytes for ASTM UUID 0xFFFA and extracts the fields we surface: the UAS
 * ID, the drone's broadcast position, and -- the high-value part -- the
 * OPERATOR's position. No native deps; the BLE scan that feeds it lives in
 * remoteIdService.ts.
 *
 * Spec note: each ODID message is 25 bytes. The Service Data payload is
 * [ appCode(0x0D), msgCounter, message(s) ]. A message whose header type is 0xF
 * is a "message pack" wrapping several 25-byte messages.
 */

export interface RemoteIdParsed {
  uasId?: string; // serial / registration
  uaType?: number;
  droneLat?: number;
  droneLon?: number;
  operatorLat?: number;
  operatorLon?: number;
  operatorId?: string;
}

const MSG_SIZE = 25;
const APP_CODE = 0x0d;

/** Decode a base64 string (BLE serviceData value) to bytes. RN-safe, no Buffer. */
export function base64ToBytes(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Int16Array(256).fill(-1);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  const clean = b64.replace(/=+$/, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = lookup[clean.charCodeAt(i)];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

function int32LE(b: Uint8Array, i: number): number {
  // JS << is signed-32, so this yields a signed value directly.
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) | 0;
}

function ascii(b: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < start + len && i < b.length; i++) {
    const c = b[i];
    if (c === 0) break;
    if (c >= 32 && c < 127) s += String.fromCharCode(c);
  }
  return s.trim();
}

/** Parse one 25-byte ODID message into the accumulator. */
function parseMessage(m: Uint8Array, off: number, out: RemoteIdParsed): void {
  if (off + MSG_SIZE > m.length) return;
  const type = (m[off] >> 4) & 0x0f;
  switch (type) {
    case 0x0: // Basic ID
      out.uaType = m[off + 1] & 0x0f;
      out.uasId = ascii(m, off + 2, 20);
      break;
    case 0x1: // Location/Vector -> drone position (lat/lon at bytes 5..12)
      out.droneLat = int32LE(m, off + 5) / 1e7;
      out.droneLon = int32LE(m, off + 9) / 1e7;
      break;
    case 0x4: // System -> operator position (lat/lon at bytes 2..9)
      out.operatorLat = int32LE(m, off + 2) / 1e7;
      out.operatorLon = int32LE(m, off + 6) / 1e7;
      break;
    case 0x5: // Operator ID
      out.operatorId = ascii(m, off + 2, 20);
      break;
    default:
      break; // Auth / Self-ID / reserved: ignored
  }
}

/**
 * Parse the ASTM 0xFFFA Service Data payload. Returns null if it isn't an
 * OpenDroneID payload. Merge results across advertisements per device, since a
 * drone spreads message types over successive packets.
 */
export function parseServiceData(bytes: Uint8Array): RemoteIdParsed | null {
  if (bytes.length < 3 || bytes[0] !== APP_CODE) return null;
  const out: RemoteIdParsed = {};
  let p = 2; // skip appCode + message counter
  const headerType = (bytes[p] >> 4) & 0x0f;
  if (headerType === 0xf) {
    // Message pack: [header, msgSize, msgCount, messages...]
    const count = bytes[p + 2];
    p += 3;
    for (let i = 0; i < count; i++) {
      parseMessage(bytes, p, out);
      p += MSG_SIZE;
    }
  } else {
    while (p + MSG_SIZE <= bytes.length) {
      parseMessage(bytes, p, out);
      p += MSG_SIZE;
    }
  }
  return out;
}

function valid(lat?: number, lon?: number): boolean {
  return (
    lat != null && lon != null &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

export function hasDronePosition(r: RemoteIdParsed): boolean {
  return valid(r.droneLat, r.droneLon);
}
export function hasOperatorPosition(r: RemoteIdParsed): boolean {
  return valid(r.operatorLat, r.operatorLon);
}
