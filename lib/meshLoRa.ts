/**
 * meshLoRa.ts -- compact binary codec for a gunshot beacon over LoRa (Tier L).
 *
 * meshTypes.ts carries the full JSON ContactReport for Tier S (Nearby / Wi-Fi
 * Aware, hundreds of kbps). LoRa is the opposite: kilometers of range but tens
 * of BYTES per second. This module packs the essential fields into a fixed
 * 26-byte frame so a shot beacon survives a LoRa payload -- the "compact binary
 * packing over the SAME fields" the meshTypes.ts header anticipates.
 *
 * PURE + self-contained (no transport, no crypto, no RN runtime) so it unit-tests
 * standalone -- same discipline as loraDetect.ts / shotDetect.ts. Authentication
 * (meshAuth.ts) wraps the OUTPUT of this codec; it is a separate concern.
 *
 * Layout (26 bytes, little-endian):
 *   0      flags:  bits0-3 = hasPos(bit0); bits4-7 = version
 *   1..2   nodeId  u16   (mesh short id; the gateway maps it to a call-sign)
 *   3..4   seq     u16   (monotonic per node, wraps -- dedup/loss detection)
 *   5..8   tSec    u32   (seconds since MESH_EPOCH; ~136 yr range)
 *   9..12  lat     i32   (deg * 1e7; 0 when !hasPos)
 *   13..16 lon     i32   (deg * 1e7; 0 when !hasPos)
 *   17     kind    u8    (KIND enum)
 *   18     label   u8    (LABEL enum -- weapon class)
 *   19     conf    u8    (0..100)
 *   20     peakDb  i8    (muzzle-blast energy over floor, dB; -128..127)
 *   21     shots   u8    (rounds in the event)
 *   22..23 rangeFt u16   (0xFFFF = unknown -- a single node cannot range)
 *   24..25 bearing u16   (0..359; 0xFFFF = none / mono mic)
 *
 * Time is SECONDS here, not ms: coarse alerting + report ordering only need that,
 * and it saves 2 bytes. TDOA carries its own sub-ms timing out of band -- it is
 * NOT this beacon's job (see SENTINEL-SHOTS-FIRED-ARCH.md).
 */

export const MESH_PROTO_VERSION = 1;
export const MESH_EPOCH_SEC = Date.UTC(2020, 0, 1) / 1000; // 2020-01-01T00:00:00Z
export const FRAME_BYTES = 26;

/** Sensor kind -> u8. Mirrors meshTypes.ContactKind. */
export const KIND = { acoustic: 0, rid: 1, lora: 2, wifi: 3, gunshot: 4 } as const;
export const KIND_NAME = ['acoustic', 'rid', 'lora', 'wifi', 'gunshot'] as const;

/** Weapon class -> u8. 0 = detected-but-unclassified (P1 default). */
export const LABEL = { unknown: 0, rifle: 1, handgun: 2, shotgun: 3 } as const;
export const LABEL_NAME = ['Unknown firearm', 'Rifle', 'Handgun', 'Shotgun'] as const;

export const RANGE_UNKNOWN = 0xffff;
export const BEARING_NONE = 0xffff;

export interface CompactReport {
  nodeId: number; // uint16
  seq: number; // uint16
  tSec: number; // seconds since MESH_EPOCH
  lat: number | null; // degrees
  lon: number | null; // degrees
  kind: number; // KIND enum
  label: number; // LABEL enum
  conf: number; // 0..100
  peakDb: number; // dB over floor
  shotCount: number; // rounds
  rangeFt: number; // feet, or RANGE_UNKNOWN
  bearing: number; // degrees, or BEARING_NONE
}

const clampInt = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(x)));

/** Wall-clock ms -> mesh seconds. */
export function toMeshSec(epochMs: number): number {
  return Math.max(0, Math.round(epochMs / 1000 - MESH_EPOCH_SEC));
}
/** Mesh seconds -> wall-clock ms. */
export function fromMeshSec(tSec: number): number {
  return (tSec + MESH_EPOCH_SEC) * 1000;
}

/** Pack a beacon into a 26-byte frame. Values are clamped, never allowed to overflow the field. */
export function packReport(r: CompactReport): Uint8Array {
  const buf = new ArrayBuffer(FRAME_BYTES);
  const dv = new DataView(buf);
  const hasPos = r.lat != null && r.lon != null;

  dv.setUint8(0, (hasPos ? 1 : 0) | ((MESH_PROTO_VERSION & 0x0f) << 4));
  dv.setUint16(1, clampInt(r.nodeId, 0, 0xffff), true);
  dv.setUint16(3, clampInt(r.seq, 0, 0xffff), true);
  dv.setUint32(5, clampInt(r.tSec, 0, 0xffffffff), true);
  dv.setInt32(9, hasPos ? clampInt((r.lat as number) * 1e7, -0x7fffffff, 0x7fffffff) : 0, true);
  dv.setInt32(13, hasPos ? clampInt((r.lon as number) * 1e7, -0x7fffffff, 0x7fffffff) : 0, true);
  dv.setUint8(17, clampInt(r.kind, 0, 0xff));
  dv.setUint8(18, clampInt(r.label, 0, 0xff));
  dv.setUint8(19, clampInt(r.conf, 0, 100));
  dv.setInt8(20, clampInt(r.peakDb, -128, 127));
  dv.setUint8(21, clampInt(r.shotCount, 0, 0xff));
  dv.setUint16(22, clampInt(r.rangeFt, 0, 0xffff), true);
  dv.setUint16(24, clampInt(r.bearing, 0, 0xffff), true);
  return new Uint8Array(buf);
}

/**
 * Parse + VALIDATE a frame. Returns null on anything malformed -- this is a
 * network boundary, so bad input is noise, never a throw. A wrong-version frame
 * is rejected so a peer can't corrupt state with a shape we don't understand.
 */
export function unpackReport(bytes: Uint8Array): CompactReport | null {
  if (bytes.length < FRAME_BYTES) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = dv.getUint8(0);
  if (((flags >> 4) & 0x0f) !== MESH_PROTO_VERSION) return null;
  const hasPos = (flags & 1) === 1;
  return {
    nodeId: dv.getUint16(1, true),
    seq: dv.getUint16(3, true),
    tSec: dv.getUint32(5, true),
    lat: hasPos ? dv.getInt32(9, true) / 1e7 : null,
    lon: hasPos ? dv.getInt32(13, true) / 1e7 : null,
    kind: dv.getUint8(17),
    label: dv.getUint8(18),
    conf: dv.getUint8(19),
    peakDb: dv.getInt8(20),
    shotCount: dv.getUint8(21),
    rangeFt: dv.getUint16(22, true),
    bearing: dv.getUint16(24, true),
  };
}
