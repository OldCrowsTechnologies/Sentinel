/**
 * rfSensorService.ts -- Tier-3 external RF sensor (SDR) scaffold for LoRa /
 * ExpressLRS and other control-link detection.
 *
 * SLAVED OFF until the Corvus RF module exists. The phone's own radios cannot
 * tune sub-GHz LoRa or decode proprietary control links (see docs/PHASE2-RF.md),
 * so this requires an external SDR (RTL-SDR / HackRF) or LoRa transceiver over
 * USB-OTG. This module is the integration seam: today it reports "no module"
 * and the feature is disabled in Settings. When hardware arrives, implement
 * `connectModule` (USB enumeration) and `startLinkScan` (chirp/RSSI detection)
 * here -- the rest of the app already routes through this interface.
 *
 * Nothing here transmits or activates an antenna; it is inert by design.
 *
 * The SIGNAL PROCESSING is already built and unit-tested (loraDetect.ts): given
 * IQ baseband, processIqFrame() decides whether a LoRa chirp is present. The
 * only remaining (hardware-gated) piece is the native USB driver that pulls IQ
 * off the SDR and calls processIqFrame() -- that's the seam.
 */

import { detectLora } from './loraDetect';

export type RfBand = '433MHz' | '868MHz' | '915MHz' | '2.4GHz';

export interface RfLinkDetection {
  kind: 'lora' | 'elrs' | 'ocusync' | 'unknown';
  band: RfBand;
  rssi: number; // dBm
  bearing?: number; // only with a directional antenna
  timestamp: number;
}

export interface RfModuleStatus {
  present: boolean;
  name: string | null;
  note: string;
}

// Hard gate: external RF is disabled until the module is integrated. Flip this
// (and implement the methods below) once a Corvus RF module is connected.
const RF_MODULE_AVAILABLE = false;

export function getRfModuleStatus(): RfModuleStatus {
  return {
    present: false,
    name: null,
    note: 'No Corvus RF module connected. External SDR (LoRa / control-link) is disabled.',
  };
}

/** Returns false while slaved off — the exterior antenna stays inert. */
export async function connectModule(): Promise<boolean> {
  if (!RF_MODULE_AVAILABLE) return false;
  // TODO(hardware): enumerate USB-OTG SDR, init driver, tune to the AO bands.
  return false;
}

let onDetect: ((d: RfLinkDetection) => void) | null = null;

/**
 * Begin scanning for control links (LoRa/ELRS chirp + RSSI). Registers the
 * detection sink; returns false while slaved off (no module feeds IQ yet), but
 * the processing pipeline below is live and ready.
 */
export async function startLinkScan(
  cb: (d: RfLinkDetection) => void
): Promise<boolean> {
  onDetect = cb;
  if (!RF_MODULE_AVAILABLE) return false;
  // TODO(hardware): open the USB SDR, tune to `band`, and stream IQ frames into
  // processIqFrame() below. The detection math is already done.
  return false;
}

export function stopLinkScan(): void {
  onDetect = null;
}

/**
 * Process one IQ baseband frame from the SDR and emit a detection if a LoRa
 * chirp is present. THIS is where the native USB driver will push samples; it
 * is fully implemented + unit-tested and works the moment real IQ arrives.
 *
 * @param iqI/iqQ complex baseband samples
 * @param sampleRate SDR sample rate (Hz)
 * @param band the band the SDR is currently tuned to
 */
export function processIqFrame(
  iqI: ArrayLike<number>,
  iqQ: ArrayLike<number>,
  sampleRate: number,
  band: RfBand
): RfLinkDetection | null {
  const d = detectLora(iqI, iqQ, sampleRate);
  if (!d.present) return null;
  const det: RfLinkDetection = {
    kind: 'lora',
    band,
    rssi: Math.round(d.rssiDb),
    timestamp: Date.now(),
  };
  onDetect?.(det);
  return det;
}
