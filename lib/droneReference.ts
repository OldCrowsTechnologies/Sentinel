/**
 * droneReference.ts -- reference cards for the Contact Detail view.
 *
 * For KNOWN library models we show public specs + (when available) a
 * license-clean reference photo so the operator knows what to look for. Photos
 * are intentionally drop-in: set `image` to require('../assets/reference/<x>.png')
 * once a clearly-licensed image (e.g. Wikimedia CC, or a press kit with
 * permission) is placed there. Until then the UI shows a silhouette placeholder.
 *
 * For UNKNOWN / possible-homemade contacts there is no library photo by
 * definition; we instead present a "possible spec" estimated from the acoustic
 * signature (clearly labeled as estimates).
 */

import type { OpenSetVerdict } from './mlClassifier';

export interface DroneReference {
  label: string;
  displayName: string;
  type: string;
  rotors: number;
  size: string;
  weight: string;
  role: string;
  image: number | null; // require(...) when a licensed photo is added; else null
}

// Public, commonly-cited specs (approximate). Keep coarse; this is a reference
// aid, not a datasheet. Photos are null until a license-clean image is dropped
// into assets/reference/.
const REFERENCES: Record<string, DroneReference> = {
  'Skydio X2': {
    label: 'Skydio X2',
    displayName: 'Skydio X2',
    type: 'Autonomous recon quadcopter',
    rotors: 4,
    size: '≈ folding, ~26 cm folded',
    weight: '≈ 1.3 kg',
    role: 'Enterprise / military ISR; autonomous obstacle avoidance',
    image: null,
  },
  'DJI Phantom': {
    label: 'DJI Phantom',
    displayName: 'DJI Phantom (4-class)',
    type: 'Prosumer camera quadcopter',
    rotors: 4,
    size: '≈ 35 cm diagonal',
    weight: '≈ 1.4 kg',
    role: 'Consumer/prosumer aerial photography',
    image: null,
  },
  'Parrot Anafi': {
    label: 'Parrot Anafi',
    displayName: 'Parrot ANAFI',
    type: 'Lightweight folding camera drone',
    rotors: 4,
    size: '≈ 24 cm folded',
    weight: '≈ 320 g',
    role: 'Compact consumer/prosumer; also fielded variants',
    image: null,
  },
};

export function getReference(label: string): DroneReference | null {
  return REFERENCES[label] ?? null;
}

/**
 * Build the "possible spec" lines for an unknown/homemade contact from the
 * acoustic verdict. Every line is an ESTIMATE -- we never claim a known model.
 */
export function possibleSpec(v: OpenSetVerdict): string[] {
  const lines: string[] = [];
  lines.push('Category: electric multi-rotor (est.)');
  lines.push('Rotor count: not acoustically determinable');
  if (v.estFundamentalHz) lines.push(`Rotor fundamental: ~${v.estFundamentalHz} Hz (est.)`);
  if (v.sizeClass) lines.push(`Size class: ${v.sizeClass} (est. from rotor freq)`);
  lines.push(`Novelty score: ${v.oodScore.toFixed(2)} (higher = less like known library)`);
  lines.push('Profile not in library — possible custom / homemade build.');
  return lines;
}
