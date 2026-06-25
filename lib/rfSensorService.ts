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
 */

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

/**
 * Begin scanning for control links (LoRa/ELRS chirp + RSSI). No-op until the
 * module exists; callback is never invoked while slaved off.
 */
export async function startLinkScan(
  _onDetect: (d: RfLinkDetection) => void
): Promise<boolean> {
  if (!RF_MODULE_AVAILABLE) return false;
  // TODO(hardware): start IQ capture, run chirp/energy detection, emit detections.
  return false;
}

export function stopLinkScan(): void {
  /* no-op until module present */
}
