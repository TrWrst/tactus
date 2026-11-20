import type { BeatEvent } from './types';

/**
 * Accuracy scoring: match detected hits to the metronome grid and summarize.
 * Pure: times are AudioContext seconds, already corrected for system latency.
 */

export interface GridNote {
  time: number;
  bar: number;
  beat: number;
  sub: number;
  /** False when the click was silent (accent mute or a trainer-muted beat). */
  audible: boolean;
}

export interface ScoredHit {
  time: number;
  peak: number;
  /** Signed offset from the matched note (negative = early). null for extra hits. */
  offsetMs: number | null;
  note: GridNote | null;
}

export interface AccuracySummary {
  matched: number;
  extras: number;
  meanMs: number;
  medianMs: number;
  sdMs: number;
  meanAbsMs: number;
  /** Share of matched hits within ±10 / ±25 / ±50 ms (0–1). */
  within10: number;
  within25: number;
  within50: number;
  /** Linear trend of the offset over the session, ms per minute (+ = falling behind). */
  driftMsPerMin: number;
  byBeat: { beat: number; meanMs: number; n: number }[];
  audible: { meanAbsMs: number; n: number };
  silent: { meanAbsMs: number; n: number };
  /** Every matched hit, for charts and the table. t = seconds since the first note. */
  points: { t: number; offsetMs: number; beat: number; sub: number; audible: boolean }[];
  durationSec: number;
}

const MAX_WINDOW = 0.15;

export const toGridNotes = (events: BeatEvent[]): GridNote[] =>
  events
    .filter((e) => !e.isCountIn)
    .map((e) => ({ time: e.time, bar: e.bar, beat: e.beat, sub: e.sub, audible: e.voice !== null }));

export class AccuracySession {
  private notes: GridNote[] = [];
  private used = new Map<GridNote, ScoredHit>();
  private lastHit: { t: number; peak: number } | null = null;
  readonly hits: ScoredHit[] = [];
  /** Sounds deliberately not scored: count-in taps, rebounds/echoes, quieter doubles. */
  ignored = 0;

  /** Notes arrive in time order from the scheduler. */
  addNotes(notes: GridNote[]): void {
    for (const n of notes) this.notes.push(n);
  }

  get noteCount(): number {
    return this.notes.length;
  }

  /**
   * Score one sound at (latency-corrected) time `t`. Returns null when it is not scored:
   * before the first note (count-in), a quieter rebound within 60 ms,
   * or a quieter second sound on a note that already has a hit. A clearly louder second
   * sound replaces the first (the first was a ghost, e.g. click leak). Only sounds
   * outside every note's window are "extra".
   */
  addHit(t: number, peak = 0): ScoredHit | null {
    const first = this.notes[0];
    // No "after the last note" rule: notes are only scheduled ~100 ms ahead, so a hit between
    // notes often arrives before the next one exists. Hits after Stop never reach the session.
    if (!first || t < first.time - MAX_WINDOW) {
      this.ignored++;
      return null;
    }
    const prevHit = this.lastHit;
    if (prevHit && t - prevHit.t < 0.06 && peak < prevHit.peak * 0.6) {
      this.ignored++;
      return null;
    }
    this.lastHit = { t, peak };

    const i = this.nearest(t);
    const n = this.notes[i];
    const prev = this.notes[i - 1];
    const next = this.notes[i + 1];
    // Half the distance to the neighbouring notes, so a hit belongs to exactly one note.
    const gaps = [prev ? n.time - prev.time : Infinity, next ? next.time - n.time : Infinity];
    const window = Math.min(MAX_WINDOW, 0.5 * Math.min(...gaps));
    if (Math.abs(t - n.time) <= window) {
      const existing = this.used.get(n);
      if (!existing) {
        const hit: ScoredHit = { time: t, peak, offsetMs: (t - n.time) * 1000, note: n };
        this.used.set(n, hit);
        this.hits.push(hit);
        return hit;
      }
      if (peak > existing.peak * 1.5) {
        existing.time = t;
        existing.peak = peak;
        existing.offsetMs = (t - n.time) * 1000;
        return existing;
      }
      this.ignored++;
      return null;
    }
    const extra: ScoredHit = { time: t, peak, offsetMs: null, note: null };
    this.hits.push(extra);
    return extra;
  }

  summary(): AccuracySummary {
    return summarize(this.hits, this.notes[0]?.time ?? 0);
  }

  private nearest(t: number): number {
    const a = this.notes;
    if (!a.length) return -1;
    let lo = 0;
    let hi = a.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid].time < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(a[lo - 1].time - t) <= Math.abs(a[lo].time - t)) lo--;
    return lo;
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarize(hits: ScoredHit[], startTime: number): AccuracySummary {
  const matched = hits.filter((h): h is ScoredHit & { offsetMs: number; note: GridNote } => h.offsetMs !== null);
  const offs = matched.map((h) => h.offsetMs);
  const m = mean(offs);
  const abs = offs.map(Math.abs);
  const share = (lim: number) => (offs.length ? abs.filter((x) => x <= lim + 1e-6).length / offs.length : 0);

  // Least-squares slope of offset vs time.
  let drift = 0;
  if (matched.length >= 3) {
    const ts = matched.map((h) => h.note.time);
    const tm = mean(ts);
    let num = 0;
    let den = 0;
    matched.forEach((h, i) => {
      num += (ts[i] - tm) * (h.offsetMs - m);
      den += (ts[i] - tm) ** 2;
    });
    drift = den > 0 ? (num / den) * 60 : 0;
  }

  const beats = new Map<number, number[]>();
  matched.forEach((h) => {
    if (h.note.sub === 0) beats.set(h.note.beat, [...(beats.get(h.note.beat) ?? []), h.offsetMs]);
  });
  const aud = matched.filter((h) => h.note.audible).map((h) => Math.abs(h.offsetMs));
  const sil = matched.filter((h) => !h.note.audible).map((h) => Math.abs(h.offsetMs));
  const last = matched.length ? matched[matched.length - 1].note.time : startTime;

  return {
    matched: matched.length,
    extras: hits.length - matched.length,
    meanMs: m,
    medianMs: median(offs),
    sdMs: Math.sqrt(mean(offs.map((x) => (x - m) ** 2))),
    meanAbsMs: mean(abs),
    within10: share(10),
    within25: share(25),
    within50: share(50),
    driftMsPerMin: drift,
    byBeat: [...beats.entries()].sort((a, b) => a[0] - b[0]).map(([beat, xs]) => ({ beat, meanMs: mean(xs), n: xs.length })),
    audible: { meanAbsMs: mean(aud), n: aud.length },
    silent: { meanAbsMs: mean(sil), n: sil.length },
    points: matched.map((h) => ({
      t: h.note.time - startTime,
      offsetMs: h.offsetMs,
      beat: h.note.beat,
      sub: h.note.sub,
      audible: h.note.audible,
    })),
    durationSec: Math.max(0, last - startTime),
  };
}

/** One-word verdict from the spread (standard deviation). */
export const consistencyLabel = (sdMs: number): string =>
  sdMs <= 8 ? 'Tight' : sdMs <= 15 ? 'Steady' : sdMs <= 30 ? 'Loose' : 'Unsteady';

// ---------- Calibration (loopback: earbud held to the mic) ----------

export interface CalibrationResult {
  ok: boolean;
  /** Offset between when a click is scheduled and when the mic hears it, ms (output + input latency). */
  latencyMs: number;
  /** Robust spread of the measurements (scaled MAD), ms. */
  spreadMs: number;
  /** Probe clicks that were heard. */
  detected: number;
  expected: number;
  /** All sounds the detector picked up during calibration (diagnostics). */
  heard?: number;
  /** Loudest input level during calibration, dBFS (diagnostics). */
  peakDb?: number;
  reason?: 'not-enough' | 'noisy' | 'bluetooth';
  /** Speaker mode: tone clicks played while you were silent, and how many were mistaken for hits. */
  leakTested?: number;
  leaked?: number;
}

/** Largest round-trip latency we accept as "wired". Bluetooth is typically 150–300 ms. */
export const MAX_WIRED_LATENCY_MS = 100;

/**
 * Gaps between calibration clicks. Deliberately irregular: with evenly spaced clicks a
 * delay of d and d ± one gap look identical; with these only the true delay lines up
 * with every click.
 */
export const PROBE_GAPS = [0.5, 0.62, 0.47, 0.71, 0.55, 0.66, 0.49, 0.58, 0.69];

/** Search range for the delay. Browsers can put mic input on a shifted timeline, so allow negative values too. */
const SEARCH_MIN = -0.25;
const SEARCH_MAX = 0.75;

/**
 * Find the constant delay that best explains the detected sounds: every
 * (onset − probe) difference in the search range is a candidate, and the densest
 * 4 ms cluster wins. Then each probe takes the onset closest to that delay
 * (within ±20 ms), and the median of those is the latency.
 */
export function summarizeCalibration(probeTimes: number[], onsetTimes: number[]): CalibrationResult {
  const diffs: number[] = [];
  for (const p of probeTimes) for (const o of onsetTimes) {
    const d = o - p;
    if (d >= SEARCH_MIN && d <= SEARCH_MAX) diffs.push(d);
  }
  diffs.sort((a, b) => a - b);
  let best = 0;
  let center = 0;
  for (let i = 0, j = 0; i < diffs.length; i++) {
    while (diffs[j] < diffs[i] - 0.004) j++;
    if (i - j + 1 > best) {
      best = i - j + 1;
      center = median(diffs.slice(j, i + 1));
    }
  }

  const offsets: number[] = [];
  for (const p of probeTimes) {
    let pick: number | null = null;
    for (const o of onsetTimes) {
      const d = o - p;
      if (Math.abs(d - center) <= 0.02 && (pick === null || Math.abs(d - center) < Math.abs(pick - center))) pick = d;
    }
    if (pick !== null) offsets.push(pick * 1000);
  }

  const med = median(offsets);
  const spread = 1.4826 * median(offsets.map((x) => Math.abs(x - med)));
  const base = {
    latencyMs: med,
    spreadMs: spread,
    detected: offsets.length,
    expected: probeTimes.length,
    heard: onsetTimes.length,
  };
  if (offsets.length < Math.ceil(probeTimes.length * 0.6)) return { ...base, ok: false, reason: 'not-enough' };
  if (med > MAX_WIRED_LATENCY_MS) return { ...base, ok: false, reason: 'bluetooth' };
  if (spread > 3) return { ...base, ok: false, reason: 'noisy' };
  return { ...base, ok: true };
}
