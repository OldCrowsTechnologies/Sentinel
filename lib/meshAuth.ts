/**
 * meshAuth.ts -- authenticated membership for the mesh (the #1 pre-field
 * requirement, per SENTINEL-SHOTS-FIRED-ARCH.md §7).
 *
 * A mesh that any $20 LoRa radio can join is a spoofing / replay vector straight
 * into a dispatch system -- someone injecting "SHOTS FIRED" or replaying an old
 * beacon. So every frame is signed with a per-agency shared key: a foreign radio
 * can neither forge a detection nor replay one the gateway already accepted.
 *
 * MAC = HMAC-SHA256(key, frame), truncated to 8 bytes to stay within the LoRa
 * budget (26-byte beacon + 8-byte tag = 34 bytes, still under ~40). 8 bytes = 64
 * bits of forgery resistance, ample for a symmetric MAC on a low-rate link.
 *
 * NODE-SIDE ONLY: uses node:crypto (the sensor node + gateway are Node on a Pi).
 * Do NOT import this into the React Native app -- it would pull in a Node core
 * module. Replay defense (seq/time window) is enforced by the gateway
 * (shotFusion / seen-set), not here; this module only proves authenticity.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const TAG_BYTES = 8;

/** HMAC-SHA256(key, frame), truncated to TAG_BYTES. */
export function computeTag(frame: Uint8Array, key: Uint8Array | Buffer): Buffer {
  return createHmac('sha256', key).update(frame).digest().subarray(0, TAG_BYTES);
}

/** Append the MAC: returns frame || tag. This is what goes on the air. */
export function signFrame(frame: Uint8Array, key: Uint8Array | Buffer): Uint8Array {
  const tag = computeTag(frame, key);
  const out = new Uint8Array(frame.length + TAG_BYTES);
  out.set(frame, 0);
  out.set(tag, frame.length);
  return out;
}

/**
 * Verify a signed frame. Returns the inner frame if the MAC checks out, else
 * null. Constant-time compare so a foreign radio can't time its way to a forgery.
 * Reject anything too short to hold a tag -- a network boundary treats bad input
 * as noise, never a throw.
 */
export function verifyFrame(signed: Uint8Array, key: Uint8Array | Buffer): Uint8Array | null {
  if (signed.length <= TAG_BYTES) return null;
  const cut = signed.length - TAG_BYTES;
  const frame = signed.subarray(0, cut);
  const got = Buffer.from(signed.subarray(cut));
  const want = computeTag(frame, key);
  if (got.length !== want.length) return null;
  if (!timingSafeEqual(got, want)) return null;
  return new Uint8Array(frame); // copy out, detached from the tag
}
