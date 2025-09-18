export type VibrationPattern = number | number[];

const supportsVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export class VibrationManager {
  private muted = false;

  setMuted(nextMuted: boolean) {
    this.muted = nextMuted;
  }

  trigger(pattern: VibrationPattern): void {
    if (!supportsVibrate || this.muted) {
      return;
    }
    try {
      navigator.vibrate(pattern);
    } catch (error) {
      console.warn('バイブレーションの実行に失敗しました', error);
    }
  }
}

export const vibrationManager = new VibrationManager();

