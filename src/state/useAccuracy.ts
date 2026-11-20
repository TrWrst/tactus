import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccuracySession, toGridNotes, type AccuracySummary, type CalibrationResult } from '../engine/accuracy';
import { AccuracyMeter } from '../engine/accuracyMeter';
import type { Metronome } from './useMetronome';

export type MicState = 'off' | 'opening' | 'on' | 'error';

export interface LiveAccuracy {
  /** Increments per hit (React key for the hit animation). */
  n: number;
  /** Offset of the last hit in ms; null if it matched no note. */
  last: number | null;
  matched: number;
  sdMs: number;
  meanMs: number;
}

const EMPTY_LIVE: LiveAccuracy = { n: 0, last: null, matched: 0, sdMs: 0, meanMs: 0 };

/** Connects the accuracy meter (mic) to the metronome and keeps score per session. */
export function useAccuracy(m: Metronome) {
  const meter = useMemo(() => new AccuracyMeter(m.engine), [m.engine]);
  const cfg = m.settings.meter;
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const [mic, setMic] = useState<MicState>('off');
  const [micError, setMicError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveAccuracy>(EMPTY_LIVE);
  const [result, setResult] = useState<AccuracySummary | null>(null);
  /** Increments when a finished session produced a result (App opens the results sheet). */
  const [resultSeq, setResultSeq] = useState(0);
  const [level, setLevel] = useState(0);
  const [probeHits, setProbeHits] = useState(0);
  const session = useRef<AccuracySession | null>(null);
  /** Free-play scoring (Metronome tab). The Train tab turns it off and scores lessons itself. */
  const freePlay = useRef(true);
  const setFreePlay = useCallback((on: boolean) => {
    freePlay.current = on;
  }, []);

  useEffect(() => meter.setSensitivity(cfg.sensitivity), [meter, cfg.sensitivity]);
  // Speaker mode: listen below ~800 Hz, and (while the meter is on) play the high tone click.
  useEffect(() => meter.setBand(cfg.output === 'speaker' ? 'low' : 'full'), [meter, cfg.output]);
  useEffect(
    () => m.engine.setSoundOverride(cfg.enabled && cfg.output === 'speaker' ? 'tone' : null),
    [m.engine, cfg.enabled, cfg.output],
  );

  const openMic = useCallback(async () => {
    setMic('opening');
    setMicError(null);
    try {
      await meter.open(cfgRef.current.deviceId);
      setMic('on');
    } catch (e) {
      setMic('error');
      const name = (e as Error)?.name;
      setMicError(
        name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in the browser’s site settings.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'No microphone found.'
            : (e as Error)?.message || 'Could not start the microphone.',
      );
    }
  }, [meter]);

  const closeMic = useCallback(() => {
    meter.close();
    setMic('off');
  }, [meter]);

  // Session lifecycle — subscribed once; start/stop come from the engine itself.
  useEffect(() => {
    const offState = m.engine.onState((running) => {
      if (running) {
        if (!cfgRef.current.enabled || !freePlay.current) return;
        session.current = new AccuracySession();
        setLive(EMPTY_LIVE);
        if (!meter.isOpen) void openMic();
      } else if (session.current) {
        const s = session.current.summary();
        session.current = null;
        if (s.matched >= 4) {
          setResult(s);
          setResultSeq((n) => n + 1);
        }
      }
    });
    const offSched = m.engine.onSchedule((evs) => session.current?.addNotes(toGridNotes(evs)));
    const offOnset = meter.onOnset((t, peak) => {
      const sess = session.current;
      if (!sess) return;
      const h = sess.addHit(t - (cfgRef.current.latencyMs ?? 0) / 1000, peak);
      if (!h) return; // count-in tap, rebound or double: not scored
      const s = sess.summary();
      setLive((l) => ({ n: l.n + 1, last: h.offsetMs, matched: s.matched, sdMs: s.sdMs, meanMs: s.meanMs }));
    });
    return () => {
      offState();
      offSched();
      offOnset();
    };
  }, [m.engine, meter, openMic]);

  // Turning the meter off releases the mic; hiding the page does too (reopened on next Start).
  useEffect(() => {
    if (!cfg.enabled) closeMic();
  }, [cfg.enabled, closeMic]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && !m.engine.running) closeMic();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [m.engine, closeMic]);
  useEffect(() => () => meter.close(), [meter]);

  /** Live input level + hit counter, used by the setup sheet. Returns an unsubscribe. */
  const watchInput = useCallback(() => {
    setProbeHits(0);
    const offL = meter.onLevel(setLevel);
    const offO = meter.onOnset(() => setProbeHits((n) => n + 1));
    return () => {
      offL();
      offO();
      setLevel(0);
    };
  }, [meter]);

  const calibrate = useCallback(async (): Promise<CalibrationResult> => {
    if (m.engine.running) m.engine.stop();
    const r = await meter.calibrate({ leakTest: cfgRef.current.output === 'speaker' });
    if (r.ok) m.updateMeter({ latencyMs: Math.round(r.latencyMs * 10) / 10 });
    return r;
  }, [m, meter]);

  const switchDevice = useCallback(
    async (deviceId: string | null) => {
      m.updateMeter({ deviceId, latencyMs: null }); // a different mic means a different latency
      cfgRef.current = { ...cfgRef.current, deviceId };
      meter.close();
      await openMic();
    },
    [m, meter, openMic],
  );

  return { setFreePlay, meter, mic, micError, live, result, resultSeq, level, probeHits, openMic, closeMic, watchInput, calibrate, switchDevice };
}

export type Accuracy = ReturnType<typeof useAccuracy>;
