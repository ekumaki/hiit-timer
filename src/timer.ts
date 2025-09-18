export type Phase = 'idle' | 'work' | 'rest' | 'finished';
export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface TimerSettings {
  workSeconds: number;
  restSeconds: number;
  rounds: number;
}

export interface TimerSnapshot {
  status: TimerStatus;
  phase: Phase;
  currentRound: number;
  totalRounds: number;
  durationMs: number;
  remainingMs: number;
}

export interface TimerController {
  getState(): TimerSnapshot;
  start(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  updateSettings(settings: TimerSettings): void;
}

const TICK_INTERVAL_MS = 100;

export function createTimer(
  initialSettings: TimerSettings,
  listener: (snapshot: TimerSnapshot) => void
): TimerController {
  let settings = { ...initialSettings };
  let phase: Phase = 'idle';
  let status: TimerStatus = 'idle';
  let currentRound = 0;
  let durationMs = settings.workSeconds * 1000;
  let remainingMs = durationMs;
  let targetTimestamp = 0;
  let timerId: ReturnType<typeof setInterval> | null = null;

  const emit = () => {
    listener({
      status,
      phase,
      currentRound,
      totalRounds: settings.rounds,
      durationMs,
      remainingMs
    });
  };

  const stopInterval = () => {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };

  const scheduleTick = () => {
    stopInterval();
    timerId = setInterval(tick, TICK_INTERVAL_MS);
  };

  const tick = () => {
    if (status !== 'running') {
      return;
    }

    const now = Date.now();
    remainingMs = Math.max(0, targetTimestamp - now);

    if (remainingMs <= 0) {
      advancePhase();
    } else {
      emit();
    }
  };

  const startPhase = (nextPhase: Phase, nextDurationMs: number) => {
    phase = nextPhase;
    durationMs = nextDurationMs;
    remainingMs = nextDurationMs;
    targetTimestamp = Date.now() + remainingMs;
    emit();
  };

  const advancePhase = () => {
    if (phase === 'work') {
      if (currentRound >= settings.rounds) {
        finish();
      } else {
        const nextDuration = settings.restSeconds * 1000;
        if (nextDuration === 0) {
          currentRound += 1;
          startPhase('work', settings.workSeconds * 1000);
        } else {
          startPhase('rest', nextDuration);
        }
      }
    } else if (phase === 'rest') {
      currentRound += 1;
      startPhase('work', settings.workSeconds * 1000);
    }
  };

  const finish = () => {
    stopInterval();
    status = 'finished';
    phase = 'finished';
    remainingMs = 0;
    durationMs = 0;
    emit();
  };

  const start = () => {
    if (status === 'running') {
      return;
    }

    if (status === 'paused') {
      resume();
      return;
    }

    status = 'running';
    currentRound = 1;
    startPhase('work', settings.workSeconds * 1000);
    targetTimestamp = Date.now() + remainingMs;
    scheduleTick();
  };

  const pause = () => {
    if (status !== 'running') {
      return;
    }
    const now = Date.now();
    remainingMs = Math.max(0, targetTimestamp - now);
    stopInterval();
    status = 'paused';
    emit();
  };

  const resume = () => {
    if (status !== 'paused') {
      return;
    }
    status = 'running';
    targetTimestamp = Date.now() + remainingMs;
    scheduleTick();
    emit();
  };

  const reset = () => {
    stopInterval();
    status = 'idle';
    phase = 'idle';
    currentRound = 0;
    durationMs = settings.workSeconds * 1000;
    remainingMs = durationMs;
    emit();
  };

  const updateSettings = (next: TimerSettings) => {
    settings = { ...next };
    if (status === 'idle' || status === 'finished') {
      durationMs = settings.workSeconds * 1000;
      remainingMs = durationMs;
      currentRound = 0;
      phase = 'idle';
    }
    emit();
  };

  // Emit initial state.
  emit();

  return {
    getState() {
      return {
        status,
        phase,
        currentRound,
        totalRounds: settings.rounds,
        durationMs,
        remainingMs
      };
    },
    start,
    pause,
    resume,
    reset,
    updateSettings
  };
}

