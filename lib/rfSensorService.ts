/**
 * rfSensorService.ts -- Tier-3 external RF sensor for LoRa / ExpressLRS and other
 * sub-GHz control-link detection, via a Nooelec NESDR Nano 3 (RTL-SDR) on USB-C.
 *
 * The signal processing is done + unit-tested (loraDetect.ts). The SDR is driven
 * over the rtl_tcp protocol (rtlTcp.ts) so the only native dependency is a TCP
 * socket + a companion RTL2832U USB driver app that exposes the dongle as a local
 * rtl_tcp server. That native socket is injected here via `registerRtlTransport`;
 * until a transport is registered the feature reports "no module" and stays inert
 * (nothing transmits -- receive only).
 *
 * Flow: connectModule() opens rtl_tcp -> startLinkScan() duty-cycles the sub-GHz
 * bands, capturing IQ snapshots and running processIqFrame() -> detections emit
 * to the registered sink. 2.4 GHz (ELRS 2.4 / DJI OcuSync) is OUT of RTL-SDR
 * range and is intentionally not scanned.
 */

import { detectLora } from './loraDetect';
import { detectEnergy } from './rfEnergyDetect';
import { RtlTcpClient, RF_SCAN_BANDS, type RtlSocket } from './rtlTcp';

export type RfBand = '433MHz' | '868MHz' | '915MHz' | '2.4GHz';

export interface RfLinkDetection {
  kind: 'lora' | 'elrs' | 'ocusync' | 'control-link' | 'unknown';
  band: RfBand;
  rssi: number; // dBm (uncalibrated)
  score: number; // detection strength = spectral peak over noise floor (dB)
  peakDb: number; // narrowband peak excess over floor (dB)
  offsetHz: number; // frequency offset of the peak from the band center
  bearing?: number; // only with a directional antenna
  timestamp: number;
}

export interface RfModuleStatus {
  present: boolean;
  name: string | null;
  note: string;
}

// ---- native transport injection ------------------------------------------
// The native side (react-native-tcp-socket, after prebuild) registers this. It
// connects to the local rtl_tcp server and pumps received bytes into `onData`.
export interface RtlTransport {
  connect(host: string, port: number, onData: (chunk: Uint8Array) => void): Promise<RtlSocket>;
}

let transport: RtlTransport | null = null;
export function registerRtlTransport(t: RtlTransport | null): void {
  transport = t;
}

// rtl_tcp endpoint. Defaults to the on-device companion driver app; overridable
// so a dev build can point at a networked rtl_tcp (e.g. `rtl_tcp -a <PC-IP>` on
// the bench) to validate the pipeline against real hardware before it's on-phone.
let RTL_HOST = '127.0.0.1';
let RTL_PORT = 1234;
export function setRtlEndpoint(host: string, port = 1234): void {
  RTL_HOST = host;
  RTL_PORT = port;
}
export function getRtlEndpoint(): { host: string; port: number } {
  return { host: RTL_HOST, port: RTL_PORT };
}

const SAMPLE_RATE = 1_024_000; // Hz -- covers up to 500 kHz LoRa BW
const FRAME_SAMPLES = 32768; // ~32 ms snapshot per band

let client: RtlTcpClient | null = null;
let connected = false;
let scanning = false;
let onDetect: ((d: RfLinkDetection) => void) | null = null;

// App-wide observers (e.g. the map) + a rolling recent-detections buffer, so RF
// hits surface beyond the RF tab's own scan callback.
const rfListeners = new Set<(links: RfLinkDetection[]) => void>();
let recentLinks: RfLinkDetection[] = [];
const RF_RECENT_MS = 20000;
export function subscribeRfLinks(cb: (links: RfLinkDetection[]) => void): () => void {
  rfListeners.add(cb);
  return () => {
    rfListeners.delete(cb);
  };
}
export function getRecentRfLinks(maxAgeMs = RF_RECENT_MS): RfLinkDetection[] {
  const cutoff = Date.now() - maxAgeMs;
  return recentLinks.filter((l) => l.timestamp >= cutoff);
}

let lastError: string | null = null;
export function getRfLastError(): string | null {
  return lastError;
}

export function getRfModuleStatus(): RfModuleStatus {
  if (!transport) {
    return {
      present: false,
      name: null,
      note: 'No RTL-SDR transport. This build has no native USB bridge — install a dev build to enable sub-GHz RF.',
    };
  }
  if (connected) {
    return { present: true, name: 'Nooelec NESDR Nano 3 (RTL-SDR)', note: 'RTL-SDR connected. Scanning sub-GHz control links.' };
  }
  const where = `${RTL_HOST}:${RTL_PORT}`;
  return {
    present: true,
    name: 'Nooelec NESDR Nano 3 (RTL-SDR)',
    note: lastError
      ? `Couldn't reach rtl_tcp at ${where}: ${lastError}. Start the RTL-SDR driver app (grant USB), then scan.`
      : `Ready. Plug in the dongle, start the RTL-SDR driver app (rtl_tcp on ${where}), then scan.`,
  };
}

/** Open the rtl_tcp connection and configure the tuner. */
export async function connectModule(): Promise<boolean> {
  if (!transport) return false;
  if (connected) return true;
  try {
    const sock = await transport.connect(RTL_HOST, RTL_PORT, (chunk) => client?.receive(chunk));
    client = new RtlTcpClient(sock);
    client.configure({ sampleRate: SAMPLE_RATE, gainTenthDb: 'auto' });
    connected = true;
    lastError = null;
    return true;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    client = null;
    connected = false;
    return false;
  }
}

export function disconnectModule(): void {
  scanning = false;
  client?.close();
  client = null;
  connected = false;
}

/**
 * Begin duty-cycled scanning across the sub-GHz control-link bands. Registers the
 * detection sink; returns false if no module/transport is connected.
 */
export async function startLinkScan(cb: (d: RfLinkDetection) => void): Promise<boolean> {
  onDetect = cb;
  if (!transport) return false;
  if (!connected && !(await connectModule())) return false;
  if (scanning) return true;
  scanning = true;
  void scanLoop();
  return true;
}

export function stopLinkScan(): void {
  scanning = false;
  onDetect = null;
}

async function scanLoop(): Promise<void> {
  while (scanning && client) {
    for (const { band, centerHz } of RF_SCAN_BANDS) {
      if (!scanning || !client) break;
      try {
        client.tune(centerHz);
        const { i, q } = await client.capture(FRAME_SAMPLES);
        processIqFrame(i, q, SAMPLE_RATE, band);
      } catch {
        // capture timeout / transport hiccup -- skip this band, keep scanning
      }
    }
    await new Promise((r) => setTimeout(r, 150)); // gentle duty cycle (thermal/CPU)
  }
}

/**
 * Process one IQ baseband frame and emit a detection if a control-link emission
 * is present. PRIMARY detector is energy/peak-over-floor (detectEnergy) -- it
 * catches real drone control links (FHSS ELRS/FrSky + telemetry) that a matched
 * LoRa-chirp detector misses. The chirp detector (detectLora) then runs only to
 * CLASSIFY a hit as LoRa CSS vs a generic control link. Validated on real drone,
 * LoRa32, and noise captures (tools/rf_probe, test_energy): ~9 dB threshold gives
 * 0% noise false-alarm and ~100% detection on real links. Called by scanLoop with
 * real IQ, and directly by tests.
 */
export function processIqFrame(
  iqI: ArrayLike<number>,
  iqQ: ArrayLike<number>,
  sampleRate: number,
  band: RfBand
): RfLinkDetection | null {
  const e = detectEnergy(iqI, iqQ, sampleRate);
  if (!e.present) return null;
  const chirp = detectLora(iqI, iqQ, sampleRate);
  const det: RfLinkDetection = {
    kind: chirp.present ? 'lora' : 'control-link',
    band,
    rssi: Math.round(e.floorDb + e.peakDb), // approx emission level (uncalibrated)
    score: Math.round(e.peakDb),
    peakDb: Math.round(e.peakDb * 10) / 10,
    offsetHz: Math.round(e.peakOffsetHz),
    timestamp: Date.now(),
  };
  recentLinks = [det, ...recentLinks].slice(0, 50);
  onDetect?.(det);
  const recent = getRecentRfLinks();
  for (const cb of rfListeners) cb(recent);
  return det;
}
