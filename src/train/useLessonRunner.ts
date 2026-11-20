import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PRACTICE } from '../engine/practice';
import type { RhythmSettings } from '../engine/types';
import type { Accuracy } from '../state/useAccuracy';
import type { Metronome } from '../state/useMetronome';
import { accentsFromCode, type Lesson } from './curriculum';
import { LessonScorer, type Judgment, type LessonResult } from './scorer';

export type RunPhase = 'idle' | 'starting' | 'playing' | 'finishing' | 'error';

export interface LiveLesson {
  /** Increments on every judgment (React key for the pop animation). */
  n: number;
  judgment: Judgment | null;
  offsetMs: number | null;
  combo: number;
  counts: Record<Judgment, number>;
  /** Current bar (0-based, negative during count-in). */
  bar: number;
  countInBeat: number | null;
  /** Click is silent right now (gap click / random mute). */
  silent: boolean;
  bpm: number;
}

const EMPTY_COUNTS: Record<Judgment, number> = { perfect: 0, great: 0, good: 0, off: 0, miss: 0, extra: 0 };

export const lessonRhythm = (l: Lesson): RhythmSettings => ({
  bpm: l.bpm,
  beatsPerBar: l.beatsPerBar,
  beatUnit: 4,
  accents: accentsFromCode(l.click.accents, l.beatsPerBar),
  subdivision: l.click.sub,
  swing: 0.5,
  countInBars: l.countIn ?? 1,
});

/**
 * Runs one lesson: configures the engine and mic, scores every hit, and restores
 * the user's own metronome settings afterwards. `run` resolves with the result,
 * or null if the player quit or the mic could not start.
 */
export function useLessonRunner(m: Metronome, acc: Accuracy) {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [live, setLive] = useState<LiveLesson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<(() => void) | null>(null);
  const mRef = useRef(m);
  mRef.current = m;
  const accRef = useRef(acc);
  accRef.current = acc;

  const run = useCallback(
    (lesson: Lesson): Promise<LessonResult | null> =>
      new Promise((resolve) => {
        void (async () => {
          const { engine } = mRef.current;
          const cfg = mRef.current.settings.meter;
          setPhase('starting');
          setError(null);
          if (!accRef.current.meter.isOpen) await accRef.current.openMic();
          if (!accRef.current.meter.isOpen) {
            setPhase('error');
            setError('The microphone could not start. Open the accuracy meter setup to check it.');
            resolve(null);
            return;
          }
          if (engine.running) engine.stop();

          const lat = (cfg.latencyMs ?? 0) / 1000;
          engine.setRhythm(lessonRhythm(lesson));
          engine.setPractice({ ...DEFAULT_PRACTICE, ...lesson.practice, stopMode: 'bars', stopBars: lesson.bars });
          engine.setSoundOverride(cfg.output === 'speaker' ? 'tone' : null);
          const ac = engine.getContext();
          const scorer = new LessonScorer(lesson);

          setLive({ n: 0, judgment: null, offsetMs: null, combo: 0, counts: EMPTY_COUNTS, bar: -1, countInBeat: null, silent: false, bpm: lesson.bpm });

          const offSched = engine.onSchedule((evs) => scorer.addBeats(evs));
          const offOnset = accRef.current.meter.onOnset((t, peak) => {
            const fb = scorer.addHit(t - lat, peak);
            if (!fb) return; // count-in tap, rebound or double: not scored
            setLive((l) => l && { ...l, n: l.n + 1, judgment: fb.judgment, offsetMs: fb.offsetMs, combo: fb.combo, counts: scorer.counts() });
          });
          const offBeat = engine.onBeat((ev) => {
            if (ev.sub !== 0) return;
            setLive((l) => l && { ...l, bar: ev.bar, countInBeat: ev.isCountIn ? ev.beat + 1 : null, silent: !ev.isCountIn && ev.voice === null, bpm: ev.bpm });
          });
          // Notes whose window has passed without a hit become misses (hits arrive ~latency + 10 ms late).
          const missTimer = window.setInterval(() => {
            if (scorer.advance(ac.currentTime - lat - 0.08)) {
              setLive((l) => l && { ...l, n: l.n + 1, judgment: 'miss', offsetMs: null, combo: 0, counts: scorer.counts() });
            }
          }, 50);

          let settled = false;
          const finish = (result: LessonResult | null) => {
            if (settled) return;
            settled = true;
            window.clearInterval(missTimer);
            offSched();
            offOnset();
            offBeat();
            offState();
            active.current = null;
            mRef.current.restoreEngine();
            const c = mRef.current.settings.meter;
            engine.setSoundOverride(c.enabled && c.output === 'speaker' ? 'tone' : null);
            setPhase('idle');
            resolve(result);
          };
          const offState = engine.onState((running, reason) => {
            if (running) return;
            if (reason === 'finished') {
              setPhase('finishing');
              // Give the last hits time to arrive before scoring.
              window.setTimeout(() => finish(scorer.finish()), 450);
            } else finish(null);
          });
          active.current = () => engine.stop('user');
          setPhase('playing');
          await engine.start();
        })();
      }),
    [],
  );

  const abort = useCallback(() => active.current?.(), []);
  useEffect(() => () => active.current?.(), []);

  return { phase, live, error, run, abort };
}
