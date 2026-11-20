import type { BeatEvent } from '../engine/types';
import { notesPerBeat, type Lesson } from './curriculum';

/**
 * Lesson scoring, rhythm-game style. Pure: the runner feeds it scheduled beats,
 * latency-corrected hit times and the current time.
 */

export type Judgment = 'perfect' | 'great' | 'good' | 'off' | 'miss' | 'extra';

/** Judgment windows (ms, absolute offset). Beyond GOOD but inside the note's window = "off". */
export const WINDOWS = { perfect: 10, great: 20, good: 35 } as const;

export interface ExpectedNote {
  time: number;
  bar: number;
  /** Position within the bar (0-based note index). */
  pos: number;
  /** Was the click sounding on this beat? (false in gap-click silences) */
  audible: boolean;
  /** Matching window, seconds. */
  window: number;
  hit?: number; // offset ms once matched
  /** Loudness of the hit that was scored for this note (to prefer the real stroke over a ghost). */
  peak?: number;
  judged?: Judgment;
}

/** Sounds that are not scored at all (and are not "extra"). */
export interface IgnoredHits {
  /** Before the first note (count-in) or after the last one. */
  outside: number;
  /** A quieter sound right after a hit: stick rebound, echo, rattle. */
  bounce: number;
  /** A second sound on a note that was already scored, quieter than the first. */
  double: number;
}

/** A quieter sound this soon after the previous one is treated as a rebound/echo. */
export const BOUNCE_SEC = 0.06;
export const BOUNCE_RATIO = 0.6;
/** A later sound on an already scored note replaces it only if this much louder (real stroke after a ghost). */
export const REPLACE_RATIO = 1.5;

export interface HitFeedback {
  judgment: Judgment;
  offsetMs: number | null;
  combo: number;
}

export interface LessonResult {
  lessonId: string;
  expected: number;
  perfect: number;
  great: number;
  good: number;
  off: number;
  miss: number;
  extra: number;
  maxCombo: number;
  /** Weighted score 0–100. */
  score: number;
  meanMs: number;
  sdMs: number;
  /** Share of expected notes hit within ±20 / ±35 ms. */
  within20: number;
  within35: number;
  driftMsPerMin: number;
  /** Mean absolute offset on notes without / with the click (null when none). */
  silentMeanAbsMs: number | null;
  audibleMeanAbsMs: number | null;
  stars: 0 | 1 | 2 | 3;
  /** Sounds that were not scored (count-in taps, rebounds, doubles). */
  ignored: IgnoredHits;
  durationSec: number;
  /** For charts: seconds since the first note, offset ms. */
  points: { t: number; ms: number; audible: boolean }[];
}

export const judge = (absMs: number): Judgment =>
  absMs <= WINDOWS.perfect ? 'perfect' : absMs <= WINDOWS.great ? 'great' : absMs <= WINDOWS.good ? 'good' : 'off';

const WEIGHT: Record<Judgment, number> = { perfect: 1, great: 0.8, good: 0.5, off: 0.2, miss: 0, extra: 0 };

/** Star rules: ★ 70% within ±35 ms · ★★ plus spread ≤ 15 ms · ★★★ spread ≤ 8 ms and 90% within ±20 ms. */
export function starsFor(r: Pick<LessonResult, 'within35' | 'within20' | 'sdMs' | 'perfect' | 'great' | 'good' | 'off'>): 0 | 1 | 2 | 3 {
  const matched = r.perfect + r.great + r.good + r.off;
  if (matched < 4 || r.within35 < 0.7) return 0;
  if (r.sdMs > 15) return 1;
  if (r.sdMs > 8 || r.within20 < 0.9) return 2;
  return 3;
}

export class LessonScorer {
  readonly notes: ExpectedNote[] = [];
  private combo = 0;
  private maxCombo = 0;
  private extras = 0;
  private lastHit: { t: number; peak: number } | null = null;
  /** True once the lesson's final beat has been scheduled (notes are only known ~100 ms ahead). */
  private complete = false;
  readonly ignored: IgnoredHits = { outside: 0, bounce: 0, double: 0 };

  constructor(readonly lesson: Lesson) {}

  /** Turn scheduled beats into the notes the player should play. */
  addBeats(events: BeatEvent[]): void {
    const l = this.lesson;
    for (const ev of events) {
      if (ev.isCountIn || ev.sub !== 0) continue;
      if (ev.bar === l.bars - 1 && ev.beat === l.beatsPerBar - 1) this.complete = true;
      const per = notesPerBeat(l, ev.bar);
      const beatDur = 60 / ev.bpm;
      const window = Math.min(0.15, 0.45 * (beatDur / per));
      for (let k = 0; k < per; k++) {
        const pos = ev.beat * per + k;
        if (l.play.mask && l.play.mask[pos % l.play.mask.length] === '.') continue;
        this.notes.push({
          time: ev.time + (k / per + (l.play.offset ?? 0)) * beatDur,
          bar: ev.bar,
          pos,
          audible: ev.voice !== null,
          window,
        });
      }
    }
  }

  /**
   * Score a sound at latency-corrected time t with loudness `peak`. Returns null when
   * the sound is deliberately not scored (count-in, after the end, rebound, double).
   * Only sounds outside every note's window count as "extra".
   */
  addHit(t: number, peak = 1): HitFeedback | null {
    const first = this.notes[0];
    const last = this.notes[this.notes.length - 1];
    if (!first || t < first.time - first.window || (this.complete && t > last.time + last.window)) {
      this.ignored.outside++;
      return null;
    }
    const prev = this.lastHit;
    if (prev && t - prev.t < BOUNCE_SEC && peak < prev.peak * BOUNCE_RATIO) {
      this.ignored.bounce++;
      return null;
    }
    this.lastHit = { t, peak };

    let open: ExpectedNote | null = null;
    let scored: ExpectedNote | null = null;
    for (const n of this.notes) {
      const d = Math.abs(t - n.time);
      if (d > n.window) continue;
      if (n.judged === undefined) {
        if (!open || d < Math.abs(t - open.time)) open = n;
      } else if (n.hit !== undefined && (!scored || d < Math.abs(t - scored.time))) scored = n;
    }

    if (open) return this.score(open, t, peak);
    if (scored) {
      // A clearly louder sound on a note that's already scored is the real stroke (the first
      // one was a ghost: click leak, grace note); otherwise it's a double we don't count.
      if (peak > (scored.peak ?? 0) * REPLACE_RATIO) return this.score(scored, t, peak, true);
      this.ignored.double++;
      return null;
    }
    this.extras++;
    this.combo = 0;
    return { judgment: 'extra', offsetMs: null, combo: 0 };
  }

  private score(n: ExpectedNote, t: number, peak: number, replacing = false): HitFeedback {
    const ms = (t - n.time) * 1000;
    const j = judge(Math.abs(ms));
    const was = n.judged;
    n.hit = ms;
    n.peak = peak;
    n.judged = j;
    if (replacing) {
      // Keep the combo honest: only a change between "off" and good-or-better affects it.
      if (was === 'off' && j !== 'off') this.maxCombo = Math.max(this.maxCombo, ++this.combo);
      else if (was !== 'off' && j === 'off') this.combo = 0;
    } else if (j === 'off') this.combo = 0;
    else this.maxCombo = Math.max(this.maxCombo, ++this.combo);
    return { judgment: j, offsetMs: ms, combo: this.combo };
  }

  /** Mark notes whose window ended before `t` as missed. Returns how many were newly missed. */
  advance(t: number): number {
    let n = 0;
    for (const note of this.notes) {
      if (!note.judged && note.time + note.window < t) {
        note.judged = 'miss';
        n++;
      }
    }
    if (n) this.combo = 0;
    return n;
  }

  get liveCombo(): number {
    return this.combo;
  }

  counts(): Record<Judgment, number> {
    const c: Record<Judgment, number> = { perfect: 0, great: 0, good: 0, off: 0, miss: 0, extra: this.extras };
    for (const n of this.notes) if (n.judged && n.judged !== 'extra') c[n.judged]++;
    return c;
  }

  /** Final result; every note not hit counts as a miss. */
  finish(): LessonResult {
    this.advance(Infinity);
    const c = this.counts();
    const hit = this.notes.filter((n): n is ExpectedNote & { hit: number } => n.hit !== undefined);
    const offs = hit.map((n) => n.hit);
    const mean = avg(offs);
    const expected = this.notes.length;
    const t0 = this.notes[0]?.time ?? 0;

    let drift = 0;
    if (hit.length >= 3) {
      const tm = avg(hit.map((n) => n.time));
      let num = 0;
      let den = 0;
      for (const n of hit) {
        num += (n.time - tm) * (n.hit - mean);
        den += (n.time - tm) ** 2;
      }
      drift = den > 0 ? (num / den) * 60 : 0;
    }

    const silent = hit.filter((n) => !n.audible).map((n) => Math.abs(n.hit));
    const audible = hit.filter((n) => n.audible).map((n) => Math.abs(n.hit));
    const base = {
      lessonId: this.lesson.id,
      expected,
      ...c,
      maxCombo: this.maxCombo,
      score: expected ? Math.round((100 * hit.reduce((s, n) => s + WEIGHT[n.judged!], 0)) / expected) : 0,
      meanMs: mean,
      sdMs: Math.sqrt(avg(offs.map((x) => (x - mean) ** 2))),
      within20: expected ? hit.filter((n) => Math.abs(n.hit) <= WINDOWS.great + 1e-6).length / expected : 0,
      within35: expected ? hit.filter((n) => Math.abs(n.hit) <= WINDOWS.good + 1e-6).length / expected : 0,
      driftMsPerMin: drift,
      ignored: { ...this.ignored },
      silentMeanAbsMs: silent.length ? avg(silent) : null,
      audibleMeanAbsMs: audible.length ? avg(audible) : null,
      durationSec: expected ? this.notes[expected - 1].time - t0 : 0,
      points: hit.map((n) => ({ t: n.time - t0, ms: n.hit, audible: n.audible })),
    };
    return { ...base, stars: starsFor(base) };
  }
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
