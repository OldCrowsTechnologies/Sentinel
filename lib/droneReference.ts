/**
 * droneReference.ts -- reference cards for the Contact Detail view.
 *
 * Classification model (per OCWS spec): the CLASS is the FAA size category
 * (driven by weight), and the DETAILS call out the specific airframe -- make,
 * model, and build type (commercial / homemade / etc.). This mirrors how the
 * FAA buckets UAS by size rather than by manufacturer.
 *
 * For KNOWN library models we show public specs + (when available) a
 * license-clean reference photo. For UNKNOWN / possible-homemade contacts there
 * is no library photo; we present a "possible spec" estimated from the acoustic
 * signature (clearly labeled as estimates), including an estimated FAA class.
 */

import type { OpenSetVerdict } from './mlClassifier';

// ---- FAA size classes (by weight) ----------------------------------------
// Thresholds: 0.55 lb (250 g) registration line; 55 lb (25 kg) sUAS ceiling.
export type FaaSizeClass = 'micro' | 'small' | 'large';

export interface FaaClassInfo {
  code: FaaSizeClass;
  label: string; // short class name
  bracket: string; // weight bracket
  note: string; // regulatory note
}

export const FAA_CLASSES: Record<FaaSizeClass, FaaClassInfo> = {
  micro: { code: 'micro', label: 'FAA Cat 1', bracket: '< 0.55 lb (250 g)', note: 'Sub-250 g micro — registration-exempt' },
  small: { code: 'small', label: 'Small UAS', bracket: '0.55–55 lb', note: 'Part 107 — registration required' },
  large: { code: 'large', label: 'Large UAS', bracket: '> 55 lb', note: 'Beyond small-UAS limits' },
};

export function faaClassInfo(c: FaaSizeClass): FaaClassInfo {
  return FAA_CLASSES[c];
}

// Estimate an FAA size class from the acoustic size estimate (unknown builds).
export function faaClassFromSizeClass(sizeClass: string | null): FaaSizeClass {
  if (!sizeClass) return 'small';
  const s = sizeClass.toLowerCase();
  if (s.includes('nano') || s.includes('micro') || s.includes('sub-250') || s.includes('tiny')) return 'micro';
  if (s.includes('large') || s.includes('heavy') || s.includes('group 3') || s.includes('group 4')) return 'large';
  return 'small';
}

export interface DroneReference {
  label: string; // classifier label / library key
  displayName: string; // make + model headline
  faaClass: FaaSizeClass; // CLASS (size category)
  make: string;
  model: string;
  build: string; // DETAILS: commercial / prosumer / homemade, etc.
  type: string; // airframe type
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
    faaClass: 'small',
    make: 'Skydio',
    model: 'X2',
    build: 'Commercial — enterprise / military ISR',
    type: 'Autonomous recon quadcopter',
    rotors: 4,
    size: '≈ folding, ~26 cm folded',
    weight: '≈ 1.3 kg (2.9 lb)',
    role: 'Enterprise / military ISR; autonomous obstacle avoidance',
    image: null,
  },
  'DJI Phantom': {
    label: 'DJI Phantom',
    displayName: 'DJI Phantom (4-series)',
    faaClass: 'small',
    make: 'DJI',
    model: 'Phantom 4-series',
    build: 'Commercial — consumer / prosumer',
    type: 'Prosumer camera quadcopter',
    rotors: 4,
    size: '≈ 35 cm diagonal',
    weight: '≈ 1.4 kg (3.0 lb)',
    role: 'Consumer/prosumer aerial photography',
    image: null,
  },
  'Parrot Anafi': {
    label: 'Parrot Anafi',
    displayName: 'Parrot ANAFI',
    faaClass: 'small',
    make: 'Parrot',
    model: 'ANAFI',
    build: 'Commercial — consumer / prosumer',
    type: 'Lightweight folding camera drone',
    rotors: 4,
    size: '≈ 24 cm folded',
    weight: '≈ 320 g (0.7 lb)',
    role: 'Compact consumer/prosumer; also fielded variants',
    image: null,
  },
  'Potensic Atom 2': {
    label: 'Potensic Atom 2',
    displayName: 'Potensic Atom 2',
    faaClass: 'micro',
    make: 'Potensic',
    model: 'Atom 2',
    build: 'Commercial — consumer (sub-250 g)',
    type: 'Folding GPS camera quadcopter',
    rotors: 4,
    size: '≈ 14.5 cm folded',
    weight: '≈ 249 g (0.55 lb)',
    role: 'Consumer photography/FPV; 249 g stays under the 250 g FAA registration line',
    image: null,
  },
};

export function getReference(label: string): DroneReference | null {
  return REFERENCES[label] ?? null;
}

/**
 * Build the "possible spec" lines for an unknown/homemade contact from the
 * acoustic verdict. Every line is an ESTIMATE -- we never claim a known model.
 * Leads with an estimated FAA size class so the operator gets a class even when
 * the make/model is unknown.
 */
export function possibleSpec(v: OpenSetVerdict): string[] {
  const faa = faaClassInfo(faaClassFromSizeClass(v.sizeClass ?? null));
  const lines: string[] = [];
  lines.push(`FAA class: ${faa.label} ${faa.bracket} (est. from acoustic size)`);
  lines.push('Details: homemade / unknown build (not in library)');
  lines.push('Airframe: electric multi-rotor (est.)');
  lines.push('Rotor count: not acoustically determinable');
  if (v.estFundamentalHz) lines.push(`Rotor fundamental: ~${v.estFundamentalHz} Hz (est.)`);
  if (v.sizeClass) lines.push(`Size class: ${v.sizeClass} (est. from rotor freq)`);
  lines.push(`Novelty score: ${v.oodScore.toFixed(2)} (higher = less like known library)`);
  return lines;
}
