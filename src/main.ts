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
    label: '運動',
    min: 5,
    max: 600,
    errorMessage: '5〜600の整数を入力してください'
  },
  restSeconds: {
    label: '休憩',
    min: 5,
    max: 600,
    errorMessage: '5〜600の整数を入力してください'
  },
  rounds: {
    label: '回数',
    min: 1,
    max: 50,
    errorMessage: '1〜50の整数を入力してください'
  }
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
  muteButton: HTMLButtonElement;
  muteIcon: HTMLElement;
  settingsForm: HTMLFormElement;
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

audioManager.setMuted(state.settings.muted);
vibrationManager.setMuted(state.settings.muted);

const ui = renderBaseMarkup(root, state.settings);
const roundHost = root.querySelector('.timer-visual');
if (roundHost) {
  roundHost.appendChild(ui.roundLabel);
  ui.roundLabel.classList.add('round-label--below');
}
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
  ui.muteButton.addEventListener('click', handleMuteToggle);

  ui.adjustButtons.forEach((button) => {
    const field = button.dataset.field as FieldKey | undefined;
    const delta = Number(button.dataset.delta ?? '0');
    if (!field || !Number.isFinite(delta)) {
      return;
    }
    setupAdjustButton(button, field, delta);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentSnapshot?.status === 'running') {
      void ensureWakeLock();
    }
  });

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
    ui.startIcon.textContent = '⏸';
    ui.startIcon.style.fontSize = '1.2em';
    ui.startLabel.textContent = 'Pause';
    ui.startButton.setAttribute('aria-label', 'Pause timer');
  } else {
    ui.startIcon.style.fontSize = '1.1em';
    ui.startIcon.textContent = '▶';
    ui.startIcon.style.fontSize = '0.9em';
    ui.startIcon.style.lineHeight = '1';
    ui.startLabel.textContent = 'Start';
    ui.startLabel.style.fontSize = '1.1rem';
    ui.startLabel.style.lineHeight = '1';
    const ariaText = status === 'paused' ? 'Resume timer' : 'Start timer';
    ui.startButton.setAttribute('aria-label', ariaText);
  }

  const resetEnabled = status === 'paused' || status === 'finished' || status === 'idle';
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
  let accelerationTimeout: number | null = null;

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
    if (accelerationTimeout !== null) {
      window.clearTimeout(accelerationTimeout);
      accelerationTimeout = null;
    }
  };

  const startRepeater = (interval: number) => {
    if (repeatInterval !== null) {
      window.clearInterval(repeatInterval);
    }
    repeatInterval = window.setInterval(step, interval);
  };

  button.addEventListener('pointerdown', (event) => {
    if (button.disabled) {
      return;
    }
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    step();
    holdTimeout = window.setTimeout(() => {
      startRepeater(120);
      accelerationTimeout = window.setTimeout(() => {
        startRepeater(60);
      }, 900);
    }, 300);
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
  ui.muteButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
  ui.muteButton.setAttribute('aria-label', muted ? 'サウンドとバイブのミュートを解除' : 'サウンドとバイブをミュート');
  ui.muteIcon.textContent = muted ? '🔇' : '🔈';
  const srText = ui.muteButton.querySelector<HTMLElement>('.visually-hidden');
  if (srText) {
    srText.textContent = muted ? 'サウンドとバイブのミュートを解除' : 'サウンドとバイブをミュート';
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
  const fieldsMarkup = (Object.keys(FIELD_CONFIG) as FieldKey[])
    .map((field) => {
      const config = FIELD_CONFIG[field];
      return `
        <div class="setting-field" data-field="${field}">
          <p class="setting-label">${config.label}</p>
          <div class="setting-input">
            <button type="button" class="adjust-button adjust-increase" data-field="${field}" data-delta="1" aria-label="${config.label}を1増やす">＋</button>
            <input id="${field}" name="${field}" type="number" inputmode="numeric" pattern="[0-9]*" min="${config.min}" max="${config.max}" step="1" aria-describedby="${field}-error" />
            <button type="button" class="adjust-button adjust-decrease" data-field="${field}" data-delta="-1" aria-label="${config.label}を1減らす">ー</button>
          </div>
          <p class="field-error" id="${field}-error" role="alert" aria-live="assertive"></p>
        </div>
      `;
    })
    .join('');

  rootEl.innerHTML = `
    <div class="app" data-phase="idle">
      <header class="status-bar">
        <span class="phase-label" data-role="phase" aria-live="polite">${PHASE_LABEL_MAP.idle}</span>
        <span class="round-label" data-role="round" aria-live="polite">0 / ${settings.rounds}</span>
      </header>
      <main class="timer-area">
        <div class="timer-visual">
          <svg class="progress-ring" width="240" height="240" viewBox="0 0 120 120" role="presentation" aria-hidden="true">
            <circle class="ring-track" cx="60" cy="60" r="54"></circle>
            <circle class="ring-progress" cx="60" cy="60" r="54"></circle>
          </svg>
          <div class="time-display" aria-live="assertive">${formatSeconds(settings.workSeconds)}</div>
        </div>
      </main>
      <section class="controls">
        <div class="action-row">
          <button type="button" class="action-button action-reset" aria-label="Reset timer">
            <span class="btn-icon" aria-hidden="true">↻</span>
            <span class="btn-label">Reset</span>
          </button>
          <button type="button" class="action-button action-toggle" aria-label="Start timer">
            <span class="btn-icon" aria-hidden="true">▶</span>
            <span class="btn-label">Start</span>
          </button>
          <button type="button" class="action-button action-mute" aria-pressed="false" aria-label="サウンドとバイブをミュート">
            <span class="mute-icon" aria-hidden="true">🔈</span>
            <span class="visually-hidden">サウンドとバイブをミュート</span>
          </button>
        </div>
        <form class="settings-form" novalidate>
          <fieldset class="settings-group">
            <legend class="visually-hidden">タイマー設定</legend>
            ${fieldsMarkup}
          </fieldset>
        </form>
      </section>
    </div>
  `;

  const container = rootEl.querySelector<HTMLElement>('.app');
  const phaseLabel = rootEl.querySelector<HTMLElement>('.phase-label');
  const roundLabel = rootEl.querySelector<HTMLElement>('.round-label');
  const timeValue = rootEl.querySelector<HTMLElement>('.time-display');
  const startButton = rootEl.querySelector<HTMLButtonElement>('.action-toggle');
  const resetButton = rootEl.querySelector<HTMLButtonElement>('.action-reset');
  const muteButton = rootEl.querySelector<HTMLButtonElement>('.action-mute');
  const muteIcon = rootEl.querySelector<HTMLElement>('.mute-icon');
  const settingsForm = rootEl.querySelector<HTMLFormElement>('.settings-form');
  const progressCircle = rootEl.querySelector<SVGCircleElement>('.ring-progress');
  const adjustButtons = Array.from(rootEl.querySelectorAll<HTMLButtonElement>('.adjust-button'));

  if (!container || !phaseLabel || !roundLabel || !timeValue || !startButton || !resetButton || !muteButton || !muteIcon || !settingsForm || !progressCircle) {
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
    throw new Error('入力要素の初期化に失敗しました');
  }

  const radius = progressCircle.r.baseVal.value;
  const circumference = 2 * Math.PI * radius;
  progressCircle.style.strokeDasharray = `${circumference}`;
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
    muteButton,
    muteIcon,
    settingsForm,
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










