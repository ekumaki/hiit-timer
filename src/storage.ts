import { TimerSettings } from './timer';

export interface StoredSettings extends TimerSettings {
  muted: boolean;
  settingsPanelOpen: boolean;
}

export const STORAGE_KEY = 'hiit.settings.v1';

export const DEFAULT_SETTINGS: StoredSettings = {
  workSeconds: 20,
  restSeconds: 10,
  rounds: 8,
  muted: false,
  settingsPanelOpen: false
};

export function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_SETTINGS };
    }
    const candidate = parsed as Partial<StoredSettings>;
    if (
      typeof candidate.workSeconds !== 'number' ||
      typeof candidate.restSeconds !== 'number' ||
      typeof candidate.rounds !== 'number' ||
      typeof candidate.muted !== 'boolean'
    ) {
      return { ...DEFAULT_SETTINGS };
    }
    return {
      workSeconds: clamp(Math.round(candidate.workSeconds), 5, 600),
      restSeconds: clamp(Math.round(candidate.restSeconds), 5, 600),
      rounds: clamp(Math.round(candidate.rounds), 1, 50),
      muted: candidate.muted,
      settingsPanelOpen:
        typeof candidate.settingsPanelOpen === 'boolean'
          ? candidate.settingsPanelOpen
          : DEFAULT_SETTINGS.settingsPanelOpen
    };
  } catch (error) {
    console.warn('Failed to load settings', error);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: StoredSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to save settings', error);
  }
}

export function clearStoredSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear settings', error);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}


