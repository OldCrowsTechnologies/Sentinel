/**
 * synth.mjs -- deterministic synthetic-audio generators for the detection
 * stress test, plus a minimal mono 16-bit WAV decoder for real recordings.
 *
 * Every generator returns a Float32Array of `n` samples in ~[-1, 1]. The PRNG is
 * seeded so a given scenario is byte-identical run to run -- which lets the
 * harness assert determinism and compare results across model versions.
 */

/** mulberry32: tiny, fast, seedable PRNG. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function silence(n) {
  return new Float32Array(n);
}

export function whiteNoise(n, amp = 0.2, seed = 1) {
  const r = rng(seed);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (r() * 2 - 1) * amp;
  return x;
}

/** Paul Kellet's economical pink-noise approximation. */
export function pinkNoise(n, amp = 0.2, seed = 2) {
  const r = rng(seed);
  const x = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    x[i] = (pink / 5) * amp;
  }
  return x;
}

export function tone(n, freq, sr, amp = 0.5) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
}

/** Rotor-like harmonic stack: a fundamental + decaying harmonics + slight jitter. */
export function harmonicStack(n, fundamental, sr, { harmonics = 6, amp = 0.4, seed = 3 } = {}) {
  const r = rng(seed);
  const x = new Float32Array(n);
  const jitter = 1 + (r() - 0.5) * 0.02;
  for (let h = 1; h <= harmonics; h++) {
    const f = fundamental * h * jitter;
    if (f > sr / 2) break;
    const ha = amp / h;
    const phase = r() * Math.PI * 2;
    for (let i = 0; i < n; i++) x[i] += ha * Math.sin((2 * Math.PI * f * i) / sr + phase);
  }
  return x;
}

export function chirp(n, f0, f1, sr, amp = 0.4) {
  const x = new Float32Array(n);
  const dur = n / sr;
  const k = (f1 - f0) / dur;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const inst = 2 * Math.PI * (f0 * t + 0.5 * k * t * t);
    x[i] = amp * Math.sin(inst);
  }
  return x;
}

/**
 * Voice-like: a low fundamental (~85-255 Hz) shaped by formant resonances, with
 * slow pitch drift. This is the class the model's high-pass + VAD must reject;
 * the detection harness uses it to measure false-positive rate on speech.
 */
export function voiceLike(n, sr, { f0 = 140, amp = 0.5, seed = 4 } = {}) {
  const r = rng(seed);
  const x = new Float32Array(n);
  const formants = [700, 1220, 2600]; // schwa-ish
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const drift = 1 + 0.06 * Math.sin((2 * Math.PI * 4 * i) / sr); // 4 Hz vibrato
    phase += (2 * Math.PI * f0 * drift) / sr;
    let s = 0.6 * Math.sin(phase); // glottal fundamental
    for (let k = 0; k < formants.length; k++) {
      s += (0.3 / (k + 1)) * Math.sin((2 * Math.PI * formants[k] * i) / sr + r() * 0.001);
    }
    // syllable-rate amplitude envelope (~3 Hz) -> bursty, non-stationary
    const env = 0.5 + 0.5 * Math.sin((2 * Math.PI * 3 * i) / sr);
    x[i] = amp * env * s;
  }
  return x;
}

/** Crowded-bar babble: several detuned voices + broadband murmur. */
export function crowdBabble(n, sr, { voices = 5, amp = 0.5, seed = 5 } = {}) {
  const r = rng(seed);
  const x = new Float32Array(n);
  for (let v = 0; v < voices; v++) {
    const f0 = 95 + r() * 160;
    const v_ = voiceLike(n, sr, { f0, amp: amp / voices, seed: seed + v + 1 });
    for (let i = 0; i < n; i++) x[i] += v_[i];
  }
  const murmur = pinkNoise(n, amp * 0.4, seed + 99);
  for (let i = 0; i < n; i++) x[i] += murmur[i];
  return x;
}

/** Hard-clipped / saturated signal (tests overload handling). */
export function clipping(n, sr, amp = 4.0) {
  const base = harmonicStack(n, 180, sr, { amp });
  for (let i = 0; i < n; i++) base[i] = Math.max(-1, Math.min(1, base[i]));
  return base;
}

export function dcOffset(n, level = 0.8) {
  const x = new Float32Array(n);
  x.fill(level);
  return x;
}

// ---- minimal WAV decode (PCM 16-bit, mono; downmixes stereo) ----
export function decodeWav(buffer) {
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (dv.getUint32(0, false) !== 0x52494646) throw new Error('not a RIFF/WAV file');
  let pos = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataLen = 0;
  while (pos + 8 <= dv.byteLength) {
    const id = dv.getUint32(pos, false);
    const size = dv.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 0x666d7420) {
      fmt = {
        format: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        sampleRate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === 0x64617461) {
      dataOffset = body;
      dataLen = size;
    }
    pos = body + size + (size & 1);
  }
  if (!fmt || dataOffset < 0) throw new Error('missing fmt/data chunk');
  if (fmt.bits !== 16) throw new Error(`unsupported bit depth: ${fmt.bits}`);
  const frames = Math.floor(dataLen / 2 / fmt.channels);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    for (let c = 0; c < fmt.channels; c++) {
      acc += dv.getInt16(dataOffset + (f * fmt.channels + c) * 2, true);
    }
    out[f] = acc / fmt.channels / 32768;
  }
  return { sampleRate: fmt.sampleRate, samples: out };
}
