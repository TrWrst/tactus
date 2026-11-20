import { describe, expect, it } from 'vitest';
import { Sequencer } from './sequencer';
import { subdivisionOffsets } from './rhythm';
import type { RhythmSettings } from './types';

const base: RhythmSettings = {
  bpm: 120, beatsPerBar: 4, beatUnit: 4,
  accents: ['accent', 'normal', 'normal', 'normal'],
  subdivision: 1, swing: 0.5, countInBars: 0,
};
const mk = (o: Partial<RhythmSettings> = {}, start = 0) => new Sequencer({ ...base, ...o }, start);
const take = (s: Sequencer, n: number) => Array.from({ length: n }, () => s.next());

describe('Sequencer beat math', () => {
  it('spaces quarter notes at 60/bpm and wraps bars', () => {
    const ev = take(mk(), 9);
    expect(ev.map((e) => e.time)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
    expect(ev.map((e) => e.beat)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0]);
    expect(ev.map((e) => e.bar)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2]);
  });

  it('honours the start time offset', () => {
    expect(take(mk({}, 10.25), 2).map((e) => e.time)).toEqual([10.25, 10.75]);
  });

  it.each([2, 3, 4, 5, 6, 7])('places %i subdivisions evenly inside the beat', (n) => {
    const ev = take(mk({ subdivision: n as 2 }), n + 1);
    ev.slice(0, n).forEach((e, i) => {
      expect(e.sub).toBe(i);
      expect(e.time).toBeCloseTo((0.5 * i) / n, 12);
    });
    expect(ev[n]).toMatchObject({ beat: 1, sub: 0 });
    expect(ev[n].time).toBeCloseTo(0.5, 12);
  });

  it('uses the sub voice for subdivisions and the accent level on the beat', () => {
    const ev = take(mk({ subdivision: 2 }), 4);
    expect(ev.map((e) => e.voice)).toEqual(['accent', 'sub', 'normal', 'sub']);
  });

  it('silences every click of a muted beat', () => {
    const ev = take(mk({ subdivision: 3, accents: ['accent', 'mute', 'soft', 'normal'] }), 9);
    expect(ev.slice(3, 6).map((e) => e.voice)).toEqual([null, null, null]);
    expect(ev[6].voice).toBe('soft');
  });

  it('does not drift over long runs', () => {
    const s = mk({ bpm: 137 });
    let last = 0;
    for (let i = 0; i < 100_000; i++) last = s.next().time;
    expect(last).toBeCloseTo(99_999 * (60 / 137), 6);
  });

  it('applies a tempo change from the next beat, never mid-beat', () => {
    const s = mk({ subdivision: 2 });
    s.next(); // beat 0 sub 0 at 0
    s.update({ ...base, subdivision: 2, bpm: 60 });
    const sub = s.next(); // still beat 0 at old tempo
    expect(sub.time).toBeCloseTo(0.25);
    const b1 = s.next();
    expect(b1.time).toBeCloseTo(0.5);
    expect(s.next().time).toBeCloseTo(1.0); // beat 1's eighth at 60 BPM
    expect(s.next().time).toBeCloseTo(1.5);
    expect(b1.bpm).toBe(60);
  });

  it('scheduleUntil returns events strictly before the horizon', () => {
    const s = mk();
    expect(s.scheduleUntil(1).map((e) => e.time)).toEqual([0, 0.5]);
    expect(s.scheduleUntil(1.5001).map((e) => e.time)).toEqual([1, 1.5]);
    expect(s.scheduleUntil(1.2)).toEqual([]);
  });

  it('plays count-in bars on beats only, then the pattern', () => {
    const ev = take(mk({ countInBars: 2, subdivision: 2, beatsPerBar: 3, accents: ['accent', 'normal', 'mute'] }), 8);
    expect(ev.slice(0, 6).map((e) => [e.bar, e.beat, e.sub, e.isCountIn])).toEqual([
      [-2, 0, 0, true], [-2, 1, 0, true], [-2, 2, 0, true],
      [-1, 0, 0, true], [-1, 1, 0, true], [-1, 2, 0, true],
    ]);
    // Muted beats still count in, so the player hears every beat.
    expect(ev[2].voice).toBe('countIn');
    expect(ev[3].voice).toBe('countInAccent');
    expect(ev[6]).toMatchObject({ bar: 0, beat: 0, sub: 0, isCountIn: false, voice: 'accent' });
    expect(ev[6].time).toBeCloseTo(3);
    expect(ev[7]).toMatchObject({ sub: 1, voice: 'sub' });
  });

  it('wraps immediately when the bar gets shorter mid-bar', () => {
    const s = mk();
    take(s, 3); // beats 0,1,2 → next is beat 3
    s.update({ ...base, beatsPerBar: 2, accents: ['accent', 'normal'] });
    const ev = take(s, 2);
    expect(ev.map((e) => [e.bar, e.beat])).toEqual([[1, 0], [1, 1]]);
    expect(ev[0].time).toBeCloseTo(1.5);
  });
});

describe('swing', () => {
  it('is straight at 0.5', () => {
    expect(subdivisionOffsets(2, 0.5)).toEqual([0, 0.5]);
  });
  it('moves off-beat eighths to the ratio', () => {
    expect(subdivisionOffsets(2, 2 / 3)[1]).toBeCloseTo(2 / 3);
  });
  it('swings sixteenths in pairs', () => {
    const o = subdivisionOffsets(4, 0.75);
    expect(o).toEqual([0, 0.375, 0.5, 0.875]);
  });
  it('is ignored for odd groupings', () => {
    expect(subdivisionOffsets(3, 0.75)).toEqual([0, 1 / 3, 2 / 3]);
  });
  it('is clamped to 0.5–0.75', () => {
    expect(subdivisionOffsets(2, 0.95)[1]).toBe(0.75);
    expect(subdivisionOffsets(2, 0.1)[1]).toBe(0.5);
  });
  it('produces swung times in the sequencer', () => {
    const ev = take(mk({ subdivision: 2, swing: 2 / 3 }), 3);
    expect(ev[1].time).toBeCloseTo(1 / 3);
    expect(ev[2].time).toBeCloseTo(0.5);
  });
});
