/**
 * corvusVoice.ts -- Corvus threat briefs.
 *
 * Audible TTS is DISABLED until production. This module currently delivers
 * briefs as a console log + a haptic buzz only -- no audio synthesis and no
 * audio playback, so the app carries no `expo-av` / `expo-audio` dependency.
 *
 * SECURITY: the ElevenLabs API key is NEVER bundled in the app. Any
 * EXPO_PUBLIC_* var is baked into the APK and is trivially extractable, so the
 * key lives server-side in ocws-site (process.env.ELEVENLABS_API_KEY) behind
 * the /api/elevenlabs/speak proxy (already live in production). When the spoken
 * voice is restored, this module POSTs { text } to that endpoint (it returns
 * audio/mpeg for the locked Corvus voice) and plays back the returned audio
 * (prefer `expo-audio`); it must NOT call api.elevenlabs.io directly and must
 * NOT hold a key. The endpoint URL (not a secret) is overridable via
 * EXPO_PUBLIC_CORVUS_TTS_URL, mirroring specimenSync's library URL.
 *
 * The public surface (constructor, brief, setEnabled, hasVoice, dispose) is
 * kept stable so App.tsx / SettingsScreen need minimal changes.
 */

import * as Haptics from 'expo-haptics';

export interface BriefThreat {
  type: string;
  distance: string; // e.g. "180 ft"
  bearing?: string; // optional; omitted on mono mic
}

export interface BriefOptions {
  speak?: boolean; // accepted for API compatibility; audio is disabled pre-production
  vibrate?: boolean; // haptic feedback
}

const SIGN_OFF = 'Corvus. Old Crows Wireless Solutions. We Always Find the Signal.';

// Server-side TTS proxy that holds the ElevenLabs key (ocws-site). The mobile
// app only ever sees this URL, never a key. Override per-environment with
// EXPO_PUBLIC_CORVUS_TTS_URL.
const DEFAULT_TTS_URL = 'https://www.oldcrowswireless.com/api/elevenlabs/speak';
const TTS_URL = process.env.EXPO_PUBLIC_CORVUS_TTS_URL || DEFAULT_TTS_URL;

export class CorvusVoice {
  // Whether spoken briefs are desired (driven by the Settings toggle). No key
  // is ever stored client-side; audible playback is wired through the proxy.
  private enabled: boolean;
  private readonly ttsUrl: string;

  constructor(opts: { enabled?: boolean; ttsUrl?: string } = {}) {
    this.enabled = opts.enabled ?? true;
    this.ttsUrl = opts.ttsUrl || TTS_URL;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Audible voice is disabled until production; always false for now. */
  hasVoice(): boolean {
    return false;
  }

  buildScript(threats: BriefThreat[]): string {
    if (threats.length === 0) return `All clear. ${SIGN_OFF}`;
    const p = threats[0];
    const loc = p.bearing ? `${p.distance}, bearing ${p.bearing}` : `${p.distance}`;
    let s =
      threats.length === 1
        ? `Single contact. ${p.type} at ${loc}. `
        : `Multiple threats. Primary ${p.type} at ${loc}. `;
    const dist = parseInt(p.distance, 10);
    if (!isNaN(dist) && dist < 150) s += 'Immediate threat. Recommend defensive posture. ';
    else if (!isNaN(dist) && dist < 300) s += 'Elevated threat. Maintain vigilance. ';
    else s += 'Monitor situation. ';
    return s + SIGN_OFF;
  }

  /**
   * Deliver a threat brief. Audible TTS is disabled pre-production, so this
   * logs the script and (optionally) buzzes the haptics. `opts.speak` is
   * accepted but ignored until the spoken voice is restored.
   *
   * To restore audible voice: when (this.enabled && opts.speak), POST
   * { text: script } to this.ttsUrl, then play the returned audio/mpeg via
   * expo-audio. The key stays server-side — no key is referenced here.
   */
  async brief(threats: BriefThreat[], opts: BriefOptions = {}): Promise<void> {
    const { vibrate = true } = opts;
    const script = this.buildScript(threats);
    console.log('[Corvus]', script);

    if (vibrate) {
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {
        /* haptics unavailable */
      }
    }
  }

  /** No-op while audio is disabled; kept for API compatibility. */
  async stop(): Promise<void> {
    /* no audio to stop */
  }

  /** No-op while audio is disabled; kept for API compatibility. */
  async dispose(): Promise<void> {
    /* no audio resources to release */
  }
}

export default CorvusVoice;
