/**
 * rtlTcp.test.mjs -- RTL-SDR rtl_tcp client: 5-byte command encoding, u8 IQ
 * decode, and the client's header-strip + frame-assembly receive path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rtlCommand,
  RTL_CMD,
  decodeIqU8,
  isRtlHeader,
  RtlTcpClient,
  RF_SCAN_BANDS,
} from '../lib/rtlTcp.ts';

test('rtlCommand encodes cmd + big-endian u32', () => {
  const b = rtlCommand(RTL_CMD.SET_FREQ, 433_920_000);
  assert.equal(b.length, 5);
  assert.equal(b[0], RTL_CMD.SET_FREQ);
  const param = (b[1] << 24) | (b[2] << 16) | (b[3] << 8) | b[4];
  assert.equal(param >>> 0, 433_920_000);
});

test('decodeIqU8 maps unsigned bytes to ~[-1,1) and drops odd tail', () => {
  const { i, q } = decodeIqU8(Uint8Array.of(0, 255, 128, 64, 200)); // 5 bytes -> 2 pairs
  assert.equal(i.length, 2);
  assert.equal(q.length, 2);
  assert.ok(Math.abs(i[0] - (0 - 127.5) / 127.5) < 1e-12);
  assert.ok(Math.abs(q[0] - (255 - 127.5) / 127.5) < 1e-12);
  assert.ok(i[0] < 0 && q[0] > 0);
});

test('isRtlHeader detects the RTL0 magic', () => {
  assert.ok(isRtlHeader(Uint8Array.of(0x52, 0x54, 0x4c, 0x30, 1, 2)));
  assert.ok(!isRtlHeader(Uint8Array.of(0, 1, 2, 3)));
});

test('RtlTcpClient strips the dongle header and assembles a capture', async () => {
  const written = [];
  const client = new RtlTcpClient({ write: (d) => written.push(d), close: () => {} });
  client.configure({ sampleRate: 1_024_000, gainTenthDb: 'auto' });
  assert.ok(written.length >= 1); // at least the sample-rate command went out

  const cap = client.capture(2); // wants 2 IQ samples = 4 bytes
  const header = Uint8Array.of(0x52, 0x54, 0x4c, 0x30, 0, 0, 0, 5, 0, 0, 0, 0); // 12-byte header
  // header + 4 IQ bytes in one chunk; header must be stripped
  client.receive(new Uint8Array([...header, 10, 250, 127, 128]));
  const { i, q } = await cap;
  assert.equal(i.length, 2);
  assert.ok(Math.abs(i[0] - (10 - 127.5) / 127.5) < 1e-12);
  assert.ok(Math.abs(q[0] - (250 - 127.5) / 127.5) < 1e-12);
});

test('RF_SCAN_BANDS are sub-GHz and in RTL-SDR range', () => {
  assert.equal(RF_SCAN_BANDS.length, 3);
  for (const b of RF_SCAN_BANDS) {
    assert.ok(b.centerHz > 24e6 && b.centerHz < 1_700e6, `${b.band} in range`);
  }
});
