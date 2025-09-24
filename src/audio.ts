export type BeepType = 'countdown' | 'start' | 'end';

const AudioContextCtor: typeof AudioContext | undefined =
  typeof window !== 'undefined'
    ? (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    : undefined;

const DEFAULT_GAIN = 0.3;

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
    gainNode.gain.value = DEFAULT_GAIN;
    oscillator.connect(gainNode);
    gainNode.connect(this.gain ?? context.destination);

    const now = context.currentTime;
    oscillator.start(now);
    oscillator.stop(now + durationMs / 1000);
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

