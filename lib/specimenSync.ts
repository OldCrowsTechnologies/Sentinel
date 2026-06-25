/**
 * specimenSync.ts -- auto-upload captured specimens to the shared library when
 * a network is available. Offline-first: captures queue locally and flush on
 * the next connectivity. The library endpoint is configured via
 * EXPO_PUBLIC_CORVUS_LIBRARY_URL; until that backend exists, specimens simply
 * accumulate on-device (nothing is lost).
 */

import * as Network from 'expo-network';
import { listSpecimens, getSpecimen, markUploaded } from './specimenStore';

const LIBRARY_URL = process.env.EXPO_PUBLIC_CORVUS_LIBRARY_URL || '';

export function libraryConfigured(): boolean {
  return LIBRARY_URL.length > 0;
}

export async function isOnline(): Promise<boolean> {
  try {
    const s = await Network.getNetworkStateAsync();
    return !!s.isConnected && s.isInternetReachable !== false;
  } catch {
    return false;
  }
}

/** Flush un-uploaded specimens to the library. Best-effort; safe to call often. */
export async function syncPending(): Promise<{ uploaded: number; remaining: number }> {
  const pending = (await listSpecimens()).filter((m) => !m.uploaded);
  if (pending.length === 0) return { uploaded: 0, remaining: 0 };
  if (!libraryConfigured() || !(await isOnline())) {
    return { uploaded: 0, remaining: pending.length };
  }
  let uploaded = 0;
  for (const m of pending) {
    const full = await getSpecimen(m.id);
    if (!full) continue;
    try {
      const res = await fetch(LIBRARY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(full),
      });
      if (res.ok) {
        await markUploaded(m.id);
        uploaded++;
      }
    } catch {
      break; // network dropped — leave the rest queued for next time
    }
  }
  return { uploaded, remaining: pending.length - uploaded };
}
