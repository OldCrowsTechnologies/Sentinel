/**
 * rf_bench.mjs -- real-hardware bench for the RF control-link detector.
 *
 * Runs the ACTUAL app code paths (lib/rtlTcp.ts + lib/loraDetect.ts) against a
 * live rtl_tcp server serving the RTL-SDR plugged into this PC, so we can watch
 * the dechirp detector on real IQ and tune it before it ships to the phone.
 *
 * Prereq: WinUSB driver on the dongle (Zadig), then start rtl_tcp:
 *   rtl_tcp.exe -a 127.0.0.1 -p 1234
 *
 * Run (Node 22+, same flags the test suite uses):
 *   node --experimental-strip-types tools/rf_bench.mjs               # sweep 433/868/915
 *   node --experimental-strip-types tools/rf_bench.mjs 433.92        # lock to one freq (MHz)
 *   node --experimental-strip-types tools/rf_bench.mjs 127.0.0.1 868 # host + freq
 */
import net from 'node:net';
import { RtlTcpClient, RF_SCAN_BANDS } from '../lib/rtlTcp.ts';
import { detectLora } from '../lib/loraDetect.ts';

// ---- args: [host] [freqMHz]  (either, both, or neither) --------------------
const argv = process.argv.slice(2);
let HOST = '127.0.0.1';
let lockMHz = null;
for (const a of argv) {
  if (/^\d+\.?\d*$/.test(a)) lockMHz = parseFloat(a);
  else HOST = a;
}
const PORT = 1234;
const SAMPLE_RATE = 1_024_000;
const FRAME = 32768;
const THRESHOLD = 40; // loraDetect default; watch scores to calibrate

const bands = lockMHz
  ? [{ band: `${lockMHz}MHz`, centerHz: Math.round(lockMHz * 1e6) }]
  : RF_SCAN_BANDS;

const peak = new Map(bands.map((b) => [b.band, 0]));

const sock = net.connect(PORT, HOST);
const client = new RtlTcpClient({
  write: (d) => sock.write(Buffer.from(d)),
  close: () => sock.end(),
});
sock.on('data', (d) => client.receive(new Uint8Array(d.buffer, d.byteOffset, d.byteLength)));
sock.on('error', (e) => {
  console.error(`\n[socket] ${e.message} -- is rtl_tcp running on ${HOST}:${PORT}?`);
  process.exit(1);
});

sock.on('connect', async () => {
  console.log(`[bench] connected to rtl_tcp ${HOST}:${PORT}`);
  console.log(`[bench] sample rate ${SAMPLE_RATE} Hz, frame ${FRAME} samples, threshold ${THRESHOLD}`);
  console.log(`[bench] ${lockMHz ? `locked to ${lockMHz} MHz` : 'sweeping'} -- power on your target transmitter\n`);
  client.configure({ sampleRate: SAMPLE_RATE, gainTenthDb: 'auto' });
  await new Promise((r) => setTimeout(r, 300)); // let the tuner settle

  let sweep = 0;
  let lastTuned = null;
  for (;;) {
    sweep++;
    const row = [];
    for (const { band, centerHz } of bands) {
      if (centerHz !== lastTuned) {
        client.tune(centerHz);
        lastTuned = centerHz;
        await new Promise((r) => setTimeout(r, 60)); // retune settle (only on change)
      }
      let det;
      try {
        const { i, q } = await client.capture(FRAME, 2500);
        det = detectLora(i, q, SAMPLE_RATE, undefined, THRESHOLD);
      } catch (e) {
        row.push(`${band}: <timeout>`);
        continue;
      }
      if (det.score > peak.get(band)) peak.set(band, det.score);
      const hit = det.present ? ' *** DETECTED ***' : '';
      const slopeK = det.slopeHzPerS ? `${(det.slopeHzPerS / 1e3).toFixed(0)}kHz/s` : '-';
      row.push(
        `${band}  rssi ${det.rssiDb.toFixed(1)}dB  score ${det.score.toFixed(1)} (max ${peak.get(band).toFixed(0)})  slope ${slopeK}${hit}`
      );
    }
    console.log(`#${String(sweep).padStart(4)}  ` + row.join('   |   '));
  }
});
