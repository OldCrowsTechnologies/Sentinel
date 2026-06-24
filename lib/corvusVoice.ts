/**
 * corvusVoice.ts -- Corvus threat briefs.
 *
 * Audible TTS is DISABLED until production. This module currently delivers
 * briefs as a console log + a haptic buzz only -- no ElevenLabs synthesis and
 * no audio playback, so the app carries no `expo-av` / `expo-asset` dependency.
 *
 * The public surface (constructor, brief, setApiKey, hasVoice, dispose) is kept
 * intact so App.tsx / SettingsScreen need no changes. To restore the spoken
 * Corvus voice for production, reintroduce a TTS path here (prefer `expo-audio`
 * over the deprecated `expo-av`) and wire the `speak` option back through.
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

export class CorvusVoice {
  // Retained only so SettingsScreen's voice toggle keeps a coherent state.
  // No network calls are made while audible voice is disabled.
  private apiKey: string;

  constructor(apiKey = '') {
    this.apiKey = apiKey;
  }

  setApiKey(key: string): void {
    this.apiKey = key;
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
