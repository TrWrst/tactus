import { clampBpm } from './rhythm';

/** Practice trainers. Pure functions + a seeded RNG so everything is unit-testable. */

export type MuteMode = 'off' | 'bars' | 'random';
export type RampUnit = 'bars' | 'seconds';
/** What happens when the tempo ramp reaches its target. */
export type RampEnd = 'hold' | 'reverse' | 'restart';
export type StopMode = 'off' | 'bars' | 'time';

export interface PracticeSettings {
  muteMode: MuteMode;
  /** Bars mode: play this many bars… */
  playBars: number;
  /** …then mute this many. */
  muteBars: number;
  /** Random mode: chance (0–100) that any given beat is silent. */
  randomPct: number;

  rampOn: boolean;
  /** BPM added (or removed, if target < start) per step. */
  rampStep: number;
  /** Step length, in bars or seconds. */
  rampEvery: number;
  rampUnit: RampUnit;
  rampTarget: number;
  rampEnd: RampEnd;

  stopMode: StopMode;
  stopBars: number;
  stopSeconds: number;
}

export const DEFAULT_PRACTICE: PracticeSettings = {
  muteMode: 'off',
  playBars: 2,
  muteBars: 2,
  randomPct: 25,
  rampOn: false,
  rampStep: 5,
  rampEvery: 4,
  rampUnit: 'bars',
  rampTarget: 140,
  rampEnd: 'hold',
  stopMode: 'off',
  stopBars: 16,
  stopSeconds: 300,
};

export const isPracticeActive = (p: PracticeSettings): boolean =>
  p.muteMode !== 'off' || p.rampOn || p.stopMode !== 'off';

/** Bars mode: bar index counted from the first bar after the count-in. */
export function isMutedBar(bar: number, playBars: number, muteBars: number): boolean {
  if (bar < 0 || muteBars <= 0) return false;
  const play = Math.max(1, playBars);
  return bar % (play + muteBars) >= play;
}

/** How many ramp steps have elapsed at a given bar / time. */
export function rampStepsElapsed(bar: number, elapsedSec: number, every: number, unit: RampUnit): number {
  if (every <= 0 || bar < 0) return 0;
  const units = unit === 'bars' ? bar : elapsedSec;
  return Math.max(0, Math.floor(units / every + 1e-9));
}

/**
 * Tempo after k ramp steps from `start` towards `target`.
 * hold: stay at target. restart: after one step at target, jump back to start.
 * reverse: ping-pong between start and target.
 */
export function rampBpm(start: number, target: number, step: number, k: number, end: RampEnd): number {
  const span = Math.abs(target - start);
  const size = Math.abs(step);
  if (span === 0 || size === 0 || k <= 0) return clampBpm(start);
  const dir = Math.sign(target - start);
  const stepsToTarget = Math.ceil(span / size);
  let pos: number;
  if (end === 'hold') pos = k;
  else if (end === 'restart') pos = k % (stepsToTarget + 1);
  else {
    const period = 2 * stepsToTarget;
    const p = k % period;
    pos = p <= stepsToTarget ? p : period - p;
  }
  return clampBpm(start + dir * Math.min(pos * size, span));
}

/** Has the playback counter finished? Checked at each beat boundary. */
export function stopReached(p: PracticeSettings, bar: number, elapsedSec: number): boolean {
  if (bar < 0) return false;
  if (p.stopMode === 'bars') return bar >= Math.max(1, p.stopBars);
  if (p.stopMode === 'time') return elapsedSec >= Math.max(1, p.stopSeconds) - 1e-9;
  return false;
}

/** Small, fast seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Is this beat silenced by the muting trainer? `rand` is only consumed in random mode. */
export function trainerMutesBeat(p: PracticeSettings, bar: number, rand: () => number): boolean {
  if (bar < 0) return false; // never during count-in
  if (p.muteMode === 'bars') return isMutedBar(bar, p.playBars, p.muteBars);
  if (p.muteMode === 'random') return rand() * 100 < p.randomPct;
  return false;
}

/** Format seconds as m:ss (or h:mm:ss). */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
