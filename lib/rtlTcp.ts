/**
 * rtlTcp.ts -- RTL-SDR client (Nooelec NESDR Nano 3, USB-C) over the rtl_tcp
 * protocol. This is the hardware-facing driver for the Tier-3 RF sensor.
 *
 * WHY rtl_tcp: on Android an app can't claim a USB SDR without native USB/libusb
 * code (and librtlsdr is GPL). The pragmatic, proven path (RF Analyzer, SDR
 * Touch) is a companion RTL2832U driver app that owns USB enumeration/permission
 * and exposes the dongle as a local rtl_tcp TCP server. We connect to it
 * (127.0.0.1:1234), configure tuner freq/rate/gain, and pull raw IQ, which we
 * hand to loraDetect via rfSensorService.processIqFrame().
 *
 * This module is TRANSPORT-AGNOSTIC and unit-testable: it takes a minimal socket
 * interface, so the wire protocol (5-byte commands, dongle header, u8 IQ decode,
 * frame assembly) is verified with a fake socket. The only native piece is the
 * actual TCP socket (react-native-tcp-socket), injected via rfSensorService.
 */

// ---- rtl_tcp command protocol --------------------------------------------
// Every command is 5 bytes: [command:u8][param:u32 big-endian].
export const RTL_CMD = {
  SET_FREQ: 0x01, // Hz
  SET_SAMPLE_RATE: 0x02, // Hz
  SET_GAIN_MODE: 0x03, // 0 = auto, 1 = manual
  SET_GAIN: 0x04, // tenths of dB
  SET_FREQ_CORRECTION: 0x05, // ppm
  SET_AGC_MODE: 0x08, // 0/1
} as const;

export function rtlCommand(cmd: number, param: number): Uint8Array {
  const b = new Uint8Array(5);
  b[0] = cmd & 0xff;
  // u32 big-endian; >>> keeps it unsigned for values up to 4.29 GHz (fits freq)
  b[1] = (param >>> 24) & 0xff;
  b[2] = (param >>> 16) & 0xff;
  b[3] = (param >>> 8) & 0xff;
  b[4] = param & 0xff;
  return b;
}

/** rtl_tcp sends a 12-byte header on connect: magic "RTL0" + tuner type + gain count. */
export const RTL_HEADER_BYTES = 12;
export function isRtlHeader(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x52 && buf[1] === 0x54 && buf[2] === 0x4c && buf[3] === 0x30; // "RTL0"
}

/**
 * Decode interleaved unsigned-8-bit I,Q (rtl_tcp's native format) to float IQ in
 * ~[-1, 1). An odd trailing byte (partial pair) is ignored.
 */
export function decodeIqU8(buf: Uint8Array): { i: Float64Array; q: Float64Array } {
  const n = buf.length >> 1;
  const i = new Float64Array(n);
  const q = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    i[k] = (buf[2 * k] - 127.5) / 127.5;
    q[k] = (buf[2 * k + 1] - 127.5) / 127.5;
  }
  return { i, q };
}

// Minimal socket the client drives. The native TCP socket adapts to this.
export interface RtlSocket {
  write(data: Uint8Array): void;
  close(): void;
}

export interface RtlConfig {
  sampleRate?: number; // Hz (RTL valid: 225001-300000 or 900001-3200000)
  gainTenthDb?: number | 'auto'; // manual gain (0.1 dB units) or 'auto' AGC
  freqCorrectionPpm?: number;
}

/**
 * Drives one rtl_tcp connection. The owner feeds bytes in via `receive()` (from
 * the socket's data callback) and awaits IQ via `capture()`.
 */
export class RtlTcpClient {
  private sock: RtlSocket;
  private headerSeen = false;
  private buf: number[] = []; // pending IQ bytes (post-header)
  private need = 0; // bytes the in-flight capture still wants
  private resolveCapture: ((b: Uint8Array) => void) | null = null;

  constructor(sock: RtlSocket) {
    this.sock = sock;
  }

  configure(cfg: RtlConfig = {}): void {
    const sr = cfg.sampleRate ?? 1_024_000;
    this.sock.write(rtlCommand(RTL_CMD.SET_SAMPLE_RATE, sr));
    if (cfg.freqCorrectionPpm != null) {
      this.sock.write(rtlCommand(RTL_CMD.SET_FREQ_CORRECTION, cfg.freqCorrectionPpm));
    }
    if (cfg.gainTenthDb === 'auto' || cfg.gainTenthDb == null) {
      this.sock.write(rtlCommand(RTL_CMD.SET_GAIN_MODE, 0)); // auto
      this.sock.write(rtlCommand(RTL_CMD.SET_AGC_MODE, 1));
    } else {
      this.sock.write(rtlCommand(RTL_CMD.SET_GAIN_MODE, 1)); // manual
      this.sock.write(rtlCommand(RTL_CMD.SET_GAIN, cfg.gainTenthDb));
      this.sock.write(rtlCommand(RTL_CMD.SET_AGC_MODE, 0));
    }
  }

  tune(centerHz: number): void {
    this.sock.write(rtlCommand(RTL_CMD.SET_FREQ, centerHz));
  }

  /** Feed raw bytes from the socket. Strips the dongle header once, then fills captures. */
  receive(chunk: Uint8Array): void {
    let start = 0;
    if (!this.headerSeen) {
      if (isRtlHeader(chunk)) start = RTL_HEADER_BYTES;
      this.headerSeen = true;
    }
    for (let k = start; k < chunk.length; k++) this.buf.push(chunk[k]);
    this.tryResolve();
  }

  private tryResolve(): void {
    if (this.resolveCapture && this.buf.length >= this.need) {
      const out = Uint8Array.from(this.buf.slice(0, this.need));
      this.buf = this.buf.slice(this.need);
      const done = this.resolveCapture;
      this.resolveCapture = null;
      this.need = 0;
      done(out);
    }
  }

  /**
   * Wait for `nSamples` complex IQ samples (2 bytes each). The socket is assumed
   * to be streaming; discards any stale buffered bytes so we get a fresh window.
   */
  capture(nSamples: number, timeoutMs = 2000): Promise<{ i: Float64Array; q: Float64Array }> {
    this.buf.length = 0; // fresh window
    this.need = nSamples * 2;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.resolveCapture = null;
        reject(new Error('rtl_tcp capture timeout'));
      }, timeoutMs);
      this.resolveCapture = (bytes) => {
        clearTimeout(timer);
        resolve(decodeIqU8(bytes));
      };
      this.tryResolve();
    });
  }

  close(): void {
    this.resolveCapture = null;
    this.sock.close();
  }
}

// Sub-GHz control-link bands the NESDR Nano 3 can reach (24 MHz-1.7 GHz).
// 2.4 GHz (ELRS 2.4 / DJI OcuSync) is out of range -> needs a HackRF/Airspy.
export const RF_SCAN_BANDS: { band: '433MHz' | '868MHz' | '915MHz'; centerHz: number }[] = [
  { band: '433MHz', centerHz: 433_920_000 },
  { band: '868MHz', centerHz: 868_000_000 },
  { band: '915MHz', centerHz: 915_000_000 },
];
