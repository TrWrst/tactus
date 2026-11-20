import { describe, expect, it } from 'vitest';
import { LESSONS, isUnlocked, lessonById, lessonSeconds } from './curriculum';
import {
  buildWarmup, dayKey, edgeLesson, edgeNext, edgeStart, emptyProgress, levelOf, loadProgress, recordEdge,
  recordResult, saveProgress, weakestSkill, type Progress,
} from './progress';
import type { LessonResult } from './scorer';

const result = (o: Partial<LessonResult> = {}): LessonResult => ({
  lessonId: 'x', expected: 32, perfect: 20, great: 8, good: 2, off: 1, miss: 1, extra: 0, maxCombo: 20, score: 85,
  meanMs: 2, sdMs: 9, within20: 0.85, within35: 0.94, driftMsPerMin: 0, silentMeanAbsMs: null, audibleMeanAbsMs: 6,
  stars: 2, ignored: { outside: 0, bounce: 0, double: 0 }, durationSec: 24, points: [], ...o,
});
const day = (s: string) => new Date(`${s}T12:00:00`);

describe('curriculum', () => {
  it('has 5 stages of 6 lessons plus a test, with unique ids', () => {
    expect(LESSONS.length).toBe(35);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(35);
    for (let s = 1; s <= 5; s++) expect(LESSONS.filter((l) => l.stage === s && l.test).length).toBe(1);
  });

  it('keeps every lesson playable and reasonably short', () => {
    for (const l of LESSONS) {
      expect(l.bpm).toBeGreaterThanOrEqual(20);
      expect(l.bpm).toBeLessThanOrEqual(300);
      expect(lessonSeconds(l)).toBeLessThanOrEqual(185);
    }
  });

  it('unlocks in order: 1 star opens the next lesson, 2 stars on a test open the next stage', () => {
    const stars: Record<string, number> = {};
    const best = (id: string) => stars[id] ?? 0;
    expect(isUnlocked(lessonById('s1-1')!, best)).toBe(true);
    expect(isUnlocked(lessonById('s1-2')!, best)).toBe(false);
    stars['s1-1'] = 1;
    expect(isUnlocked(lessonById('s1-2')!, best)).toBe(true);
    expect(isUnlocked(lessonById('s2-1')!, best)).toBe(false);
    stars['s1-test'] = 1;
    expect(isUnlocked(lessonById('s2-1')!, best)).toBe(false);
    stars['s1-test'] = 2;
    expect(isUnlocked(lessonById('s2-1')!, best)).toBe(true);
  });
});

describe('recording results', () => {
  it('keeps best stars and spread, adds XP, history and a streak', () => {
    const l = lessonById('s1-1')!;
    let o = recordResult(emptyProgress(), l, result({ stars: 2, sdMs: 9 }), day('2026-11-20'));
    expect(o.progress.lessons['s1-1']).toMatchObject({ bestStars: 2, bestSdMs: 9, plays: 1 });
    expect(o.xpGained).toBe(Math.round(10 + 85 * 0.5 + 20 + 50));
    expect(o.improvedStars).toBe(true);
    expect(o.progress.streak).toEqual({ count: 1, lastDay: '2026-11-20' });
    o = recordResult(o.progress, l, result({ stars: 1, sdMs: 14 }), day('2026-11-20'));
    expect(o.progress.lessons['s1-1']).toMatchObject({ bestStars: 2, bestSdMs: 9, plays: 2 });
    expect(o.improvedStars).toBe(false);
    expect(o.progress.history.length).toBe(2);
  });

  it('counts consecutive days and resets after a gap', () => {
    const l = lessonById('s1-1')!;
    let p: Progress = emptyProgress();
    for (const d of ['2026-11-18', '2026-11-19', '2026-11-20']) p = recordResult(p, l, result(), day(d)).progress;
    expect(p.streak.count).toBe(3);
    p = recordResult(p, l, result(), day('2026-11-22')).progress;
    expect(p.streak.count).toBe(1);
  });

  it('handles month boundaries', () => {
    expect(dayKey(day('2026-12-01'))).toBe('2026-12-01');
    const l = lessonById('s1-1')!;
    let p = recordResult(emptyProgress(), l, result(), day('2026-11-30')).progress;
    p = recordResult(p, l, result(), day('2026-12-01')).progress;
    expect(p.streak.count).toBe(2);
  });

  it('awards badges once', () => {
    const l = lessonById('s5-2')!; // 40 BPM
    const o = recordResult(emptyProgress(), l, result({ stars: 1, sdMs: 12 }), day('2026-11-20'));
    expect(o.newBadges.map((b) => b.id).sort()).toEqual(['first-steps', 'slow-burn']);
    expect(recordResult(o.progress, l, result({ stars: 1, sdMs: 12 }), day('2026-11-20')).newBadges).toEqual([]);
  });

  it('does not record an empty run', () => {
    const o = recordResult(emptyProgress(), lessonById('s1-1')!, result({ perfect: 0, great: 0, good: 0, off: 0, stars: 0, score: 0 }), day('2026-11-20'));
    expect(o.progress.history).toEqual([]);
    expect(o.progress.streak.count).toBe(0);
  });
});

describe('levels', () => {
  it('needs 150, 450, 900 … XP', () => {
    expect([0, 149, 150, 449, 450, 900].map((x) => levelOf(x).level)).toEqual([1, 1, 2, 2, 3, 4]);
    expect(levelOf(200)).toEqual({ level: 2, into: 50, need: 300 });
  });
});

describe('warm-up', () => {
  it('targets the weakest skill', () => {
    let p = emptyProgress();
    p = recordResult(p, lessonById('s1-1')!, result({ sdMs: 6, stars: 3 }), day('2026-11-20')).progress;
    p = recordResult(p, lessonById('s1-5')!, result({ sdMs: 22, stars: 1 }), day('2026-11-20')).progress;
    expect(weakestSkill(p)).toBe('pulse');
    p = { ...p, history: [...p.history, { at: '', lessonId: 's3-1', skill: 'silence', bpm: 80, stars: 0, score: 40, sdMs: 30, meanMs: 0 }] };
    expect(weakestSkill(p)).toBe('silence');
  });

  it('builds three short rounds from unlocked material', () => {
    const w = buildWarmup(emptyProgress());
    expect(w.map((l) => l.id)).toEqual(['warmup-pulse', 'warmup-focus', 'warmup-gap']);
    expect(w[1].title).toContain('First pulse');
    expect(w.every((l) => l.bars <= 8)).toBe(true);
  });
});

describe('find your edge', () => {
  it('speeds up on a pass, slows down on a fail, and stops after 3 fails', () => {
    let s = edgeStart(emptyProgress(), 'sixteenths');
    expect(s.bpm).toBe(72);
    s = edgeNext(s, 2); // pass at 72
    s = edgeNext(s, 3); // pass at 76
    expect(s).toMatchObject({ bpm: 80, best: 76, fails: 0 });
    s = edgeNext(s, 1);
    s = edgeNext(s, 1);
    expect(s.done).toBe(false);
    s = edgeNext(s, 0);
    expect(s).toMatchObject({ done: true, best: 76, fails: 3 });
    expect(edgeLesson({ ...s, bpm: 100 })).toMatchObject({ bpm: 100, bars: 4, play: { per: 4 } });
  });

  it('starts near the previous best and keeps the record', () => {
    const p = recordEdge(emptyProgress(), { pattern: 'quarters', bpm: 0, best: 140, fails: 3, round: 9, done: true });
    expect(p.edge.quarters).toBe(140);
    expect(edgeStart(p, 'quarters').bpm).toBe(128);
    expect(recordEdge(p, { pattern: 'quarters', bpm: 0, best: 120, fails: 3, round: 5, done: true }).edge.quarters).toBe(140);
  });
});

describe('storage', () => {
  it('round-trips and survives garbage', () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const p = recordResult(emptyProgress(), lessonById('s1-1')!, result(), day('2026-11-20')).progress;
    saveProgress(p, st);
    expect(loadProgress(st)).toEqual(p);
    expect(loadProgress({ getItem: () => '{nope' })).toEqual(emptyProgress());
    expect(loadProgress({ getItem: () => '{"version":7}' })).toEqual(emptyProgress());
  });
});
