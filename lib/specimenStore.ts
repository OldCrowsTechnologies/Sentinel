/**
 * specimenStore.ts -- on-device library of captured "unknown / homemade"
 * contacts (the learning flywheel). When the open-set layer flags a drone it
 * can't match, we save the audio window + verdict + GPS so it can later be
 * labeled and folded back into training (data/recordings) and/or uploaded to
 * the shared library. Fully offline; upload is handled by specimenSync.ts.
 *
 * Layout (FileSystem.documentDirectory):
 *   specimens/index.json   -> array of metadata (no audio), for listing/counts
 *   specimens/<id>.json    -> full record incl. base64 float32 audio
 */

import * as FileSystem from 'expo-file-system/legacy';

export interface SpecimenMeta {
  id: string;
  timestamp: number;
  label: string;
  isUnknownBuild: boolean;
  confidence: number;
  estFundamentalHz: number | null;
  sizeClass: string | null;
  oodScore: number | null;
  distance: number;
  lat: number | null;
  lon: number | null;
  uploaded: boolean;
}

export interface Specimen extends SpecimenMeta {
  sampleRate: number;
  samplesB64: string; // little-endian float32
}

const DIR = FileSystem.documentDirectory + 'specimens/';
const INDEX = DIR + 'index.json';

function bytesToBase64(bytes: Uint8Array): string {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += c[(n >> 18) & 63] + c[(n >> 12) & 63] + c[(n >> 6) & 63] + c[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += c[(n >> 18) & 63] + c[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += c[(n >> 18) & 63] + c[(n >> 12) & 63] + c[(n >> 6) & 63] + '=';
  }
  return out;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

async function readIndex(): Promise<SpecimenMeta[]> {
  try {
    const info = await FileSystem.getInfoAsync(INDEX);
    if (!info.exists) return [];
    return JSON.parse(await FileSystem.readAsStringAsync(INDEX));
  } catch {
    return [];
  }
}

async function writeIndex(list: SpecimenMeta[]): Promise<void> {
  await FileSystem.writeAsStringAsync(INDEX, JSON.stringify(list));
}

/** Capture one specimen. `samples` is the analysis window (~[-1,1]). */
export async function saveSpecimen(
  meta: Omit<SpecimenMeta, 'id' | 'uploaded'>,
  samples: Float32Array,
  sampleRate: number
): Promise<string> {
  await ensureDir();
  const id = `spec_${meta.timestamp}_${Math.round(meta.distance)}`;
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  const full: Specimen = {
    ...meta,
    id,
    uploaded: false,
    sampleRate,
    samplesB64: bytesToBase64(bytes),
  };
  await FileSystem.writeAsStringAsync(DIR + `${id}.json`, JSON.stringify(full));
  const index = await readIndex();
  const { samplesB64, sampleRate: _sr, ...metaOnly } = full;
  index.push(metaOnly);
  await writeIndex(index);
  return id;
}

export async function listSpecimens(): Promise<SpecimenMeta[]> {
  return readIndex();
}

export async function pendingCount(): Promise<number> {
  return (await readIndex()).filter((m) => !m.uploaded).length;
}

export async function getSpecimen(id: string): Promise<Specimen | null> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(DIR + `${id}.json`));
  } catch {
    return null;
  }
}

export async function markUploaded(id: string): Promise<void> {
  const index = await readIndex();
  const m = index.find((x) => x.id === id);
  if (m) m.uploaded = true;
  await writeIndex(index);
  const full = await getSpecimen(id);
  if (full) {
    full.uploaded = true;
    await FileSystem.writeAsStringAsync(DIR + `${id}.json`, JSON.stringify(full));
  }
}
