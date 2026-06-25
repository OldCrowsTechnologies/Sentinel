/**
 * wavEncoder.ts -- encode a mono Float32 PCM clip (~[-1,1]) into a 16-bit PCM
 * WAV file, returned base64 for FileSystem. These are real .wav files so they
 * drop straight into training/train_corvus.py --data (scipy.io.wavfile reads
 * 16-bit PCM WAV directly).
 */

function bytesToBase64(bytes: Uint8Array): string {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += c[(n >> 18) & 63] + c[(n >> 12) & 63] + c[(n >> 6) & 63] + c[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += c[(n >> 18) & 63] + c[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += c[(n >> 18) & 63] + c[(n >> 12) & 63] + c[(n >> 6) & 63] + '=';
  }
  return out;
}

/** Encode Float32 samples to a 16-bit mono WAV; returns base64 of the file. */
export function encodeWavBase64(samples: Float32Array, sampleRate: number): string {
  const n = samples.length;
  const dataBytes = n * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const dv = new DataView(buf);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true); // PCM chunk size
  dv.setUint16(20, 1, true); // audio format = PCM
  dv.setUint16(22, 1, true); // channels = mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // byte rate (mono, 16-bit)
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  dv.setUint32(40, dataBytes, true);

  let off = 44;
  for (let i = 0; i < n; i++) {
    let s = samples[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }

  return bytesToBase64(new Uint8Array(buf));
}
