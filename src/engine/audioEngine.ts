import { DEFAULT_PRACTICE, type PracticeSettings } from './practice';
import { Sequencer } from './sequencer';
import { playClick } from './sounds';
import { JitterStats, type JitterReport } from './stats';
import type { BeatEvent, ClickVoice, RhythmSettings, SoundId } from './types';

export interface EngineConfig {
  /** Scheduler wake-up period (ms). */
  intervalMs: number;
  /** How far ahead clicks are scheduled while the page is visible (s). */
  lookahead: number;
  /** Lookahead while hidden / screen off, where timers get throttled (s). */
  hiddenLookahead: number;
  /** If the scheduler falls further behind than this (s), skip ahead instead of bursting clicks. */
  maxLateness: number;
}

const DEFAULT_CONFIG: EngineConfig = { intervalMs: 25, lookahead: 0.1, hiddenLookahead: 1.0, maxLateness: 0.05 };

export type BeatListener = (ev: BeatEvent) => void;
/** Called with every batch of events as soon as they are scheduled (ahead of time). */
export type ScheduleListener = (events: BeatEvent[]) => void;
export type StopReason = 'user' | 'finished';
export type StateListener = (running: boolean, reason?: StopReason) => void;

interface Ticker {
  start(interval: number): void;
  stop(): void;
}

function createTicker(onTick: () => void): Ticker {
  try {
    const w = new Worker(new URL('./timerWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = onTick;
    return {
      start: (interval) => w.postMessage({ cmd: 'start', interval }),
      stop: () => w.postMessage({ cmd: 'stop' }),
    };
  } catch {
    // Fallback: main-thread wake-ups. Still only a wake-up; timing comes from the audio clock.
    let id: number | undefined;
    return {
      start: (interval) => {
        const loop = () => {
          onTick();
          id = window.setTimeout(loop, interval);
        };
        loop();
      },
      stop: () => window.clearTimeout(id),
    };
  }
}

/**
 * Web Audio metronome engine with a lookahead scheduler.
 * UI code talks to it only through this class; it has no framework dependency.
 */
export class MetronomeEngine {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Per-run bus: disconnecting it silences clicks already scheduled when stopping. */
  private bus: GainNode | null = null;
  private seq: Sequencer | null = null;
  private ticker: Ticker | null = null;
  private visualQueue: BeatEvent[] = [];
  private raf = 0;
  private beatListeners = new Set<BeatListener>();
  private stateListeners = new Set<StateListener>();
  private scheduleListeners = new Set<ScheduleListener>();
  private readonly cfg: EngineConfig;
  private readonly stats = new JitterStats();
  private rhythm: RhythmSettings;
  private practice: PracticeSettings = DEFAULT_PRACTICE;
  private sessionStartMs: number | null = null;
  private sound: SoundId = 'blip';
  /** Forces a sound regardless of the user's choice (speaker-mode accuracy meter needs the tone). */
  private soundOverride: SoundId | null = null;
  private volume = 0.8;
  private hidden = false;

  constructor(rhythm: RhythmSettings, config: Partial<EngineConfig> = {}) {
    this.rhythm = rhythm;
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    if (typeof document !== 'undefined') {
      this.hidden = document.visibilityState === 'hidden';
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  get running(): boolean {
    return this.seq !== null;
  }

  get audioContext(): AudioContext | null {
    return this.ac;
  }

  /** Must be called from a user gesture the first time (autoplay policy). */
  async start(): Promise<void> {
    if (this.seq) return;
    const ac = this.ensureContext();
    if (ac.state !== 'running') await ac.resume();
    this.bus = ac.createGain();
    this.bus.connect(this.master!);
    this.stats.reset();
    this.visualQueue = [];
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.seq = new Sequencer(this.rhythm, ac.currentTime + 0.05, this.practice, seed);
    this.sessionStartMs = performance.now();
    this.ticker ??= createTicker(this.tick);
    this.ticker.start(this.cfg.intervalMs);
    // Announce before the first scheduling pass so listeners (e.g. the accuracy meter) see every event.
    this.stateListeners.forEach((l) => l(true));
    this.tick();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(reason: StopReason = 'user'): void {
    if (!this.seq) return;
    this.seq = null;
    this.ticker?.stop();
    cancelAnimationFrame(this.raf);
    this.visualQueue = [];
    const bus = this.bus;
    this.bus = null;
    if (bus && this.ac) {
      const t = this.ac.currentTime;
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0, t + 0.01);
      setTimeout(() => bus.disconnect(), 60);
    }
    this.stateListeners.forEach((l) => l(false, reason));
  }

  async toggle(): Promise<void> {
    if (this.running) this.stop();
    else await this.start();
  }

  /** Apply new rhythm settings. While running, tempo/subdivision changes land on the next beat. */
  setRhythm(rhythm: RhythmSettings): void {
    this.rhythm = rhythm;
    this.seq?.update(rhythm);
  }

  /** Apply practice-trainer settings. While running they take effect from the next beat. */
  setPractice(practice: PracticeSettings): void {
    this.practice = practice;
    this.seq?.updatePractice(practice);
  }

  /** performance.now() when the current/last session started (for the stopwatch). */
  get sessionStart(): number | null {
    return this.sessionStartMs;
  }

  setSound(sound: SoundId): void {
    this.sound = sound;
  }

  setSoundOverride(sound: SoundId | null): void {
    this.soundOverride = sound;
  }

  /** The sound actually played (override wins). */
  get effectiveSound(): SoundId {
    return this.soundOverride ?? this.sound;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master && this.ac) this.master.gain.setTargetAtTime(this.volume, this.ac.currentTime, 0.01);
  }

  /** Play a short accent-normal-normal preview of a sound. */
  async preview(sound: SoundId): Promise<void> {
    const ac = this.ensureContext();
    if (ac.state !== 'running') await ac.resume();
    if (this.running) return; // the running click already demonstrates it
    const t = ac.currentTime + 0.03;
    playClick(ac, this.master!, sound, 'accent', t);
    playClick(ac, this.master!, sound, 'normal', t + 0.25);
    playClick(ac, this.master!, sound, 'normal', t + 0.5);
  }

  onBeat(fn: BeatListener): () => void {
    this.beatListeners.add(fn);
    return () => this.beatListeners.delete(fn);
  }

  onSchedule(fn: ScheduleListener): () => void {
    this.scheduleListeners.add(fn);
    return () => this.scheduleListeners.delete(fn);
  }

  /** Master output node (testing aid: lets a self-test feed the clicks back into the meter). */
  get output(): AudioNode {
    this.ensureContext();
    return this.master!;
  }

  /** The shared AudioContext (created on first use). The mic analyser must use the same clock. */
  getContext(): AudioContext {
    return this.ensureContext();
  }

  /**
   * Play identical short clicks separated by `gaps` (s), for latency calibration.
   * Returns their scheduled AudioContext times. Only while stopped.
   */
  async playProbes(gaps: number[], sound: SoundId = 'tick', voices: ClickVoice[] = ['accent']): Promise<number[]> {
    const ac = this.ensureContext();
    if (ac.state !== 'running') await ac.resume();
    if (this.running) throw new Error('Stop the metronome before calibrating');
    const t0 = ac.currentTime + 0.3;
    const times = [t0];
    for (const g of gaps) times.push(times[times.length - 1] + g);
    times.forEach((t, i) => playClick(ac, this.master!, sound, voices[i % voices.length], t));
    return times;
  }

  onState(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  jitterReport(): JitterReport {
    return this.stats.report();
  }

  resetStats(): void {
    this.stats.reset();
  }

  dispose(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.ac?.close();
    this.ac = null;
  }

  private ensureContext(): AudioContext {
    if (!this.ac) {
      this.ac = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ac.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ac.destination);
    }
    return this.ac;
  }

  /** Scheduler: called every ~25 ms; schedules everything due within the lookahead window. */
  private tick = (): void => {
    const seq = this.seq;
    const ac = this.ac;
    if (!seq || !ac || !this.bus) return;
    if (!this.hidden) this.stats.tick(performance.now());
    const now = ac.currentTime;

    // Fell far behind (frozen tab, suspended context): skip silently rather than burst.
    let skipped = 0;
    while (seq.nextTime < now - this.cfg.maxLateness) {
      seq.next();
      skipped++;
    }
    if (skipped) this.stats.drop(skipped);

    const horizon = now + (this.hidden ? this.cfg.hiddenLookahead : this.cfg.lookahead);
    const batch = seq.scheduleUntil(horizon);
    if (batch.length) this.scheduleListeners.forEach((l) => l(batch));
    for (const ev of batch) {
      this.stats.event(ev.time - now);
      if (ev.voice) playClick(ac, this.bus, this.effectiveSound, ev.voice, Math.max(ev.time, now));
      if (!this.hidden) this.visualQueue.push(ev); // nobody is watching while hidden
    }
    // rAF can stall while the page still reports "visible" (e.g. an occluded window): bound the backlog.
    if (this.visualQueue.length > 512) this.visualQueue.splice(0, this.visualQueue.length - 512);

    // Playback counter ran out: stop once the last scheduled beat has finished.
    if (seq.done && now >= seq.endTime!) this.stop('finished');
  };

  /** Visual clock: emits each event when it becomes audible (accounting for output latency). */
  private frame = (): void => {
    const ac = this.ac;
    if (!this.seq || !ac) return;
    const latency = (ac.outputLatency || 0) + (ac.baseLatency || 0);
    const audibleNow = ac.currentTime - latency;
    let due: BeatEvent | undefined;
    const q = this.visualQueue;
    let i = 0;
    while (i < q.length && q[i].time <= audibleNow) {
      // Only emit the latest beat-level event per frame, plus every sub; skip stale backlog.
      const ev = q[i];
      if (audibleNow - ev.time < 0.15) {
        if (ev.sub === 0) due = ev;
        else this.beatListeners.forEach((l) => l(ev));
      }
      i++;
    }
    if (i) q.splice(0, i);
    if (due) {
      const d = due;
      this.beatListeners.forEach((l) => l(d));
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private onVisibility = (): void => {
    this.hidden = document.visibilityState === 'hidden';
    this.stats.pause();
    if (!this.hidden && this.running && this.ac?.state !== 'running') void this.ac?.resume();
  };
}
