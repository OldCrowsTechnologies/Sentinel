/**
 * trainingStore.ts -- on-device library of LABELED training clips.
 *
 * Saves each capture as a real .wav (filename carries the class keyword so it
 * auto-labels in train_corvus.py) plus a metadata index. Export shares a clip
 * off the device (Drive / email / USB) so it can be dropped into
 * data/recordings/<class>/ for retraining.
 */

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { encodeWavBase64 } from './wavEncoder';

const DIR = FileSystem.documentDirectory + 'training/';
const INDEX = DIR + 'index.json';

// Maps a UI label to a filename keyword the trainer auto-labels on.
const LABEL_KEYWORD: Record<string, string> = {
  None: 'none',
  'Skydio X2': 'skydio',
  'DJI Phantom': 'dji-phantom',
  'Parrot Anafi': 'parrot-anafi',
  Unknown: 'unknown',
};

export interface TrainingClipMeta {
  id: string;
  label: string;
  keyword: string;
  timestamp: number;
  durationSec: number;
  file: string; // absolute uri
}

function slug(label: string): string {
  return (LABEL_KEYWORD[label] || label.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/(^-|-$)/g, '');
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

async function readIndex(): Promise<TrainingClipMeta[]> {
  try {
    const info = await FileSystem.getInfoAsync(INDEX);
    if (!info.exists) return [];
    return JSON.parse(await FileSystem.readAsStringAsync(INDEX));
  } catch {
    return [];
  }
}

async function writeIndex(list: TrainingClipMeta[]): Promise<void> {
  await FileSystem.writeAsStringAsync(INDEX, JSON.stringify(list));
}

/** Save a labeled clip as a .wav. Returns its metadata. */
export async function saveClip(
  label: string,
  samples: Float32Array,
  sampleRate: number
): Promise<TrainingClipMeta> {
  await ensureDir();
  const ts = Date.now();
  const keyword = slug(label);
  // Filename leads with the class keyword so the trainer auto-labels it.
  const file = `${DIR}${keyword}_${ts}.wav`;
  await FileSystem.writeAsStringAsync(file, encodeWavBase64(samples, sampleRate), {
    encoding: FileSystem.EncodingType.Base64,
  });
  const meta: TrainingClipMeta = {
    id: `clip_${ts}`,
    label,
    keyword,
    timestamp: ts,
    durationSec: samples.length / sampleRate,
    file,
  };
  const index = await readIndex();
  index.unshift(meta);
  await writeIndex(index);
  return meta;
}

export async function listClips(): Promise<TrainingClipMeta[]> {
  return readIndex();
}

export async function clipCount(): Promise<number> {
  return (await readIndex()).length;
}

export async function deleteClip(id: string): Promise<void> {
  const index = await readIndex();
  const m = index.find((x) => x.id === id);
  if (m) {
    try {
      await FileSystem.deleteAsync(m.file, { idempotent: true });
    } catch {
      /* ignore */
    }
  }
  await writeIndex(index.filter((x) => x.id !== id));
}

/** Share a single clip off the device. */
export async function exportClip(id: string): Promise<boolean> {
  const m = (await readIndex()).find((x) => x.id === id);
  if (!m) return false;
  if (!(await Sharing.isAvailableAsync())) return false;
  try {
    await Sharing.shareAsync(m.file, { mimeType: 'audio/wav', dialogTitle: `Corvus training clip (${m.label})` });
    return true;
  } catch {
    return false;
  }
}
