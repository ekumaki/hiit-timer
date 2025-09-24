import './style.css';
import { createTimer, Phase, TimerSettings, TimerSnapshot, TimerStatus } from './timer';
import { audioManager } from './audio';
import { vibrationManager } from './vibrate';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, StoredSettings } from './storage';
import { wakeLockManager } from './wake-lock';

type FieldKey = 'workSeconds' | 'restSeconds' | 'rounds';

interface FieldConfig {
  label: string;
  min: number;
  max: number;
  errorMessage: string;
}

const FIELD_CONFIG: Record<FieldKey, FieldConfig> = {
  workSeconds: {
    label: 'Work',
    min: 5,
    max: 600,
    errorMessage: '5〜600秒の範囲で設定してください'
  },
  restSeconds: {
    label: 'Rest',
    min: 5,
    max: 600,
    errorMessage: '5〜600秒の範囲で設定してください'
  },
  rounds: {
    label: 'Round',
    min: 1,
    max: 50,
    errorMessage: '1〜50回の範囲で設定してください'
  }
};

const DISPLAY_LABELS: Record<FieldKey, string> = {
  workSeconds: '運動時間（秒）',
  restSeconds: '休憩時間（秒）',
  rounds: 'ラウンド数'
};

const BACKGROUND_COLORS: Record<Phase, string> = {
  idle: '#000000',
  work: '#000000',
  rest: '#000000',
  finished: '#000000'
};

const PHASE_LABEL_MAP: Record<Phase, string> = {
  idle: 'READY',
  work: 'WORK',
  rest: 'REST',
  finished: 'DONE'
};

const COUNTDOWN_VALUES = [3, 2, 1];
const COUNTDOWN_VIBRATION_MS = 100;
const PHASE_VIBRATION_MS = 200;

interface FieldState {
  valid: boolean;
  message: string | null;
}

interface UiElements {
  container: HTMLElement;
  phaseLabel: HTMLElement;
  roundLabel: HTMLElement;
  timeValue: HTMLElement;
  startButton: HTMLButtonElement;
  startIcon: HTMLElement;
  startLabel: HTMLElement;
  resetButton: HTMLButtonElement;
  resetIcon: HTMLElement;
  resetLabel: HTMLElement;
  gearButton: HTMLButtonElement;
  settingsOverlay: HTMLElement;
  settingsPanel: HTMLElement;
  settingsForm: HTMLFormElement;
  settingsBackButton: HTMLButtonElement;
  notificationsToggle: HTMLButtonElement;
  notificationsIcon: HTMLElement;
  inputs: Record<FieldKey, HTMLInputElement>;
  errors: Record<FieldKey, HTMLElement>;
  adjustButtons: HTMLButtonElement[];
  progressCircle: SVGCircleElement;
  circumference: number;
}

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('#app が見つかりません');
}

const state = {
  settings: loadSettings(),
  fieldState: {
    workSeconds: { valid: true, message: null },
    restSeconds: { valid: true, message: null },
    rounds: { valid: true, message: null }
  } as Record<FieldKey, FieldState>,
  countdownTriggered: new Set<number>(),
  lastPhase: 'idle' as Phase,
  lastStatus: 'idle' as TimerStatus,
  wakeLockActive: false
};

if (typeof state.settings.settingsPanelOpen !== 'boolean') {
  state.settings.settingsPanelOpen = DEFAULT_SETTINGS.settingsPanelOpen;
}

audioManager.setMuted(state.settings.muted);
vibrationManager.setMuted(state.settings.muted);

const ui = renderBaseMarkup(root, state.settings);
let currentSnapshot: TimerSnapshot | null = null;

const timer = createTimer(toTimerSettings(state.settings), (snapshot) => {
  currentSnapshot = snapshot;
  handleTick(snapshot);
});

initialize();

function initialize(): void {
  for (const field of Object.keys(FIELD_CONFIG) as FieldKey[]) {
    const input = ui.inputs[field];
    input.value = state.settings[field].toString();
    validateField(field);
    input.addEventListener('input', () => handleInputChange(field));
  }

  ui.settingsForm.addEventListener('submit', (event) => event.preventDefault());
  ui.startButton.addEventListener('click', handleStartToggle);
  ui.resetButton.addEventListener('click', handleReset);
  ui.notificationsToggle.addEventListener('click', handleMuteToggle);
  ui.gearButton.addEventListener('click', () => setSettingsPanelOpen(true));
  ui.settingsBackButton.addEventListener('click', () => setSettingsPanelOpen(false));
  ui.settingsOverlay.addEventListener('click', (event) => {
    if (event.target === ui.settingsOverlay) {
      setSettingsPanelOpen(false);
    }
  });

  setSettingsPanelOpen(state.settings.settingsPanelOpen ?? DEFAULT_SETTINGS.settingsPanelOpen, { persist: false, animate: false });

  ui.adjustButtons.forEach((button) => {
    const field = button.dataset.field as FieldKey | undefined;
    const delta = Number(button.dataset.delta ?? '0');
    if (!field || !Number.isFinite(delta)) {
      return;
    }
    setupAdjustButton(button, field, delta);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.settings.settingsPanelOpen) {
      setSettingsPanelOpen(false);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentSnapshot?.status === 'running') {
      void ensureWakeLock();
    }
  });

  // iOS Safari などでのオーディオ解放: 初回ユーザー操作でAudioContextを確実に初期化
  const unlockAudio = () => {
    document.removeEventListener('pointerdown', unlockAudio);
    void audioManager.unlock?.();
  };
  document.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });

  setMutedState(state.settings.muted);
  updateStartButtonAvailability();
}

function handleTick(snapshot: TimerSnapshot): void {
  updateView(snapshot);
  handlePhaseSideEffects(snapshot);
  updateStartButtonAvailability();
}

function handleInputChange(field: FieldKey): void {
  validateField(field);
  if (allFieldsValid()) {
    const nextTimerSettings = readTimerSettingsFromInputs();
    state.settings = { ...state.settings, ...nextTimerSettings };
    saveSettings(state.settings);
    timer.updateSettings(nextTimerSettings);
  }
  updateStartButtonAvailability();
}

function handleStartToggle(): void {
  if (!currentSnapshot) {
    return;
  }
  if (currentSnapshot.status === 'running') {
    timer.pause();
    return;
  }
  if (!allFieldsValid()) {
    return;
  }
  if (state.settings.settingsPanelOpen) {
    setSettingsPanelOpen(false);
  }
  timer.start();
}

function handleReset(): void {
  if (!currentSnapshot) {
    return;
  }

  if (currentSnapshot.status === 'idle') {
    resetToDefaultSettings();
    timer.reset();
    return;
  }

  if (currentSnapshot.status === 'paused' || currentSnapshot.status === 'finished') {
    timer.reset();
  }
}

function handleMuteToggle(): void {
  setMutedState(!state.settings.muted);
  saveSettings(state.settings);
}


function setSettingsPanelOpen(
  open: boolean,
  options: { persist?: boolean; animate?: boolean } = {}
): void {
  const { persist = true, animate = true } = options;
  const previous = state.settings.settingsPanelOpen;
  state.settings.settingsPanelOpen = open;

  if (!animate) {
    ui.settingsOverlay.classList.add('settings-overlay--no-transition');
    ui.settingsPanel.classList.add('settings-panel--no-transition');
  }

  ui.container.classList.toggle('app--settings-open', open);
  ui.settingsOverlay.classList.toggle('settings-overlay--open', open);
  ui.settingsPanel.classList.toggle('settings-panel--open', open);
  ui.settingsOverlay.setAttribute('aria-hidden', open ? 'false' : 'true');
  ui.settingsPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
  ui.gearButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  ui.gearButton.classList.toggle('gear-button--open', open);

  if (!animate) {
    requestAnimationFrame(() => {
      ui.settingsOverlay.classList.remove('settings-overlay--no-transition');
      ui.settingsPanel.classList.remove('settings-panel--no-transition');
    });
  }

  if (open) {
    ui.settingsBackButton.focus();
  } else {
    ui.gearButton.focus();
  }

  if (persist && previous !== open) {
    saveSettings(state.settings);
  }
}

function updateView(snapshot: TimerSnapshot): void {
  const background = BACKGROUND_COLORS[snapshot.phase];
  const textColor = snapshot.phase === 'idle' || snapshot.phase === 'work' || snapshot.phase === 'rest'
    ? '#FFFFFF'
    : pickTextColor(background);

  setCssVar('--background-color', background);
  setCssVar('--text-color', textColor);
  ui.container.dataset.phase = snapshot.phase;

  ui.phaseLabel.textContent = PHASE_LABEL_MAP[snapshot.phase];
  const displayedRound = snapshot.currentRound === 0 ? 0 : snapshot.currentRound;
  ui.roundLabel.textContent = `${displayedRound} / ${snapshot.totalRounds}`;

  const secondsRemaining = computeSeconds(snapshot);
  ui.timeValue.textContent = formatSeconds(secondsRemaining);

  const progress = calculateProgress(snapshot);
  const dashOffset = ui.circumference * (1 - progress);
  ui.progressCircle.style.strokeDashoffset = `${-dashOffset}`;

  const { status } = snapshot;
  if (status === 'running') {
    ui.startIcon.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M7 6h4v12H7zM13 6h4v12h-4z"/></svg>';
    ui.startLabel.textContent = 'Pause';
    ui.startButton.setAttribute('aria-label', 'Pause timer');
  } else {
    ui.startIcon.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
    ui.startLabel.textContent = 'Start';
    const ariaText = status === 'paused' ? 'Resume timer' : 'Start timer';
    ui.startButton.setAttribute('aria-label', ariaText);
  }

  const resetEnabled = status === 'paused' || status === 'finished';
  ui.resetButton.disabled = !resetEnabled;

  setInputsDisabled(status === 'running' || status === 'paused');

  document.title =
    status === 'running' || status === 'paused'
      ? `${PHASE_LABEL_MAP[snapshot.phase]} 残り${secondsRemaining}秒 - HIITタイマー`
      : 'HIITタイマー';
}

function handlePhaseSideEffects(snapshot: TimerSnapshot): void {
  if (snapshot.phase !== state.lastPhase) {
    state.countdownTriggered.clear();
  }

  if (snapshot.status === 'running' && snapshot.durationMs > 0) {
    const seconds = Math.ceil(snapshot.remainingMs / 1000);
    if (COUNTDOWN_VALUES.includes(seconds) && seconds > 0 && !state.countdownTriggered.has(seconds)) {
      state.countdownTriggered.add(seconds);
      triggerCountdownFeedback();
    }
  }

  if (
    snapshot.status === 'running' &&
    (state.lastStatus === 'idle' || state.lastStatus === 'finished') &&
    snapshot.phase === 'work'
  ) {
    triggerStartFeedback();
  }

  if (snapshot.status === 'finished' && state.lastStatus !== 'finished') {
    triggerEndFeedback();
  }

  if (snapshot.status === 'running') {
    void ensureWakeLock();
  } else {
    ui.startIcon.style.fontSize = '1.1em';
    void releaseWakeLock();
  }

  state.lastPhase = snapshot.phase;
  state.lastStatus = snapshot.status;
}

function triggerCountdownFeedback(): void {
  void audioManager.play('countdown');
  vibrationManager.trigger(COUNTDOWN_VIBRATION_MS);
}

function triggerStartFeedback(): void {
  void audioManager.play('start');
  vibrationManager.trigger(PHASE_VIBRATION_MS);
}

function triggerEndFeedback(): void {
  void audioManager.play('end');
  vibrationManager.trigger(PHASE_VIBRATION_MS);
}

function resetToDefaultSettings(): void {
  const nextSettings: StoredSettings = {
    ...state.settings,
    workSeconds: DEFAULT_SETTINGS.workSeconds,
    restSeconds: DEFAULT_SETTINGS.restSeconds,
    rounds: DEFAULT_SETTINGS.rounds
  };
  state.settings = nextSettings;
  for (const field of Object.keys(FIELD_CONFIG) as FieldKey[]) {
    ui.inputs[field].value = nextSettings[field].toString();
    validateField(field);
  }
  saveSettings(nextSettings);
  timer.updateSettings(toTimerSettings(nextSettings));
}

function validateField(field: FieldKey): void {
  const input = ui.inputs[field];
  const config = FIELD_CONFIG[field];
  const raw = input.value.trim();
  const numericValue = Number(raw);
  const valid =
    raw !== '' && Number.isInteger(numericValue) && numericValue >= config.min && numericValue <= config.max;
  state.fieldState[field] = { valid, message: valid ? null : config.errorMessage };
  input.setAttribute('aria-invalid', valid ? 'false' : 'true');
  ui.errors[field].textContent = valid ? '' : config.errorMessage;
}

function allFieldsValid(): boolean {
  return (Object.keys(state.fieldState) as FieldKey[]).every((key) => state.fieldState[key].valid);
}

function readTimerSettingsFromInputs(): TimerSettings {
  return {
    workSeconds: Number(ui.inputs.workSeconds.value),
    restSeconds: Number(ui.inputs.restSeconds.value),
    rounds: Number(ui.inputs.rounds.value)
  };
}

function updateStartButtonAvailability(): void {
  if (!currentSnapshot) {
    return;
  }
  const disableForInvalid =
    !allFieldsValid() && (currentSnapshot.status === 'idle' || currentSnapshot.status === 'finished');
  ui.startButton.disabled = disableForInvalid;
}

function computeSeconds(snapshot: TimerSnapshot): number {
  if (snapshot.status === 'finished') {
    return 0;
  }
  if (snapshot.status === 'idle') {
    return state.settings.workSeconds;
  }
  return Math.max(0, Math.ceil(snapshot.remainingMs / 1000));
}

function calculateProgress(snapshot: TimerSnapshot): number {
  if (snapshot.durationMs <= 0) {
    return snapshot.status === 'idle' ? 1 : 0;
  }
  const ratio = snapshot.remainingMs / snapshot.durationMs;
  return Math.min(1, Math.max(0, ratio));
}

function setupAdjustButton(button: HTMLButtonElement, field: FieldKey, delta: number): void {
  let holdTimeout: number | null = null;
  let repeatInterval: number | null = null;

  const step = () => adjustField(field, delta);

  const clearTimers = () => {
    if (holdTimeout !== null) {
      window.clearTimeout(holdTimeout);
      holdTimeout = null;
    }
    if (repeatInterval !== null) {
      window.clearInterval(repeatInterval);
      repeatInterval = null;
    }
  };

  const startRepeater = () => {
    if (repeatInterval !== null) {
      window.clearInterval(repeatInterval);
    }
    repeatInterval = window.setInterval(step, 100);
  };

  button.addEventListener('pointerdown', (event) => {
    if (button.disabled) {
      return;
    }
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    step();
    holdTimeout = window.setTimeout(() => {
      startRepeater();
    }, 500);
  });

  const endHold = (event: PointerEvent) => {
    event.preventDefault();
    clearTimers();
    button.releasePointerCapture?.(event.pointerId);
  };

  button.addEventListener('pointerup', endHold);
  button.addEventListener('pointercancel', endHold);
  button.addEventListener('pointerleave', (event) => {
    clearTimers();
    button.releasePointerCapture?.(event.pointerId);
  });
}

function adjustField(field: FieldKey, delta: number): void {
  const input = ui.inputs[field];
  const config = FIELD_CONFIG[field];
  const current = Number(input.value) || 0;
  const next = clamp(Math.round(current + delta), config.min, config.max);
  input.value = next.toString();
  handleInputChange(field);
}

function setInputsDisabled(disabled: boolean): void {
  for (const field of Object.keys(ui.inputs) as FieldKey[]) {
    ui.inputs[field].disabled = disabled;
  }
  ui.adjustButtons.forEach((button) => {
    button.disabled = disabled;
  });
}

function setMutedState(muted: boolean): void {
  state.settings.muted = muted;
  audioManager.setMuted(muted);
  vibrationManager.setMuted(muted);
  const notificationsOn = !muted;
  ui.notificationsToggle.setAttribute('aria-checked', notificationsOn ? 'true' : 'false');
  ui.notificationsToggle.classList.toggle('toggle-switch--on', notificationsOn);
  const ariaLabel = notificationsOn ? '音声とバイブ通知をオフにする' : '音声とバイブ通知をオンにする';
  ui.notificationsToggle.setAttribute('aria-label', ariaLabel);
  ui.notificationsIcon.textContent = notificationsOn ? '🔊' : '🔇';
  const srText = ui.notificationsToggle.querySelector<HTMLElement>('.visually-hidden');
  if (srText) {
    srText.textContent = notificationsOn ? '通知はオンです' : '通知はオフです';
  }
}


function formatSeconds(value: number): string {
  return Math.max(0, value).toString();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pickTextColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return '#FFFFFF';
  }
  const luminance = relativeLuminance(rgb);
  const contrastWhite = (1 + 0.05) / (luminance + 0.05);
  const contrastBlack = (luminance + 0.05) / 0.05;
  return contrastWhite >= contrastBlack ? '#FFFFFF' : '#000000';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return null;
  }
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) {
    return null;
  }
  return { r, g, b };
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const srgb = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  const [rl, gl, bl] = srgb;
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function setCssVar(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value);
}

function toTimerSettings(settings: StoredSettings): TimerSettings {
  return {
    workSeconds: settings.workSeconds,
    restSeconds: settings.restSeconds,
    rounds: settings.rounds
  };
}

function renderBaseMarkup(rootEl: HTMLElement, settings: StoredSettings): UiElements {
  const panelIsInitiallyOpen = settings.settingsPanelOpen ?? DEFAULT_SETTINGS.settingsPanelOpen;
  const appOpenClass = panelIsInitiallyOpen ? ' app--settings-open' : '';
  const overlayOpenClass = panelIsInitiallyOpen ? ' settings-overlay--open' : '';
  const panelOpenClass = panelIsInitiallyOpen ? ' settings-panel--open' : '';
  const overlayAriaHidden = panelIsInitiallyOpen ? 'false' : 'true';
  const gearExpandedAttr = panelIsInitiallyOpen ? 'true' : 'false';
  const notificationsOn = !settings.muted;
  const notificationsToggleClass = notificationsOn ? ' toggle-switch--on' : '';
  const notificationsAriaChecked = notificationsOn ? 'true' : 'false';
  const notificationsIconChar = notificationsOn ? '🔊' : '🔇';
  const notificationsSrText = notificationsOn ? '通知はオンです' : '通知はオフです';

  const fieldsMarkup = (Object.keys(FIELD_CONFIG) as FieldKey[])
    .map((field) => {
      const config = FIELD_CONFIG[field];
      const displayLabel = DISPLAY_LABELS[field];
      return `
        <div class="setting-field" data-field="${field}">
          <label class="setting-label" for="${field}">${displayLabel}</label>
          <div class="setting-control">
            <button type="button" class="adjust-button adjust-decrease" data-field="${field}" data-delta="-1" aria-label="Decrease ${config.label} by 1">-</button>
            <input id="${field}" name="${field}" class="setting-input" type="number" inputmode="numeric" pattern="[0-9]*" min="${config.min}" max="${config.max}" step="1" aria-describedby="${field}-error" value="${settings[field]}" />
            <button type="button" class="adjust-button adjust-increase" data-field="${field}" data-delta="1" aria-label="Increase ${config.label} by 1">+</button>
          </div>
          <p class="field-error" id="${field}-error" role="alert" aria-live="assertive"></p>
        </div>
      `;
    })
    .join('');

  rootEl.innerHTML = `
    <div class="app${appOpenClass}" data-phase="idle">
      <header class="status-bar">
        <div class="status-labels">
          <span class="phase-label" data-role="phase" aria-live="polite">${PHASE_LABEL_MAP.idle}</span>
          <span class="round-label" data-role="round" aria-live="polite">0 / ${settings.rounds}</span>
        </div>
        <button type="button" class="gear-button" aria-label="設定を開く" aria-controls="settings-overlay" aria-expanded="${gearExpandedAttr}">
          <span aria-hidden="true">⚙</span>
        </button>
      </header>
      <main class="timer-area">
        <div class="timer-visual">
          <svg class="progress-ring" width="260" height="260" viewBox="0 0 120 120" role="presentation" aria-hidden="true">
            <circle class="ring-track" cx="60" cy="60" r="54"></circle>
            <circle class="ring-progress" cx="60" cy="60" r="54"></circle>
          </svg>
          <div class="time-display" aria-live="assertive">${formatSeconds(settings.workSeconds)}</div>
        </div>
      </main>
      <section class="controls">
        <div class="action-row">
          <button type="button" class="action-button action-toggle" aria-label="Start timer">
            <span class="btn-icon" aria-hidden="true">▶</span>
            <span class="btn-label">Start</span>
          </button>
          <button type="button" class="action-button action-reset" aria-label="Reset timer">
            <span class="btn-icon" aria-hidden="true">↺</span>
            <span class="btn-label">Reset</span>
          </button>
        </div>
      </section>
      <div class="settings-overlay${overlayOpenClass}" id="settings-overlay" aria-hidden="${overlayAriaHidden}">
        <div class="settings-panel${panelOpenClass}" aria-hidden="${overlayAriaHidden}">
          <header class="settings-panel__header">
            <button type="button" class="settings-back" aria-label="設定を閉じる">
              <span aria-hidden="true">←</span>
            </button>
            <h2 class="settings-panel__title">設定</h2>
          </header>
          <form class="settings-form" novalidate>
            <fieldset class="settings-group">
              <legend class="visually-hidden">タイマー設定</legend>
              ${fieldsMarkup}
              <div class="setting-field setting-field--notifications">
                <div class="setting-toggle-row">
                  <span class="setting-label">音声・バイブ</span>
                  
                  <div class="notifications-control">
                    <span class="notifications-icon" aria-hidden="true">${notificationsIconChar}</span>
                    <button type="button" class="notifications-toggle toggle-switch${notificationsToggleClass}" role="switch" aria-checked="${notificationsAriaChecked}">
                      <span class="toggle-switch__track"></span>
                      <span class="toggle-switch__thumb"></span>
                      <span class="visually-hidden">${notificationsSrText}</span>
                    </button>
                  </div>
                </div>
              </div>
            </fieldset>
          </form>
        </div>
      </div>
    </div>
  `;

  const container = rootEl.querySelector<HTMLElement>('.app');
  const phaseLabel = rootEl.querySelector<HTMLElement>('.phase-label');
  const roundLabel = rootEl.querySelector<HTMLElement>('.round-label');
  const timeValue = rootEl.querySelector<HTMLElement>('.time-display');
  const startButton = rootEl.querySelector<HTMLButtonElement>('.action-toggle');
  const resetButton = rootEl.querySelector<HTMLButtonElement>('.action-reset');
  const gearButton = rootEl.querySelector<HTMLButtonElement>('.gear-button');
  const settingsOverlay = rootEl.querySelector<HTMLElement>('#settings-overlay');
  const settingsPanel = rootEl.querySelector<HTMLElement>('.settings-panel');
  const settingsForm = rootEl.querySelector<HTMLFormElement>('.settings-form');
  const settingsBackButton = rootEl.querySelector<HTMLButtonElement>('.settings-back');
  const notificationsToggle = rootEl.querySelector<HTMLButtonElement>('.notifications-toggle');
  const notificationsIcon = rootEl.querySelector<HTMLElement>('.notifications-icon');
  const progressCircle = rootEl.querySelector<SVGCircleElement>('.ring-progress');
  const adjustButtons = Array.from(rootEl.querySelectorAll<HTMLButtonElement>('.adjust-button'));

  if (
    !container ||
    !phaseLabel ||
    !roundLabel ||
    !timeValue ||
    !startButton ||
    !resetButton ||
    !gearButton ||
    !settingsOverlay ||
    !settingsPanel ||
    !settingsForm ||
    !settingsBackButton ||
    !notificationsToggle ||
    !notificationsIcon ||
    !progressCircle
  ) {
    throw new Error('UI 初期化に失敗しました');
  }

  const startIcon = startButton.querySelector<HTMLElement>('.btn-icon');
  const startLabel = startButton.querySelector<HTMLElement>('.btn-label');
  const resetIcon = resetButton.querySelector<HTMLElement>('.btn-icon');
  const resetLabel = resetButton.querySelector<HTMLElement>('.btn-label');

  if (!startIcon || !startLabel || !resetIcon || !resetLabel) {
    throw new Error('操作ボタンのラベル要素が見つかりません');
  }

  const setupInline = (icon: HTMLElement, label: HTMLElement) => {
    icon.style.display = 'inline-flex';
    icon.style.alignItems = 'center';
    icon.style.justifyContent = 'center';
    icon.style.lineHeight = '1';
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.justifyContent = 'center';
    label.style.lineHeight = '1';
  };

  setupInline(startIcon, startLabel);
  setupInline(resetIcon, resetLabel);

  const inputs = {
    workSeconds: rootEl.querySelector<HTMLInputElement>('#workSeconds'),
    restSeconds: rootEl.querySelector<HTMLInputElement>('#restSeconds'),
    rounds: rootEl.querySelector<HTMLInputElement>('#rounds')
  } as Record<FieldKey, HTMLInputElement>;

  const errors = {
    workSeconds: rootEl.querySelector<HTMLElement>('#workSeconds-error'),
    restSeconds: rootEl.querySelector<HTMLElement>('#restSeconds-error'),
    rounds: rootEl.querySelector<HTMLElement>('#rounds-error')
  } as Record<FieldKey, HTMLElement>;

  if (!inputs.workSeconds || !inputs.restSeconds || !inputs.rounds || !errors.workSeconds || !errors.restSeconds || !errors.rounds) {
    throw new Error('入力フィールドの準備に失敗しました');
  }

  const radius = progressCircle.r.baseVal.value;
  const circumference = 2 * Math.PI * radius;
  progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
  progressCircle.style.strokeDashoffset = `${circumference}`;

  return {
    container,
    phaseLabel,
    roundLabel,
    timeValue,
    startButton,
    startIcon,
    startLabel,
    resetButton,
    resetIcon,
    resetLabel,
    gearButton,
    settingsOverlay,
    settingsPanel,
    settingsForm,
    settingsBackButton,
    notificationsToggle,
    notificationsIcon,
    inputs,
    errors,
    adjustButtons,
    progressCircle,
    circumference
  };
}


async function ensureWakeLock(): Promise<void> {
  if (state.wakeLockActive) {
    return;
  }
  const acquired = await wakeLockManager.request();
  state.wakeLockActive = acquired;
}

async function releaseWakeLock(): Promise<void> {
  if (!state.wakeLockActive) {
    return;
  }
  await wakeLockManager.release();
  state.wakeLockActive = false;
}

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      void registerServiceWorker();
    });
  } else {
    ui.startIcon.style.fontSize = '1.1em';
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        registrations.forEach((registration) => {
          registration.unregister().catch(() => undefined);
        });
      })
      .catch(() => undefined);
  }
}

async function registerServiceWorker(): Promise<void> {
  try {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    await navigator.serviceWorker.register(swUrl, {
      scope: import.meta.env.BASE_URL
    });
  } catch (error) {
    console.warn('Service Worker の登録に失敗しました', error);
  }
}










