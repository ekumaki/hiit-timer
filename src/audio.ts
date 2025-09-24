export type BeepType = 'countdown' | 'start' | 'end';

const AudioContextCtor: typeof AudioContext | undefined =
  typeof window !== 'undefined'
    ? (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    : undefined;

// マスターゲイン（全体音量）
const DEFAULT_GAIN = 0.6;

const BEEP_PRESETS: Record<BeepType, { frequency: number; durationMs: number }> = {
  countdown: { frequency: 440, durationMs: 200 },
  start: { frequency: 440, durationMs: 350 },
  end: { frequency: 440, durationMs: 350 }
};

export class AudioManager {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private muted = false;

  constructor(private readonly enabled: boolean = !!AudioContextCtor) {}

  setMuted(nextMuted: boolean) {
    this.muted = nextMuted;
    if (this.gain) {
      this.gain.gain.value = this.muted ? 0 : DEFAULT_GAIN;
    }
  }

  async play(type: BeepType): Promise<void> {
    if (!this.enabled || this.muted) {
      return;
    }
    const context = await this.ensureContext();
    if (!context) {
      return;
    }
    const { frequency, durationMs } = BEEP_PRESETS[type];
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.frequency.value = frequency;

    // クリックノイズを避けつつ可聴性を上げるためのエンベロープ
    const now = context.currentTime;
    const attack = 0.005; // 5ms attack
    const release = 0.04; // 40ms release
    const sustainGain = 1.0; // ローカルは最大、最終的な音量はマスターゲインで制御
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(sustainGain, now + attack);
    gainNode.gain.setValueAtTime(sustainGain, now + Math.max(attack, (durationMs / 1000) - release));
    gainNode.gain.linearRampToValueAtTime(0, now + durationMs / 1000);

    oscillator.connect(gainNode);
    gainNode.connect(this.gain ?? context.destination);

    oscillator.start(now);
    oscillator.stop(now + durationMs / 1000);

    oscillator.onended = () => {
      try {
        oscillator.disconnect();
        gainNode.disconnect();
      } catch {
        // no-op
      }
    };
  }

  /**
   * iOS Safari などで、ユーザー操作直後にオーディオを解放するためのフック。
   * 初回の pointerdown などから呼び出してください。
   */
  async unlock(): Promise<void> {
    void (await this.ensureContext());
  }

  private async ensureContext(): Promise<AudioContext | null> {
    if (!AudioContextCtor) {
      return null;
    }
    if (!this.context) {
      this.context = new AudioContextCtor();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.muted ? 0 : DEFAULT_GAIN;
      this.gain.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch (error) {
        console.warn('AudioContext の再開に失敗しました', error);
        return null;
      }
    }
    return this.context;
  }
}

export const audioManager = new AudioManager();

