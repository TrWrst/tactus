import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRACTICE, type PracticeSettings, formatDuration, isMutedBar, rampBpm, rampStepsElapsed,
  seededRandom, stopReached, trainerMutesBeat,
} from './practice';
import { Sequencer } from './sequencer';
import type { BeatEvent, RhythmSettings } from './types';

const P = (o: Partial<PracticeSettings>): PracticeSettings => ({ ...DEFAULT_PRACTICE, ...o });
const R: RhythmSettings = {
  bpm: 120, beatsPerBar: 4, beatUnit: 4, accents: ['accent', 'normal', 'normal', 'normal'],
  subdivision: 1, swing: 0.5, countInBars: 0,
};
const run = (p: Partial<PracticeSettings>, r: Partial<RhythmSettings> = {}, n = 64, seed = 7) => {
  const s = new Sequencer({ ...R, ...r }, 0, P(p), seed);
  const out: BeatEvent[] = [];
  for (let i = 0; i < n && !s.done; i++) out.push(s.next());
  return { s, out };
};
const perBar = (evs: BeatEvent[], f: (e: BeatEvent) => unknown) => {
  const m = new Map<number, unknown[]>();
  evs.forEach((e) => m.set(e.bar, [...(m.get(e.bar) ?? []), f(e)]));
  return [...m.values()];
};

describe('muted bars', () => {
  it('plays N then mutes M, repeating', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((b) => isMutedBar(b, 2, 1))).toEqual([false, false, true, false, false, true, false]);
  });
  it('never mutes when muteBars is 0 or during count-in', () => {
    expect(isMutedBar(5, 2, 0)).toBe(false);
    expect(isMutedBar(-1, 1, 1)).toBe(false);
  });
  it('silences whole bars in the sequencer, subdivisions included, but keeps time', () => {
    const { out } = run({ muteMode: 'bars', playBars: 1, muteBars: 1 }, { subdivision: 2 }, 32);
    const bars = perBar(out, (e) => e.voice === null);
    expect(bars.map((b) => b.every(Boolean))).toEqual([false, true, false, true]);
    expect(out.every((e) => e.trainerMuted === (e.bar % 2 === 1))).toBe(true);
    expect(out[8].time).toBeCloseTo(2); // bar 1 still starts on time
  });
  it('never mutes the count-in', () => {
    const { out } = run({ muteMode: 'bars', playBars: 1, muteBars: 1 }, { countInBars: 2 }, 16);
    expect(out.filter((e) => e.isCountIn).every((e) => e.voice !== null)).toBe(true);
  });
});

describe('random muted beats', () => {
  it('mutes roughly the chosen percentage', () => {
    const rand = seededRandom(42);
    const p = P({ muteMode: 'random', randomPct: 30 });
    let muted = 0;
    for (let i = 0; i < 20_000; i++) if (trainerMutesBeat(p, 1, rand)) muted++;
    expect(muted / 20_000).toBeGreaterThan(0.28);
    expect(muted / 20_000).toBeLessThan(0.32);
  });
  it('mutes a whole beat (all its subdivisions) together', () => {
    const { out } = run({ muteMode: 'random', randomPct: 50 }, { subdivision: 3 }, 300);
    for (let i = 0; i + 2 < out.length; i += 3) {
      expect(new Set(out.slice(i, i + 3).map((e) => e.trainerMuted)).size).toBe(1);
    }
    expect(out.some((e) => e.trainerMuted)).toBe(true);
  });
  it('is reproducible for a given seed', () => {
    const a = run({ muteMode: 'random', randomPct: 40 }, {}, 100, 9).out.map((e) => e.trainerMuted);
    const b = run({ muteMode: 'random', randomPct: 40 }, {}, 100, 9).out.map((e) => e.trainerMuted);
    expect(a).toEqual(b);
  });
});

describe('accelerando', () => {
  it('counts steps per bars or seconds', () => {
    expect(rampStepsElapsed(7, 0, 4, 'bars')).toBe(1);
    expect(rampStepsElapsed(8, 0, 4, 'bars')).toBe(2);
    expect(rampStepsElapsed(3, 29.999, 10, 'seconds')).toBe(2);
    expect(rampStepsElapsed(3, 30, 10, 'seconds')).toBe(3);
    expect(rampStepsElapsed(-1, 99, 1, 'bars')).toBe(0);
  });
  it('holds at the target', () => {
    expect([0, 1, 2, 3, 4, 10].map((k) => rampBpm(100, 112, 5, k, 'hold'))).toEqual([100, 105, 110, 112, 112, 112]);
  });
  it('restarts from the start tempo after reaching the target', () => {
    expect([0, 1, 2, 3, 4, 5].map((k) => rampBpm(100, 110, 5, k, 'restart'))).toEqual([100, 105, 110, 100, 105, 110]);
  });
  it('reverses back down (ping-pong)', () => {
    expect([0, 1, 2, 3, 4, 5].map((k) => rampBpm(100, 110, 5, k, 'reverse'))).toEqual([100, 105, 110, 105, 100, 105]);
  });
  it('slows down when the target is below the start', () => {
    expect([0, 1, 2, 3].map((k) => rampBpm(100, 90, 4, k, 'hold'))).toEqual([100, 96, 92, 90]);
  });
  it('clamps to 20–300', () => {
    expect(rampBpm(290, 400, 50, 3, 'hold')).toBe(300);
  });
  it('raises tempo at bar boundaries in the sequencer', () => {
    const { out } = run({ rampOn: true, rampStep: 10, rampEvery: 2, rampUnit: 'bars', rampTarget: 200 }, {}, 24);
    expect(perBar(out, (e) => e.bpm).map((b) => b[0])).toEqual([120, 120, 130, 130, 140, 140]);
    // Bar 2 starts after two bars of 120 BPM (4 s); bar 4 after two more at 130.
    expect(out[8].time).toBeCloseTo(4);
    expect(out[16].time).toBeCloseTo(4 + 8 * (60 / 130));
  });
  it('ramps by elapsed seconds, applied on the next beat', () => {
    const { out } = run({ rampOn: true, rampStep: 60, rampEvery: 2, rampUnit: 'seconds', rampTarget: 240 }, { bpm: 60 }, 6);
    expect(out.map((e) => e.bpm)).toEqual([60, 60, 120, 120, 120, 120]);
    expect(out.map((e) => e.time)).toEqual([0, 1, 2, 2.5, 3, 3.5]);
  });
  it('counts seconds from the end of the count-in', () => {
    const { out } = run({ rampOn: true, rampStep: 60, rampEvery: 1, rampUnit: 'seconds', rampTarget: 120 }, { bpm: 60, countInBars: 1 }, 6);
    expect(out.map((e) => e.bpm)).toEqual([60, 60, 60, 60, 60, 120]);
  });
});

describe('playback counter', () => {
  it('stops after N bars', () => {
    const { s, out } = run({ stopMode: 'bars', stopBars: 3 }, {}, 100);
    expect(out.length).toBe(12);
    expect(s.done).toBe(true);
    expect(s.endTime).toBeCloseTo(6);
    expect(s.scheduleUntil(1e9)).toEqual([]);
  });
  it('stops at the first beat at or after the duration', () => {
    const { s, out } = run({ stopMode: 'time', stopSeconds: 5 }, { bpm: 90 }, 100); // beat = 0.667 s
    expect(out.length).toBe(8); // beats at 0 … 4.67; beat 8 would start at 5.33 ≥ 5
    expect(s.endTime).toBeCloseTo(8 * (60 / 90));
  });
  it('does not count the count-in', () => {
    const { out } = run({ stopMode: 'bars', stopBars: 1 }, { countInBars: 2 }, 100);
    expect(out.length).toBe(12);
  });
  it('helper ignores count-in bars', () => {
    expect(stopReached(P({ stopMode: 'bars', stopBars: 1 }), -1, 100)).toBe(false);
  });
});

describe('formatDuration', () => {
  it.each([[0, '0:00'], [59.9, '0:59'], [61, '1:01'], [3725, '1:02:05']])('%s → %s', (s, f) => {
    expect(formatDuration(s)).toBe(f);
  });
});
