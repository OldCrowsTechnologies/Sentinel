/**
 * speedGate.ts -- soft speed gate for a VEHICLE node (SENTINEL-HARDWARE-BOM.md §4).
 *
 * Scope of the vehicle node is parked + in-town, NOT highway: the wind self-noise
 * that makes at-speed detection an open problem is a speed^6 term that collapses
 * ~20-30 dB by in-town speeds. So the gate is SOFT, not a cliff:
 *   - parked/idle: full confidence (this is the validated case -- C3GD is
 *     stationary mics -> 97.8%).
 *   - in-town: modestly raise the detector threshold + de-weight confidence, so
 *     wind-driven nuisance triggers don't reach C2 while real close shots still do.
 *   - sustained highway: stand down -- we do not claim at-speed detection.
 *
 * PURE: takes GPS speed, returns how to bias the detector. The node applies
 * `thresholdAddDb` to ShotOptions.thresholdDb and scales reported confidence.
 */

export interface SpeedGateResult {
  armed: boolean; // false -> do not report (stood down)
  thresholdAddDb: number; // add to detector thresholdDb (raises the bar)
  confScale: number; // 0..1 multiplier on reported confidence
  regime: 'parked' | 'in-town' | 'highway-standdown';
}

export interface SpeedGateOptions {
  fullBelowMph?: number; // full confidence at/under this (default 5)
  standDownAboveMph?: number; // armed=false above this (default 65)
  maxThresholdAddDb?: number; // threshold bump at the stand-down edge (default 10)
  minConfScale?: number; // confidence floor just before stand-down (default 0.3)
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function speedGate(speedMph: number, opts: SpeedGateOptions = {}): SpeedGateResult {
  const full = opts.fullBelowMph ?? 5;
  const off = opts.standDownAboveMph ?? 65;
  const maxAdd = opts.maxThresholdAddDb ?? 10;
  const minScale = opts.minConfScale ?? 0.3;

  const s = Math.max(0, Number.isFinite(speedMph) ? speedMph : 0);

  if (s <= full) {
    return { armed: true, thresholdAddDb: 0, confScale: 1, regime: 'parked' };
  }
  if (s > off) {
    return { armed: false, thresholdAddDb: maxAdd, confScale: 0, regime: 'highway-standdown' };
  }
  // linear ramp between full-confidence and stand-down
  const t = (s - full) / (off - full); // 0..1
  return {
    armed: true,
    thresholdAddDb: lerp(0, maxAdd, t),
    confScale: lerp(1, minScale, t),
    regime: 'in-town',
  };
}
