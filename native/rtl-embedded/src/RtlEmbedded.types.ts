/**
 * RtlEmbedded.types.ts -- shared TS types for the embedded RTL-SDR native module
 * (Route C). See docs/RF-EMBEDDED-DRIVER-PLAN.md.
 *
 * SKELETON: these types describe the native <-> JS contract. The native module is
 * a stub; nothing here functions until the Kotlin side (android/) is filled in and
 * the module is linked at prebuild. Kept dependency-free so it typechecks in the
 * existing project without touching package.json.
 */

/** A candidate/attached RTL2832U USB device as seen by the Android USB Host layer. */
export interface RtlUsbDeviceInfo {
  deviceName: string; // Android UsbDevice.getDeviceName() (e.g. "/dev/bus/usb/001/002")
  vendorId: number; // e.g. 0x0BDA
  productId: number; // e.g. 0x2838
  hasPermission: boolean;
  /** Tuner detected during init, once known. null before init / if unreadable. */
  tuner?: 'R820T2' | 'R860' | 'unknown' | null;
}

/** Tuner/demod configuration mirroring lib/rtlTcp.ts RtlConfig semantics. */
export interface RtlEmbeddedConfig {
  sampleRateHz: number; // RTL valid: 225001-300000 or 900001-3200000 (app uses 1_024_000)
  centerHz: number; // desired RF center frequency
  gainTenthDb?: number | 'auto'; // manual gain (0.1 dB units) or 'auto' AGC
  freqCorrectionPpm?: number;
}

/**
 * The native module surface (Expo Module). All methods are async and reject with a
 * coded error string on failure so the JS adapter can map to getRfModuleStatus().
 *
 * NOTE: this interface intentionally exposes BOTH:
 *  - high-level setters (setCenterFreq/setSampleRate/setGain) used by the Option-A
 *    RtlSocket adapter, and
 *  - a raw command sink (sendCommand) so the adapter can forward the existing
 *    5-byte rtl_tcp command frames unchanged if we prefer that path.
 * A native dev can implement whichever the adapter ends up using; the plan (Option A)
 * favors forwarding the 5-byte frames to reuse RtlTcpClient verbatim.
 */
export interface RtlEmbeddedNativeModule {
  /** List attached devices matching the known RTL2832U VID/PID table. */
  listDevices(): Promise<RtlUsbDeviceInfo[]>;

  /** Request USB permission for a device (Android runtime USB permission intent). */
  requestPermission(deviceName: string): Promise<boolean>;

  /** Claim + open the device and run the RTL2832U + tuner init sequence. */
  open(deviceName: string, config: RtlEmbeddedConfig): Promise<RtlUsbDeviceInfo>;

  /** Retune center frequency (R820T2 PLL). */
  setCenterFreq(centerHz: number): Promise<void>;

  /** Set output sample rate (RTL2832U resampler). */
  setSampleRate(sampleRateHz: number): Promise<void>;

  /** Set gain: tenths of dB, or -1 for auto/AGC. */
  setGain(gainTenthDb: number): Promise<void>;

  /**
   * Forward a raw 5-byte rtl_tcp command frame ([cmd:u8][param:u32 BE]) to native.
   * Lets the Option-A adapter reuse lib/rtlTcp.ts RTL_CMD encoding as a local RPC.
   */
  sendCommand(frame: Uint8Array): Promise<void>;

  /** Begin the USB bulk IQ streaming loop. IQ arrives via the 'onIqData' event. */
  startStream(): Promise<void>;

  /** Stop streaming (keeps the device open). */
  stopStream(): Promise<void>;

  /** Stop streaming, release interface, close device. */
  close(): Promise<void>;
}

/** Payload of the 'onIqData' event: raw interleaved u8 IQ, exactly as lib/rtlTcp.decodeIqU8 expects. */
export interface RtlIqDataEvent {
  /** Interleaved unsigned-8-bit I,Q bytes (bias 127.5). May be delivered base64 by the bridge. */
  data: Uint8Array;
}

export type RtlEmbeddedEvents = {
  onIqData: (e: RtlIqDataEvent) => void;
  onDeviceDetached: (e: { deviceName: string }) => void;
  onError: (e: { code: string; message: string }) => void;
};
