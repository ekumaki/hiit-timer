import { TimerSettings } from './timer';

export interface StoredSettings extends TimerSettings {
  muted: boolean;
}

export const STORAGE_KEY = 'hiit.settings.v1';

export const DEFAULT_SETTINGS: StoredSettings = {
  workSeconds: 20,
  restSeconds: 10,
  rounds: 8,
  muted: false
};

export function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.workSeconds !== 'number' ||
      typeof parsed.restSeconds !== 'number' ||
      typeof parsed.rounds !== 'number' ||
      typeof parsed.muted !== 'boolean'
    ) {
      return { ...DEFAULT_SETTINGS };
    }
    return {
      workSeconds: clamp(Math.round(parsed.workSeconds), 5, 600),
      restSeconds: clamp(Math.round(parsed.restSeconds), 5, 600),
      rounds: clamp(Math.round(parsed.rounds), 1, 50),
      muted: parsed.muted
    };
  } catch (error) {
    console.warn('設定の読み込みに失敗しました', error);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: StoredSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('設定の保存に失敗しました', error);
  }
}

export function clearStoredSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('設定の削除に失敗しました', error);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

