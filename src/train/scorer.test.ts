import { describe, expect, it } from 'vitest';
import { DEFAULT_PRACTICE } from '../engine/practice';
import { Sequencer } from '../engine/sequencer';
import type { BeatEvent } from '../engine/types';
import { accentsFromCode, lessonById, type Lesson } from './curriculum';
import { LessonScorer, judge, starsFor } from './scorer';

/** Run a lesson's click through the real sequencer, like the app does. */
function beatsFor(l: Lesson, countIn = 0): BeatEvent[] {
  const seq = new Sequencer(
    {
      bpm: l.bpm,
      beatsPerBar: l.beatsPerBar,
      beatUnit: 4,
      accents: accentsFromCode(l.click.accents, l.beatsPerBar),
      subdivision: l.click.sub,
      swing: 0.5,
      countInBars: countIn as 0,
    },
    0,
    { ...DEFAULT_PRACTICE, ...l.practice, stopMode: 'bars', stopBars: l.bars },
    5,
  );
  return seq.scheduleUntil(1e6);
}

const scorerFor = (id: string, countIn = 0) => {
  const l = lessonById(id)!;
  const s = new LessonScorer(l);
  s.addBeats(beatsFor(l, countIn));
  return s;
};

describe('judgments', () => {
  it('uses ±10 / ±20 / ±35 ms windows', () => {
    expect([0, 10, 10.5, 20, 21, 35, 36].map(judge)).toEqual(['perfect', 'perfect', 'great', 'great', 'good', 'good', 'off']);
  });
});

describe('expected notes', () => {
  it('creates one note per beat for quarter-note lessons, skipping the count-in', () => {
    const s = scorerFor('s1-1', 1);
    expect(s.notes.length).toBe(32);
    expect(s.notes[0].time).toBeCloseTo(4 * 0.75); // after one bar of 80 BPM
  });

  it('creates 16ths from quarter-note clicks', () => {
    const s = scorerFor('s2-5');
    expect(s.notes.length).toBe(8 * 4 * 4);
    expect(s.notes[1].time - s.notes[0].time).toBeCloseTo(60 / 80 / 4);
  });

  it('alternates 8ths and triplets bar by bar', () => {
    const s = scorerFor('s2-4');
    expect(s.notes.filter((n) => n.bar === 0).length).toBe(8);
    expect(s.notes.filter((n) => n.bar === 1).length).toBe(12);
  });

  it('shifts notes onto the "and" for the off-beat lesson', () => {
    const s = scorerFor('s5-5');
    expect(s.notes[0].time).toBeCloseTo(0.5 * (60 / 90));
  });

  it('marks notes in gap-click silences as not audible', () => {
    const s = scorerFor('s3-1');
    expect(s.notes.filter((n) => n.bar === 3).every((n) => !n.audible)).toBe(true);
    expect(s.notes.filter((n) => n.bar === 0).every((n) => n.audible)).toBe(true);
  });

  it('follows the tempo ramp', () => {
    const s = scorerFor('s5-4');
    const bar0 = s.notes.filter((n) => n.bar === 0);
    const bar20 = s.notes.filter((n) => n.bar === 20);
    expect(bar0[1].time - bar0[0].time).toBeCloseTo(60 / 80);
    expect(bar20[1].time - bar20[0].time).toBeCloseTo(60 / 120);
  });
});

describe('scoring', () => {
  it('judges hits, builds combos, and counts misses and extras', () => {
    const s = scorerFor('s1-1'); // 32 quarter notes, 0.75 s apart
    const t = (i: number) => s.notes[i].time;
    expect(s.addHit(t(0) + 0.004)).toMatchObject({ judgment: 'perfect', combo: 1 });
    expect(s.addHit(t(1) - 0.015)).toMatchObject({ judgment: 'great', combo: 2 });
    expect(s.addHit(t(2) + 0.03)).toMatchObject({ judgment: 'good', combo: 3 });
    expect(s.addHit(t(3) + 0.06)).toMatchObject({ judgment: 'off', combo: 0 });
    expect(s.addHit(t(3) + 0.375)!.judgment).toBe('extra'); // halfway between notes
    expect(s.advance(t(5) + 0.2)).toBe(2); // notes 4 and 5 passed without a hit
    const r = s.finish();
    expect(r).toMatchObject({ expected: 32, perfect: 1, great: 1, good: 1, off: 1, extra: 1, miss: 28, maxCombo: 3, stars: 0 });
    expect(r.ignored).toEqual({ outside: 0, bounce: 0, double: 0 });
  });

  it('gives three stars to tight, complete playing', () => {
    const s = scorerFor('s1-1');
    s.notes.forEach((n, i) => s.addHit(n.time + (i % 2 ? 0.004 : -0.003)));
    const r = s.finish();
    expect(r.stars).toBe(3);
    expect(r.maxCombo).toBe(32);
    expect(r.score).toBe(100);
    expect(r.sdMs).toBeCloseTo(3.5);
  });

  it('measures silent-beat accuracy separately', () => {
    const s = scorerFor('s3-1');
    s.notes.forEach((n) => s.addHit(n.time + (n.audible ? 0.005 : 0.025)));
    const r = s.finish();
    expect(r.audibleMeanAbsMs).toBeCloseTo(5);
    expect(r.silentMeanAbsMs).toBeCloseTo(25);
  });

  it('never matches a hit to an already judged note', () => {
    const s = scorerFor('s1-1');
    s.addHit(s.notes[0].time);
    s.addHit(s.notes[0].time + 0.07); // later, same loudness: a double, not scored
    expect(s.notes[0].hit).toBeCloseTo(0);
    expect(s.notes[1].judged).toBeUndefined();
  });
});

describe('sounds that are not extra hits', () => {
  it('ignores taps during the count-in and after the last note', () => {
    const s = scorerFor('s1-1', 1);
    expect(s.addHit(0.75)).toBeNull(); // count-in beat 2
    expect(s.addHit(s.notes[0].time - 0.3)).toBeNull();
    expect(s.addHit(s.notes[s.notes.length - 1].time + 0.5)).toBeNull();
    const r = s.finish();
    expect(r.extra).toBe(0);
    expect(r.ignored.outside).toBe(3);
  });

  it('ignores a quieter rebound right after a hit, even between notes of fast 16ths', () => {
    const s = scorerFor('s5-3'); // 16ths at 120: notes 125 ms apart, windows ±56 ms
    const t0 = s.notes[0].time;
    expect(s.addHit(t0, 0.5)!.judgment).toBe('perfect');
    expect(s.addHit(t0 + 0.058, 0.2)).toBeNull(); // rebound: soft, 58 ms later (outside both windows)
    expect(s.addHit(s.notes[1].time + 0.003, 0.5)!.judgment).toBe('perfect');
    const r = s.finish();
    expect(r.extra).toBe(0);
    expect(r.ignored.bounce).toBe(1);
  });

  it('does not count a quieter second sound on a scored note', () => {
    const s = scorerFor('s1-1');
    s.addHit(s.notes[0].time + 0.002, 0.5);
    expect(s.addHit(s.notes[0].time + 0.09, 0.4)).toBeNull(); // echo/rattle 90 ms later
    expect(s.finish()).toMatchObject({ extra: 0, ignored: { double: 1 } });
  });

  it('lets a clearly louder stroke replace a faint ghost (click leak) on the same note', () => {
    const s = scorerFor('s1-1');
    const t0 = s.notes[0].time;
    expect(s.addHit(t0, 0.02)!.judgment).toBe('perfect'); // faint leak exactly on the click
    const fb = s.addHit(t0 + 0.028, 0.5)!; // the real stroke, 28 ms late
    expect(fb).toMatchObject({ judgment: 'good' });
    expect(s.notes[0].hit).toBeCloseTo(28);
    expect(s.finish().extra).toBe(0);
  });

  it('counts a hit between notes as extra even before the next note is scheduled', () => {
    const l = lessonById('s1-1')!;
    const beats = beatsFor(l);
    const s = new LessonScorer(l);
    s.addBeats(beats.slice(0, 1)); // the scheduler only knows the first beat yet
    s.addHit(beats[0].time, 0.5);
    expect(s.addHit(beats[0].time + 0.375, 0.5)!.judgment).toBe('extra');
    s.addBeats(beats.slice(1));
    expect(s.addHit(s.notes[s.notes.length - 1].time + 0.5, 0.5)).toBeNull(); // after the final note
    expect(s.finish()).toMatchObject({ extra: 1, ignored: { outside: 1 } });
  });

  it('still counts hits truly between notes as extra', () => {
    const s = scorerFor('s1-1');
    s.addHit(s.notes[0].time, 0.5);
    expect(s.addHit(s.notes[0].time + 0.375, 0.5)!.judgment).toBe('extra');
  });
});

describe('stars', () => {
  const r = (within35: number, within20: number, sdMs: number) => ({ within35, within20, sdMs, perfect: 10, great: 0, good: 0, off: 0 });
  it('follows the rules', () => {
    expect(starsFor(r(0.69, 0.69, 5))).toBe(0);
    expect(starsFor(r(0.7, 0.5, 20))).toBe(1);
    expect(starsFor(r(0.9, 0.8, 12))).toBe(2);
    expect(starsFor(r(0.95, 0.85, 6))).toBe(2);
    expect(starsFor(r(0.95, 0.92, 7.9))).toBe(3);
  });
  it('needs at least 4 hits', () => {
    expect(starsFor({ within35: 1, within20: 1, sdMs: 0, perfect: 3, great: 0, good: 0, off: 0 })).toBe(0);
  });
});
