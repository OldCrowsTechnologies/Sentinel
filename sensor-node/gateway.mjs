#!/usr/bin/env node
/**
 * gateway.mjs -- the mesh gateway relay (SENTINEL-SHOTS-FIRED-ARCH.md §3).
 *
 * Leaves detect + report over LoRa; the gateway is the one node with an internet
 * uplink. It: verifies each frame (rejects anything not signed by the agency key
 * -- the anti-spoof gate, §7), decodes it, FUSES reports of the same shot into one
 * located event (§4 coarse localization), dedups, and forwards ONE alert to C2.
 *
 * The LoRa radio is behind a MeshTransport interface so this logic is testable
 * with no hardware. The real SX1262 transport is a documented stub -- the one
 * piece that genuinely needs the board. Everything else runs + self-tests today:
 *
 *   node --experimental-strip-types sensor-node/gateway.mjs --selftest
 */

import { unpackReport, fromMeshSec, KIND, LABEL_NAME } from '../lib/meshLoRa.ts';
import { verifyFrame } from '../lib/meshAuth.ts';
import { fuseShots, eventSeq } from '../lib/shotFusion.ts';
import { pushDetection, loadSession } from './c2.mjs';

const log = (...m) => console.log(new Date().toISOString(), ...m);

/**
 * MeshTransport: what the gateway needs from a radio.
 *   onFrame(cb)  -- cb(bytes: Uint8Array) for each received (still-signed) frame
 *   start()/stop()
 * Implement this against an SX1262 HAT for the real thing; MockTransport below
 * satisfies it for tests + bench.
 */
export class MockTransport {
  #cb = null;
  onFrame(cb) { this.#cb = cb; }
  start() {}
  stop() {}
  /** Test/bench hook: deliver a signed frame as if it arrived over the air. */
  inject(bytes) { this.#cb?.(bytes); }
}

/** Real radio stub -- the ONE hardware-gated piece. */
export function makeSX1262Transport() {
  throw new Error(
    'SX1262 transport not implemented. Wire the SPI SX1262 driver to satisfy the ' +
    'MeshTransport contract: call the onFrame callback with each received frame ' +
    '(frame||8-byte tag), and drive start()/stop(). Everything downstream is done.'
  );
}

export class Gateway {
  #key; #transport; #windowMs; #onEvent; #forward;
  #buf = [];
  #seen = new Set();
  #rejected = 0;
  #timer = null;

  constructor({ agencyKey, transport, fusionWindowMs = 2000, onEvent = null, forwardToC2 = true }) {
    if (!agencyKey) throw new Error('gateway requires an agencyKey (the anti-spoof gate)');
    this.#key = agencyKey;
    this.#transport = transport;
    this.#windowMs = fusionWindowMs;
    this.#onEvent = onEvent;
    this.#forward = forwardToC2;
  }

  start() {
    this.#transport.onFrame((bytes) => this.#ingest(bytes));
    this.#transport.start();
    this.#timer = setInterval(() => void this.flush().catch((e) => log('flush error', e.message)), this.#windowMs);
    this.#timer.unref?.();
  }
  stop() { clearInterval(this.#timer); this.#transport.stop(); }

  /** Verify -> decode -> buffer. A frame that fails the MAC is DROPPED, counted. */
  #ingest(signed) {
    const frame = verifyFrame(signed, this.#key);
    if (!frame) { this.#rejected++; return; } // foreign / tampered / replayed radio
    const r = unpackReport(frame);
    if (!r || r.kind !== KIND.gunshot) return;
    this.#buf.push({
      nodeId: r.nodeId,
      tMs: fromMeshSec(r.tSec),
      lat: r.lat, lon: r.lon,
      conf: r.conf, peakDb: r.peakDb,
      shotCount: r.shotCount, label: r.label,
    });
  }

  /** Fuse the buffer, forward events not seen before. Returns the new events. */
  async flush() {
    if (this.#buf.length === 0) return [];
    const events = fuseShots(this.#buf, { windowMs: this.#windowMs });
    this.#buf = [];
    const fresh = [];
    for (const ev of events) {
      if (this.#seen.has(ev.eventId)) continue; // same event via another gateway
      this.#seen.add(ev.eventId);
      fresh.push(ev);
      this.#onEvent?.(ev);
      if (this.#forward) await this.#toC2(ev).catch((e) => log('C2 forward failed', e.message));
    }
    return fresh;
  }

  async #toC2(ev) {
    // ShotEvent -> detections row. node_id='event' + seq=hash(eventId) so the SAME
    // event forwarded by TWO gateways dedups to one row under unique(org,node,seq).
    // pos_acc carries the uncertainty RADIUS -> the dashboard renders a region.
    const r = {
      nodeId: 'event', seq: eventSeq(ev.eventId), t: ev.tMs,
      lat: ev.lat, lon: ev.lon, posAcc: ev.radiusM,
      type: LABEL_NAME[ev.label] ?? LABEL_NAME[0],
      conf: ev.conf, rangeFt: -1, rangeSd: null, bearing: -1,
      unknownBuild: false, kind: 'gunshot',
    };
    await pushDetection(r, { peakDb: ev.peakDb, shotCount: ev.shotCount });
  }

  get rejectedCount() { return this.#rejected; }
}

// ---- self-test (no hardware, no C2) -----------------------------------------
if (process.argv.includes('--selftest')) {
  const { packReport, toMeshSec, LABEL } = await import('../lib/meshLoRa.ts');
  const { signFrame, computeTag } = await import('../lib/meshAuth.ts');
  const key = Buffer.from('escambia-so-demo-key-0001');
  const t0 = 1_752_000_000_000; // fixed ms (Date.now avoided for determinism)

  const mk = (nodeId, lat, lon, conf, peak, tMs) =>
    signFrame(packReport({
      nodeId, seq: 1, tSec: toMeshSec(tMs), lat, lon,
      kind: KIND.gunshot, label: LABEL.unknown, conf, peakDb: peak,
      shotCount: 3, rangeFt: 0xffff, bearing: 0xffff,
    }), key);

  const events = [];
  const transport = new MockTransport();
  const gw = new Gateway({ agencyKey: key, transport, onEvent: (e) => events.push(e), forwardToC2: false });
  gw.start();

  // Event A: 3 nearby nodes hear one shot within ~0.3 s (school C-wing).
  transport.inject(mk(1, 30.4210, -87.2170, 60, 40, t0));
  transport.inject(mk(4, 30.4213, -87.2166, 72, 45, t0 + 120));
  transport.inject(mk(6, 30.4211, -87.2172, 51, 33, t0 + 260));
  // Event B: a single node, 6 s later, elsewhere.
  transport.inject(mk(9, 30.4300, -87.2000, 40, 28, t0 + 6000));
  // A hostile/foreign frame with a bad MAC -> must be rejected.
  const forged = packReport({ nodeId: 99, seq: 1, tSec: toMeshSec(t0), lat: 30.42, lon: -87.21, kind: KIND.gunshot, label: 0, conf: 100, peakDb: 60, shotCount: 9, rangeFt: 0xffff, bearing: 0xffff });
  const badTag = Buffer.from(computeTag(forged, Buffer.from('WRONG-KEY')));
  const forgedSigned = new Uint8Array(forged.length + badTag.length);
  forgedSigned.set(forged, 0); forgedSigned.set(badTag, forged.length);
  transport.inject(forgedSigned);

  const fresh = await gw.flush();
  log(`self-test: ${fresh.length} event(s), ${gw.rejectedCount} frame(s) rejected as unauthenticated`);
  for (const e of fresh) {
    log(`  ${e.eventId}  q=${e.quality}  nodes=[${e.hearingNodes}]  ` +
        `loc=${e.lat?.toFixed(5)},${e.lon?.toFixed(5)}  r=${e.radiusM == null ? 'n/a' : Math.round(e.radiusM) + 'm'}  ` +
        `shots=${e.shotCount}  conf=${e.conf}  peak=${e.peakDb}dB`);
  }
  const ok = fresh.length === 2 && gw.rejectedCount === 1 &&
    fresh.some((e) => e.quality === 'coarse-region' && e.hearingNodes.length === 3) &&
    fresh.some((e) => e.quality === 'single');
  log(ok ? 'SELFTEST PASS' : 'SELFTEST FAIL');
  gw.stop();
  process.exit(ok ? 0 : 1);
}
