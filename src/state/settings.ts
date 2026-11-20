import { DEFAULT_PRACTICE, type PracticeSettings } from '../engine/practice';
import { defaultAccents, isValidAccent, resizeAccents } from '../engine/accents';
import { BEAT_UNITS, MAX_BEATS_PER_BAR, clampBpm, clampSwing } from '../engine/rhythm';
import { isSoundId } from '../engine/sounds';
import type { RhythmSettings, SoundId, Subdivision } from '../engine/types';

export type VisualMode = 'pulse' | 'dots' | 'flash';
export type Theme = 'system' | 'dark' | 'light';

export type MeterOutput = 'speaker' | 'headphones';

export interface MeterSettings {
  /** Listen through the mic and score timing while playing. */
  enabled: boolean;
  /**
   * 'speaker': the click plays out loud as a high tone and the mic listens only to
   * low/mid frequencies. 'headphones': wired headphones, normal sounds, full band.
   */
  output: MeterOutput;
  /** Calibrated output + input latency (ms); null until calibrated. */
  latencyMs: number | null;
  /** Onset detector sensitivity, 1–10. */
  sensitivity: number;
  /** Chosen microphone (null = system default). */
  deviceId: string | null;
}

export const DEFAULT_METER: MeterSettings = { enabled: false, output: 'speaker', latencyMs: null, sensitivity: 5, deviceId: null };

export interface AppSettings extends RhythmSettings {
  sound: SoundId;
  volume: number;
  visual: VisualMode;
  theme: Theme;
  haptics: boolean;
  practice: PracticeSettings;
  meter: MeterSettings;
}

export const STORAGE_KEY = 'tactus.settings.v1';

export const DEFAULT_SETTINGS: AppSettings = {
  bpm: 100,
  beatsPerBar: 4,
  beatUnit: 4,
  accents: defaultAccents(4, 4),
  subdivision: 1,
  swing: 0.5,
  countInBars: 0,
  sound: 'wood',
  volume: 0.8,
  visual: 'pulse',
  theme: 'system',
  haptics: false,
  practice: DEFAULT_PRACTICE,
  meter: DEFAULT_METER,
};

const oneOf = <T>(x: unknown, options: readonly T[], fallback: T): T =>
  options.includes(x as T) ? (x as T) : fallback;

/** Turn untrusted stored data into valid settings, field by field. */
export function sanitizeSettings(raw: unknown): AppSettings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== 'object') return { ...d, accents: [...d.accents], practice: { ...d.practice }, meter: { ...d.meter } };
  const r = raw as Record<string, unknown>;
  const num = (x: unknown, fb: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fb);

  const beatsPerBar = Math.min(MAX_BEATS_PER_BAR, Math.max(1, Math.round(num(r.beatsPerBar, d.beatsPerBar))));
  const beatUnit = oneOf(r.beatUnit, BEAT_UNITS as readonly number[], d.beatUnit);
  const storedAccents = Array.isArray(r.accents) ? r.accents.filter(isValidAccent) : [];
  return {
    bpm: clampBpm(num(r.bpm, d.bpm)),
    beatsPerBar,
    beatUnit,
    accents: storedAccents.length
      ? resizeAccents(storedAccents, beatsPerBar, beatUnit)
      : defaultAccents(beatsPerBar, beatUnit),
    subdivision: oneOf(r.subdivision, [1, 2, 3, 4, 5, 6, 7] as Subdivision[], d.subdivision),
    swing: clampSwing(num(r.swing, d.swing)),
    countInBars: oneOf(r.countInBars, [0, 1, 2] as const, d.countInBars),
    sound: isSoundId(r.sound) ? r.sound : d.sound,
    volume: Math.min(1, Math.max(0, num(r.volume, d.volume))),
    visual: oneOf(r.visual, ['pulse', 'dots', 'flash'] as const, d.visual),
    theme: oneOf(r.theme, ['system', 'dark', 'light'] as const, d.theme),
    haptics: typeof r.haptics === 'boolean' ? r.haptics : d.haptics,
    practice: sanitizePractice(r.practice),
    meter: sanitizeMeter(r.meter),
  };
}

export function sanitizeMeter(raw: unknown): MeterSettings {
  const d = DEFAULT_METER;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    output: oneOf(r.output, ['speaker', 'headphones'] as const, d.output),
    latencyMs:
      typeof r.latencyMs === 'number' && Number.isFinite(r.latencyMs) ? Math.min(500, Math.max(-250, r.latencyMs)) : null,
    sensitivity: intIn(r.sensitivity, 1, 10, d.sensitivity),
    deviceId: typeof r.deviceId === 'string' && r.deviceId ? r.deviceId : null,
  };
}

const intIn = (x: unknown, min: number, max: number, fb: number) =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : fb;

export function sanitizePractice(raw: unknown): PracticeSettings {
  const d = DEFAULT_PRACTICE;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    muteMode: oneOf(r.muteMode, ['off', 'bars', 'random'] as const, d.muteMode),
    playBars: intIn(r.playBars, 1, 64, d.playBars),
    muteBars: intIn(r.muteBars, 1, 64, d.muteBars),
    randomPct: intIn(r.randomPct, 5, 95, d.randomPct),
    rampOn: typeof r.rampOn === 'boolean' ? r.rampOn : d.rampOn,
    rampStep: intIn(r.rampStep, 1, 50, d.rampStep),
    rampEvery: intIn(r.rampEvery, 1, 600, d.rampEvery),
    rampUnit: oneOf(r.rampUnit, ['bars', 'seconds'] as const, d.rampUnit),
    rampTarget: clampBpm(typeof r.rampTarget === 'number' ? r.rampTarget : d.rampTarget),
    rampEnd: oneOf(r.rampEnd, ['hold', 'reverse', 'restart'] as const, d.rampEnd),
    stopMode: oneOf(r.stopMode, ['off', 'bars', 'time'] as const, d.stopMode),
    stopBars: intIn(r.stopBars, 1, 999, d.stopBars),
    stopSeconds: intIn(r.stopSeconds, 5, 7200, d.stopSeconds),
  };
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): AppSettings {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeSettings(null);
  }
}

export function saveSettings(s: AppSettings, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota: settings just won't persist */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

export const meterLabel = (s: Pick<RhythmSettings, 'beatsPerBar' | 'beatUnit'>) => `${s.beatsPerBar}/${s.beatUnit}`;
