/**
 * rf_capture.mjs -- grab raw u8 IQ from rtl_tcp to a file, for offline detector
 * tuning against a REAL signal. Usage:
 *   node --experimental-strip-types tools/rf_capture.mjs <freqMHz> <seconds> <outfile>
 */
import net from 'node:net';
import fs from 'node:fs';
import { rtlCommand, RTL_CMD, RTL_HEADER_BYTES, isRtlHeader } from '../lib/rtlTcp.ts';

const HOST = '127.0.0.1';
const PORT = 1234;
const freqMHz = parseFloat(process.argv[2] || '915');
const seconds = parseFloat(process.argv[3] || '3');
const outfile = process.argv[4] || `capture_${freqMHz}MHz.iq8`;
const SR = Math.round(parseFloat(process.argv[5] || '1024000')); // sample rate override

const discardBytes = Math.round(SR * 2 * 0.3); // drop tuner-settling transient
const wantBytes = Math.round(SR * 2 * seconds);
let headerSeen = false;
let seen = 0;
const chunks = [];

const sock = net.connect(PORT, HOST, () => {
  sock.write(rtlCommand(RTL_CMD.SET_SAMPLE_RATE, SR));
  sock.write(rtlCommand(RTL_CMD.SET_GAIN_MODE, 0));
  sock.write(rtlCommand(RTL_CMD.SET_AGC_MODE, 1));
  sock.write(rtlCommand(RTL_CMD.SET_FREQ, Math.round(freqMHz * 1e6)));
  console.log(`capturing ${seconds}s @ ${freqMHz} MHz -> ${outfile}`);
});
sock.on('data', (d) => {
  let buf = d;
  if (!headerSeen) {
    if (isRtlHeader(new Uint8Array(d.buffer, d.byteOffset, d.byteLength))) buf = d.subarray(RTL_HEADER_BYTES);
    headerSeen = true;
  }
  seen += buf.length;
  if (seen <= discardBytes) return; // still settling
  chunks.push(Buffer.from(buf));
  const have = chunks.reduce((a, b) => a + b.length, 0);
  if (have >= wantBytes) {
    const out = Buffer.concat(chunks).subarray(0, wantBytes);
    fs.writeFileSync(outfile, out);
    console.log(`wrote ${out.length} bytes (${(out.length / 2 / SR).toFixed(2)}s of IQ)`);
    sock.destroy();
    process.exit(0);
  }
});
sock.on('error', (e) => {
  console.error('capture error:', e.message);
  process.exit(1);
});
setTimeout(() => {
  console.error('capture timed out — is rtl_tcp running and streaming?');
  process.exit(1);
}, (seconds + 5) * 1000);
