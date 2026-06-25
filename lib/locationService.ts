/**
 * locationService.ts -- device GPS for intercept stamping (and future
 * multi-sensor triangulation).
 *
 * Captures a fix when monitoring starts and watches for updates while the app
 * is foregrounded, exposing the most recent fix so each new contact can be
 * stamped with the operator's position + a timestamp for the After-Action
 * Report. NOTE: continuous updates while the app is minimized require a
 * location-typed foreground service (the current FGS is microphone-only), so
 * backgrounded intercepts are stamped with the last known fix.
 */

import * as Location from 'expo-location';

export interface GeoFix {
  lat: number;
  lon: number;
  accuracy: number | null; // meters
  timestamp: number;
}

let sub: Location.LocationSubscription | null = null;
let last: GeoFix | null = null;
let enabled = false;

function toFix(p: Location.LocationObject): GeoFix {
  return {
    lat: p.coords.latitude,
    lon: p.coords.longitude,
    accuracy: p.coords.accuracy ?? null,
    timestamp: p.timestamp,
  };
}

/** Request foreground location permission. Returns true if granted. */
export async function initLocation(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    enabled = status === 'granted';
    return enabled;
  } catch {
    enabled = false;
    return false;
  }
}

/** Grab an immediate fix and start watching. Safe to call when disabled. */
export async function startLocation(): Promise<void> {
  if (!enabled || sub) return;
  try {
    const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    last = toFix(cur);
  } catch {
    /* no immediate fix yet */
  }
  try {
    sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 5 },
      (pos) => {
        last = toFix(pos);
      }
    );
  } catch {
    /* watch unavailable */
  }
}

export function stopLocation(): void {
  sub?.remove();
  sub = null;
}

/** Most recent known fix, or null if none / permission denied. */
export function getLastFix(): GeoFix | null {
  return last;
}
