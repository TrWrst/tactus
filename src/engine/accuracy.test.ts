import { describe, expect, it } from 'vitest';
import { AccuracySession, PROBE_GAPS, consistencyLabel, summarizeCalibration, toGridNotes, type GridNote } from './accuracy';
import { Sequencer } from './sequencer';
import { DEFAULT_PRACTICE } from './practice';
import type { RhythmSettings } from './types';

const R: RhythmSettings = {
  bpm: 120, beatsPerBar: 4, beatUnit: 4, accents: ['accent', 'normal', 'normal', 'normal'],
  subdivision: 1, swing: 0.5, countInBars: 0,
};
const grid = (n: number, r: Partial<RhythmSettings> = {}, practice = DEFAULT_PRACTICE): GridNote[] => {
  const s = new Sequencer({ ...R, ...r }, 0, practice, 1);
  return toGridNotes(Array.from({ length: n }, () => s.next()));
};
const session = (notes: GridNote[]) => {
  const a = new AccuracySession();
  a.addNotes(notes);
  return a;
};

describe('hit matching', () => {
  it('scores early and late hits against the nearest note', () => {
    const a = session(grid(4));
    expect(a.addHit(0.488)!.offsetMs).toBeCloseTo(-12);
    expect(a.addHit(1.007)!.offsetMs).toBeCloseTo(7);
  });

  it('treats hits far from any note as extras', () => {
    const a = session(grid(4)); // notes every 500 ms → window ±150 ms
    expect(a.addHit(0.25)!.note).toBeNull();
    expect(a.summary().extras).toBe(1);
  });

  it('narrows the window for dense grids (16ths at 120 = 125 ms apart)', () => {
    const a = session(grid(8, { subdivision: 4 }));
    const h = a.addHit(0.125 + 0.05)!;
    expect(h.note?.sub).toBe(1);
    expect(h.offsetMs).toBeCloseTo(50);
    const h2 = a.addHit(0.32)!; // nearer 0.375 (sub 3) than 0.25
    expect(h2.note?.sub).toBe(3);
    expect(h2.offsetMs).toBeCloseTo(-55);
  });

  it('does not count a quieter second sound on the same note (flam, echo)', () => {
    const a = session(grid(2));
    a.addHit(0.002, 0.5);
    expect(a.addHit(0.09, 0.4)).toBeNull();
    expect(a.summary()).toMatchObject({ matched: 1, extras: 0 });
    expect(a.ignored).toBe(1);
  });

  it('lets a clearly louder stroke replace a faint ghost on the same note', () => {
    const a = session(grid(2));
    a.addHit(0, 0.02);
    expect(a.addHit(0.03, 0.5)!.offsetMs).toBeCloseTo(30);
    expect(a.summary().points.map((p) => Math.round(p.offsetMs))).toEqual([30]);
  });

  it('ignores count-in taps, sounds after the end, and quick quiet rebounds', () => {
    const a = new AccuracySession();
    expect(a.addHit(0.3, 0.5)).toBeNull(); // no notes yet (count-in)
    a.addNotes(grid(4));
    a.addHit(0.5, 0.5);
    expect(a.addHit(0.54, 0.1)).toBeNull(); // rebound
    expect(a.summary()).toMatchObject({ matched: 1, extras: 0 });
    expect(a.ignored).toBe(2);
  });

  it('counts a hit between notes as extra even before the next note is scheduled', () => {
    const a = new AccuracySession();
    a.addNotes(grid(1)); // only the note at 0 is known yet
    a.addHit(0, 0.5);
    expect(a.addHit(0.25, 0.5)!.note).toBeNull();
    expect(a.summary().extras).toBe(1);
  });

  it('ignores count-in notes', () => {
    const notes = grid(8, { countInBars: 1 });
    expect(notes.length).toBe(4);
    expect(notes[0].time).toBeCloseTo(2);
  });

  it('marks trainer-muted notes as silent', () => {
    const notes = grid(8, {}, { ...DEFAULT_PRACTICE, muteMode: 'bars', playBars: 1, muteBars: 1 });
    expect(notes.map((n) => n.audible)).toEqual([true, true, true, true, false, false, false, false]);
  });
});

describe('summary', () => {
  it('computes mean, spread and windows', () => {
    const a = session(grid(8));
    [-10, 10, -10, 10, 20, -20, 0, 40].forEach((o, i) => a.addHit(i * 0.5 + o / 1000));
    const s = a.summary();
    expect(s.matched).toBe(8);
    expect(s.meanMs).toBeCloseTo(5);
    expect(s.within10).toBeCloseTo(5 / 8);
    expect(s.within25).toBeCloseTo(7 / 8);
    expect(s.within50).toBe(1);
    expect(s.sdMs).toBeGreaterThan(15);
    expect(s.byBeat.map((b) => b.beat)).toEqual([0, 1, 2, 3]);
  });

  it('measures drift in ms per minute', () => {
    const a = session(grid(120)); // one minute at 120 BPM
    for (let i = 0; i < 120; i++) a.addHit(i * 0.5 + (i * 0.5 * 20) / 60 / 1000); // +20 ms per minute
    expect(a.summary().driftMsPerMin).toBeCloseTo(20, 3);
  });

  it('separates accuracy during silent beats', () => {
    const notes = grid(8, {}, { ...DEFAULT_PRACTICE, muteMode: 'bars', playBars: 1, muteBars: 1 });
    const a = session(notes);
    notes.forEach((n) => a.addHit(n.time + (n.audible ? 0.005 : 0.03)));
    const s = a.summary();
    expect(s.audible.meanAbsMs).toBeCloseTo(5);
    expect(s.silent.meanAbsMs).toBeCloseTo(30);
  });

  it('handles an empty session', () => {
    expect(new AccuracySession().summary()).toMatchObject({ matched: 0, extras: 0, meanMs: 0, sdMs: 0 });
  });

  it('labels consistency', () => {
    expect([5, 12, 25, 40].map(consistencyLabel)).toEqual(['Tight', 'Steady', 'Loose', 'Unsteady']);
  });
});

describe('calibration', () => {
  const probes = Array.from({ length: 10 }, (_, i) => 1 + i * 0.5);

  it('finds a delay outside the old 0–300 ms window (shifted browser timeline)', () => {
    for (const shift of [-0.12, 0.42]) {
      const r = summarizeCalibration(probes, probes.map((p) => p + shift));
      expect(r.detected).toBe(10);
      expect(r.latencyMs).toBeCloseTo(shift * 1000, 3);
    }
  });

  it('is not fooled by click spacing when probes are irregular', () => {
    const irregular = [1];
    for (const g of PROBE_GAPS) irregular.push(irregular[irregular.length - 1] + g);
    const onsets = irregular.slice(1).map((p) => p + 0.03); // first click missed
    const r = summarizeCalibration(irregular, onsets);
    expect(r.ok).toBe(true);
    expect(r.latencyMs).toBeCloseTo(30);
  });

  it('measures a stable wired latency', () => {
    const onsets = probes.map((p, i) => p + 0.0142 + (i % 2 ? 0.0003 : -0.0003));
    const r = summarizeCalibration(probes, onsets);
    expect(r.ok).toBe(true);
    expect(r.latencyMs).toBeCloseTo(14.2, 0);
    expect(r.spreadMs).toBeLessThan(1);
  });

  it('flags Bluetooth-sized latency', () => {
    const r = summarizeCalibration(probes, probes.map((p) => p + 0.21));
    expect(r).toMatchObject({ ok: false, reason: 'bluetooth' });
  });

  it('needs most clicks to be heard', () => {
    expect(summarizeCalibration(probes, probes.slice(0, 4).map((p) => p + 0.01)).reason).toBe('not-enough');
  });

  it('rejects scattered measurements', () => {
    const r = summarizeCalibration(probes, probes.map((p, i) => p + 0.01 + (i % 3) * 0.008));
    expect(r.reason).toBe('noisy');
  });

  it('ignores stray noises between clicks', () => {
    const onsets = [...probes.map((p) => p + 0.012), 1.35, 2.8].sort((a, b) => a - b);
    expect(summarizeCalibration(probes, onsets).latencyMs).toBeCloseTo(12);
  });
});
