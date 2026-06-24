/**
 * audioCapture.ts -- real-time microphone capture for Corvus Sentinel.
 *
 * Streams 16 kHz mono PCM via react-native-audio-api's AudioRecorder
 * (data-callback mode), accumulates fixed-length analysis windows, and fires a
 * callback the classifier consumes. On Android it runs a microphone foreground
 * service with a persistent notification, so monitoring continues when the app
 * is backgrounded / screen is off. 16 kHz + mono match the model's DSP config.
 */

import { Platform } from 'react-native';
import { AudioRecorder, AudioManager } from 'react-native-audio-api';

export interface AudioCaptureOptions {
  sampleRate?: number; // must match model.dsp.sampleRate (16000)
  windowSec?: number; // analysis window length (match model.dsp.clipSec)
  hopSec?: number; // emit cadence (overlap = windowSec - hopSec)
}

const isAndroid = Platform.OS === 'android';

export class AudioCaptureService {
  private recorder: AudioRecorder | null = null;
  private sampleRate: number;
  private windowSamples: number;
  private hopSamples: number;
  private buffer: Float32Array;
  private filled = 0;
  private monitoring = false;
  private lastRms = 0;
  private interruptionSub: { remove: () => void } | null = null;
  private onWindow: ((window: Float32Array, rms: number) => void) | null = null;

  constructor(opts: AudioCaptureOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 16000;
    const windowSec = opts.windowSec ?? 2.0;
    const hopSec = opts.hopSec ?? 1.0;
    this.windowSamples = Math.round(windowSec * this.sampleRate);
    this.hopSamples = Math.round(hopSec * this.sampleRate);
    this.buffer = new Float32Array(this.windowSamples);
  }

  isActive(): boolean {
    return this.monitoring;
  }

  getLastRms(): number {
    return this.lastRms;
  }

  /** Begin monitoring. onWindow fires every hopSec with a full analysis window. */
  async startMonitoring(onWindow: (window: Float32Array, rms: number) => void): Promise<void> {
    if (this.monitoring) return;
    this.onWindow = onWindow;

    AudioManager.setAudioSessionOptions({
      iosCategory: 'record',
      iosMode: 'measurement',
      iosOptions: ['allowBluetooth'],
    });

    const perm = await AudioManager.requestRecordingPermissions();
    if (perm !== 'Granted') throw new Error('Microphone permission denied');

    const active = await AudioManager.setAudioSessionActivity(true);
    if (!active) throw new Error('Could not activate audio session');

    // Hold audio focus + observe interruptions (calls, other apps). The library
    // re-emits an 'interruption' system event we listen for to reactivate.
    try {
      AudioManager.observeAudioInterruptions(true);
      this.interruptionSub =
        AudioManager.addSystemEventListener('interruption', (e: any) => {
          console.log('[AudioCapture] interruption', e?.type, 'resume:', e?.shouldResume);
          if (e?.type === 'ended' && e?.shouldResume) {
            AudioManager.setAudioSessionActivity(true);
          }
        }) ?? null;
    } catch {
      /* optional */
    }

    // react-native-audio-api 0.8.x: options go to the constructor, the data
    // callback is the sole argument to onAudioReady. The Android microphone
    // foreground service + its persistent notification are provided by the
    // config plugin (androidForegroundService / androidFSTypes in app.json),
    // not a JS notification manager.
    this.recorder = new AudioRecorder({
      sampleRate: this.sampleRate,
      bufferLengthInSamples: Math.round(0.1 * this.sampleRate), // 100 ms chunks
    });
    this.filled = 0;

    this.recorder.onAudioReady(
      ({ buffer, numFrames }: any) => this.onChunk(buffer, numFrames)
    );

    this.recorder.start();

    this.monitoring = true;
    console.log('[AudioCapture] monitoring started @', this.sampleRate, 'Hz');
  }

  private onChunk(audioBuffer: any, numFrames: number): void {
    let chunk: Float32Array;
    try {
      chunk = audioBuffer.getChannelData(0);
    } catch {
      return;
    }
    const n = Math.min(numFrames, chunk.length);
    for (let i = 0; i < n; i++) {
      this.buffer[this.filled++] = chunk[i];
      if (this.filled >= this.windowSamples) {
        this.emitWindow();
        const keep = this.windowSamples - this.hopSamples;
        if (keep > 0) {
          this.buffer.copyWithin(0, this.hopSamples, this.windowSamples);
          this.filled = keep;
        } else {
          this.filled = 0;
        }
      }
    }
  }

  private emitWindow(): void {
    const win = this.buffer.slice(0, this.windowSamples);
    let sq = 0;
    for (let i = 0; i < win.length; i++) sq += win[i] * win[i];
    this.lastRms = Math.sqrt(sq / win.length);
    if (this.onWindow) this.onWindow(win, this.lastRms);
  }

  async stopMonitoring(): Promise<void> {
    if (!this.monitoring) return;
    this.monitoring = false;
    try {
      this.recorder?.stop();
      this.interruptionSub?.remove();
      this.interruptionSub = null;
      await AudioManager.setAudioSessionActivity(false);
    } catch (e) {
      console.error('[AudioCapture] stop error:', e);
    }
    this.recorder = null;
    this.filled = 0;
    console.log('[AudioCapture] monitoring stopped');
  }
}

export default AudioCaptureService;
