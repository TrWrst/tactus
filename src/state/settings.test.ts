import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, STORAGE_KEY, loadSettings, sanitizeSettings, saveSettings } from './settings';

describe('settings', () => {
  it('falls back to defaults for garbage', () => {
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ bpm: 'fast', sound: 'airhorn', subdivision: 9 })).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps and rounds tempo', () => {
    expect(sanitizeSettings({ bpm: 999 }).bpm).toBe(300);
    expect(sanitizeSettings({ bpm: 3 }).bpm).toBe(20);
    expect(sanitizeSettings({ bpm: 99.6 }).bpm).toBe(100);
  });

  it('repairs an accent pattern of the wrong length', () => {
    const s = sanitizeSettings({ beatsPerBar: 6, beatUnit: 8, accents: ['accent', 'mute', 'bogus'] });
    expect(s.accents).toEqual(['accent', 'mute', 'soft', 'normal', 'soft', 'soft']);
  });

  it('round-trips through storage', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const s = { ...DEFAULT_SETTINGS, bpm: 142, theme: 'light' as const, accents: [...DEFAULT_SETTINGS.accents] };
    s.accents[2] = 'mute';
    saveSettings(s, storage);
    expect(mem.has(STORAGE_KEY)).toBe(true);
    expect(loadSettings(storage)).toEqual(s);
  });

  it('survives corrupt JSON and missing storage', () => {
    expect(loadSettings({ getItem: () => '{oops' })).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('practice settings', () => {
  it('validates stored trainer settings', () => {
    const s = sanitizeSettings({ practice: { muteMode: 'bars', playBars: 0, muteBars: 500, rampTarget: 999, rampEnd: 'loop' } });
    expect(s.practice).toMatchObject({ muteMode: 'bars', playBars: 1, muteBars: 64, rampTarget: 300, rampEnd: 'hold' });
  });
});

describe('accuracy meter settings', () => {
  it('defaults to off and uncalibrated', () => {
    expect(sanitizeSettings(null).meter).toEqual({ enabled: false, output: 'speaker', latencyMs: null, sensitivity: 5, deviceId: null });
  });
  it('validates stored values', () => {
    const s = sanitizeSettings({ meter: { enabled: true, output: 'radio', latencyMs: -400, sensitivity: 40, deviceId: '' } });
    expect(s.meter).toEqual({ enabled: true, output: 'speaker', latencyMs: -250, sensitivity: 10, deviceId: null });
  });
});
