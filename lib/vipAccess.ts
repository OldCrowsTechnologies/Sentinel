/**
 * vipAccess.ts -- hard-wired VIP access gate, shared across the OCWS app family
 * (Sentinel / Rookery / Vantage). This module is intentionally self-contained
 * (only depends on expo-file-system) so it can be copied verbatim into the other
 * apps and behave identically.
 *
 * Flow:
 *   1. Operator enters the VIP access code (VIP_CODE). First accepted use flips
 *      `codeAccepted` and moves them to password creation.
 *   2. On that first use they SET a password (create + confirm). It is stored
 *      salted + SHA-256 hashed -- never in plaintext.
 *   3. On the first successful login Corvus delivers WHITE_RABBIT_MESSAGE, then
 *      `welcomeShown` latches so it is a one-time greeting.
 *   4. Thereafter the code is not required again -- returning operators unlock
 *      with their password only.
 *
 * SECURITY NOTE: the access code is a client-side invite/unlock token, not a
 * secret -- anything shipped in the bundle is extractable (see the ElevenLabs
 * note in corvusVoice.ts). The code gates convenience/branding, not server data.
 * The password is hashed on-device; the salt only needs to be unique per install
 * (local-only threat model), so it is derived from time + Math.random().
 */

import * as FileSystem from 'expo-file-system';

// ---- hard-wired constants (shared across all OCWS apps) --------------------

export const VIP_CODE = 'Corvus-Houston';
export const WHITE_RABBIT_MESSAGE =
  'Here is the white rabbit, now its off too wonderland';

// ---- persisted state -------------------------------------------------------

export interface VipState {
  codeAccepted: boolean; // VIP_CODE has been validated at least once
  salt: string | null;
  passwordHash: string | null; // sha256(salt + password)
  welcomeShown: boolean; // white-rabbit greeting has been delivered once
}

const DIR = FileSystem.documentDirectory + 'vip/';
const STATE_FILE = DIR + 'state.json';

const EMPTY: VipState = {
  codeAccepted: false,
  salt: null,
  passwordHash: null,
  welcomeShown: false,
};

let cache: VipState | null = null;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

export async function getVipState(): Promise<VipState> {
  if (cache) return cache;
  try {
    const info = await FileSystem.getInfoAsync(STATE_FILE);
    if (!info.exists) {
      cache = { ...EMPTY };
      return cache;
    }
    const raw = await FileSystem.readAsStringAsync(STATE_FILE);
    cache = { ...EMPTY, ...JSON.parse(raw) } as VipState;
  } catch {
    cache = { ...EMPTY };
  }
  return cache;
}

async function writeState(next: VipState): Promise<void> {
  cache = next;
  await ensureDir();
  await FileSystem.writeAsStringAsync(STATE_FILE, JSON.stringify(next));
}

// ---- public API ------------------------------------------------------------

/** Whether a password has already been created (i.e. this is a returning user). */
export async function hasPassword(): Promise<boolean> {
  const s = await getVipState();
  return !!s.passwordHash;
}

/** True if the supplied code matches the hard-wired VIP code (trim + case-insensitive). */
export function isValidCode(input: string): boolean {
  return normalize(input) === normalize(VIP_CODE);
}

/**
 * Validate + accept the VIP code. Returns true on match and latches
 * `codeAccepted`. Does NOT set a password -- the caller then collects one.
 */
export async function acceptCode(input: string): Promise<boolean> {
  if (!isValidCode(input)) return false;
  const s = await getVipState();
  if (!s.codeAccepted) await writeState({ ...s, codeAccepted: true });
  return true;
}

/** Create the operator's password (first use). Salts + hashes, never plaintext. */
export async function setPassword(password: string): Promise<void> {
  const s = await getVipState();
  const salt = makeSalt();
  const passwordHash = await sha256Hex(salt + password);
  await writeState({ ...s, codeAccepted: true, salt, passwordHash });
}

/** Verify a returning operator's password against the stored salted hash. */
export async function verifyPassword(password: string): Promise<boolean> {
  const s = await getVipState();
  if (!s.salt || !s.passwordHash) return false;
  const h = await sha256Hex(s.salt + password);
  return timingSafeEqual(h, s.passwordHash);
}

/** Whether the one-time white-rabbit greeting still needs to be shown. */
export async function shouldShowWelcome(): Promise<boolean> {
  const s = await getVipState();
  return !s.welcomeShown;
}

/** Latch the white-rabbit greeting so it is only ever delivered once. */
export async function markWelcomeShown(): Promise<void> {
  const s = await getVipState();
  if (!s.welcomeShown) await writeState({ ...s, welcomeShown: true });
}

/** Wipe all VIP state (support/testing). Forces the full first-run flow again. */
export async function resetVip(): Promise<void> {
  cache = { ...EMPTY };
  try {
    const info = await FileSystem.getInfoAsync(STATE_FILE);
    if (info.exists) await FileSystem.deleteAsync(STATE_FILE, { idempotent: true });
  } catch {
    /* nothing to delete */
  }
}

// ---- helpers ---------------------------------------------------------------

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function makeSalt(): string {
  // Local-only salt: uniqueness per install is sufficient (see module header).
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

// Constant-time-ish compare over equal-length hex strings to avoid leaking via
// early exit. Both inputs are fixed 64-char SHA-256 hex digests.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- pure-JS SHA-256 (no native crypto dependency) -------------------------
// Compact, dependency-free digest of a UTF-8 string -> lowercase hex.

async function sha256Hex(message: string): Promise<string> {
  const bytes = utf8Bytes(message);
  return sha256Bytes(bytes);
}

function utf8Bytes(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f)
      );
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

function sha256Bytes(data: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLen = data.length * 8;
  const withOne = data.length + 1;
  const total = withOne + ((56 - (withOne % 64) + 64) % 64) + 8;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[data.length] = 0x80;
  // 64-bit big-endian length (high 32 bits are 0 for our message sizes).
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 4, bitLen >>> 0);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000));

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i++) hex += (H[i] >>> 0).toString(16).padStart(8, '0');
  return hex;
}
