interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

type WakeLockNavigator = Navigator & {
  wakeLock: {
    request(type: 'screen'): Promise<WakeLockSentinel>;
  };
};

const supportsWakeLock =
  typeof navigator !== 'undefined' && (navigator as Partial<WakeLockNavigator>).wakeLock !== undefined;

export class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;

  async request(): Promise<boolean> {
    if (!supportsWakeLock) {
      return false;
    }
    try {
      const nav = navigator as WakeLockNavigator;
      this.sentinel = await nav.wakeLock.request('screen');
      this.sentinel.addEventListener('release', this.handleRelease);
      return true;
    } catch (error) {
      console.warn('Wake Lock の取得に失敗しました', error);
      this.sentinel = null;
      return false;
    }
  }

  async release(): Promise<boolean> {
    if (!this.sentinel) {
      return false;
    }
    try {
      this.sentinel.removeEventListener('release', this.handleRelease);
      await this.sentinel.release();
      this.sentinel = null;
      return true;
    } catch (error) {
      console.warn('Wake Lock の解放に失敗しました', error);
      this.sentinel = null;
      return false;
    }
  }

  private handleRelease = () => {
    this.sentinel = null;
  };
}

export const wakeLockManager = new WakeLockManager();

