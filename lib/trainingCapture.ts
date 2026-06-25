/**
 * trainingCapture.ts -- raw continuous mic recording for labeled training data.
 *
 * Unlike audioCapture.ts (which windows audio for live inference), this just
 * accumulates the full clip so the operator can record a drone/negative sample,
 * label it, and feed it back into retraining. Uses one AudioRecorder; the caller
 * must stop live monitoring first (single mic session).
 */

import { AudioRecorder, AudioManager } from 'react-native-audio-api';

const SAMPLE_RATE = 16000; // matches the model's DSP

export class TrainingCapture {
  private recorder: AudioRecorder | null = null;
  private chunks: Float32Array[] = [];
  private total = 0;
  private recording = false;

  isRecording(): boolean {
    return this.recording;
  }

  durationSec(): number {
    return this.total / SAMPLE_RATE;
  }

  async start(): Promise<void> {
    if (this.recording) return;
    AudioManager.setAudioSessionOptions({
      iosCategory: 'record',
      iosMode: 'measurement',
      iosOptions: ['allowBluetooth'],
    });
    const perm = await AudioManager.requestRecordingPermissions();
    if (perm !== 'Granted') throw new Error('Microphone permission denied');
    const active = await AudioManager.setAudioSessionActivity(true);
    if (!active) throw new Error('Could not activate audio session');

    this.chunks = [];
    this.total = 0;
    this.recorder = new AudioRecorder({
      sampleRate: SAMPLE_RATE,
      bufferLengthInSamples: Math.round(0.1 * SAMPLE_RATE),
    });
    this.recorder.onAudioReady(({ buffer, numFrames }: any) => {
      try {
        const ch: Float32Array = buffer.getChannelData(0);
        const n = Math.min(numFrames, ch.length);
        this.chunks.push(ch.slice(0, n));
        this.total += n;
      } catch {
        /* drop bad chunk */
      }
    });
    this.recorder.start();
    this.recording = true;
  }

  /** Stop and return the full mono clip. */
  async stop(): Promise<{ samples: Float32Array; sampleRate: number }> {
    if (!this.recording) return { samples: new Float32Array(0), sampleRate: SAMPLE_RATE };
    this.recording = false;
    try {
      this.recorder?.stop();
      await AudioManager.setAudioSessionActivity(false);
    } catch {
      /* ignore */
    }
    this.recorder = null;

    const out = new Float32Array(this.total);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    this.chunks = [];
    return { samples: out, sampleRate: SAMPLE_RATE };
  }
}

export default TrainingCapture;
