/**
 * missionLog.ts -- local SQLite log of detections for post-mission analysis.
 *
 * Records every window where a drone is detected OR voice is present (per the
 * noise-rejection spec), so the high-pass / VAD thresholds can be tuned against
 * real data afterward. On-device, offline; query with getRecentDetections().
 */

import * as SQLite from 'expo-sqlite';

export interface MissionLogRow {
  ts: number;
  droneDetected: boolean;
  label: string;
  confidence: number;
  voicePresent: boolean;
  filteredAudioPeak: number;
  lat: number | null;
  lon: number | null;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('corvus-mission.db').then(async (d) => {
      await d.execAsync(
        `CREATE TABLE IF NOT EXISTS detections (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           ts INTEGER NOT NULL,
           drone_detected INTEGER NOT NULL,
           label TEXT,
           confidence REAL,
           voice_present INTEGER NOT NULL,
           filtered_audio_peak REAL,
           lat REAL,
           lon REAL
         );`
      );
      return d;
    });
  }
  return dbPromise;
}

export async function logDetection(r: MissionLogRow): Promise<void> {
  try {
    const d = await db();
    await d.runAsync(
      'INSERT INTO detections (ts,drone_detected,label,confidence,voice_present,filtered_audio_peak,lat,lon) VALUES (?,?,?,?,?,?,?,?)',
      [
        r.ts,
        r.droneDetected ? 1 : 0,
        r.label,
        r.confidence,
        r.voicePresent ? 1 : 0,
        r.filteredAudioPeak,
        r.lat,
        r.lon,
      ]
    );
  } catch {
    /* logging is non-fatal */
  }
}

export async function getRecentDetections(limit = 200): Promise<MissionLogRow[]> {
  try {
    const d = await db();
    return (await d.getAllAsync(
      'SELECT * FROM detections ORDER BY ts DESC LIMIT ?',
      [limit]
    )) as unknown as MissionLogRow[];
  } catch {
    return [];
  }
}
