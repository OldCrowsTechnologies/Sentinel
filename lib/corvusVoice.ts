/**
 * corvusVoice.ts -- Corvus threat briefs via ElevenLabs TTS + haptics.
 * Locked voice ID and sign-off per OCWS brand. Degrades gracefully to a
 * console log + haptic buzz when no API key is configured (offline MVP).
 */

import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

export interface BriefThreat {
  type: string;
  distance: string; // e.g. "180 ft"
  bearing?: string; // optional; omitted on mono mic
}

export interface BriefOptions {
  speak?: boolean; // synthesize + play TTS
  vibrate?: boolean; // haptic feedback
}

const SIGN_OFF = 'Corvus. Old Crows Wireless Solutions. We Always Find the Signal.';

export class CorvusVoice {
  private apiKey: string;
  private voiceId = 'Oq6YjhFgak69fZQyDSCd'; // locked Corvus voice
  private baseUrl = 'https://api.elevenlabs.io/v1';
  private modelId = 'eleven_multilingual_v2';
  private voiceSettings = { stability: 0.55, similarity_boost: 0.85 };
  private sound: Audio.Sound | null = null;
  private playing = false;

  constructor(apiKey = '') {
    this.apiKey = apiKey;
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  hasVoice(): boolean {
    return this.apiKey.length > 0;
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

  async brief(threats: BriefThreat[], opts: BriefOptions = {}): Promise<void> {
    const { speak = true, vibrate = true } = opts;
    const script = this.buildScript(threats);
    console.log('[Corvus]', script);

    if (vibrate) {
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {
        /* haptics unavailable */
      }
    }

    if (speak && this.apiKey) {
      try {
        await this.speak(script);
      } catch (e) {
        console.error('[Corvus] TTS failed:', e);
      }
    }
  }

  private async speak(text: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/text-to-speech/${this.voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: this.modelId,
        voice_settings: this.voiceSettings,
        output_format: 'mp3_44100_128',
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);

    const blob = await res.blob();
    const uri: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob); // data: URI playable by expo-av
    });

    if (this.sound) {
      await this.sound.unloadAsync();
      this.sound = null;
    }
    this.sound = new Audio.Sound();
    await this.sound.loadAsync({ uri });
    this.playing = true;
    await this.sound.playAsync();
  }

  async stop(): Promise<void> {
    if (this.sound && this.playing) {
      await this.sound.stopAsync();
      this.playing = false;
    }
  }

  async dispose(): Promise<void> {
    if (this.sound) {
      await this.sound.unloadAsync();
      this.sound = null;
    }
  }
}

export default CorvusVoice;
