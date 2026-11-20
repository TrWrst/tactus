import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MetronomeEngine } from '../engine/audioEngine';
import { cycleAccent, resizeAccents } from '../engine/accents';
import {
  setKeepAwake,
  setPlaybackAudioSession,
  setupMediaSession,
  updateMediaSession,
  vibrate,
} from '../engine/platform';
import { clampBpm } from '../engine/rhythm';
import { TapTempo } from '../engine/tapTempo';
import type { BeatEvent, RhythmSettings } from '../engine/types';
import type { PracticeSettings } from '../engine/practice';
import { type AppSettings, loadSettings, meterLabel, saveSettings } from './settings';

const rhythmOf = (s: AppSettings): RhythmSettings => ({
  bpm: s.bpm,
  beatsPerBar: s.beatsPerBar,
  beatUnit: s.beatUnit,
  accents: s.accents,
  subdivision: s.subdivision,
  swing: s.swing,
  countInBars: s.countInBars,
});

export interface BeatState {
  /** Increments every beat; use as a React key to restart animations. */
  n: number;
  ev: BeatEvent | null;
}

export function useMetronome() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [running, setRunning] = useState(false);
  /** True when the last session ended because the playback counter ran out. */
  const [finished, setFinished] = useState(false);
  const [beat, setBeat] = useState<BeatState>({ n: 0, ev: null });
  const engineRef = useRef<MetronomeEngine>();
  engineRef.current ??= new MetronomeEngine(rhythmOf(settings));
  const engine = engineRef.current;
  const tapRef = useRef(new TapTempo());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Engine sync.
  useEffect(() => engine.setRhythm(rhythmOf(settings)), [engine, settings]);
  useEffect(() => engine.setPractice(settings.practice), [engine, settings.practice]);
  useEffect(() => engine.setSound(settings.sound), [engine, settings.sound]);
  useEffect(() => engine.setVolume(settings.volume), [engine, settings.volume]);

  // Persist (debounced so dragging the dial doesn't hammer storage).
  useEffect(() => {
    const id = setTimeout(() => saveSettings(settings), 250);
    return () => clearTimeout(id);
  }, [settings]);

  useEffect(() => {
    const offState = engine.onState((r, reason) => {
      setRunning(r);
      setFinished(!r && reason === 'finished');
      if (!r) setBeat((b) => ({ n: b.n + 1, ev: null }));
    });
    const offBeat = engine.onBeat((ev) => {
      if (ev.sub !== 0) return;
      setBeat((b) => ({ n: b.n + 1, ev }));
      if (settingsRef.current.haptics && ev.voice) vibrate(ev.level === 'accent' || ev.voice === 'countInAccent' ? 35 : 12);
    });
    setupMediaSession({ onPlay: () => void engine.start(), onPause: () => engine.stop() });
    return () => {
      offState();
      offBeat();
    };
  }, [engine]);

  useEffect(() => {
    void setKeepAwake(running);
    updateMediaSession(running, settings.bpm, meterLabel(settings));
  }, [running, settings.bpm, settings.beatsPerBar, settings.beatUnit]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((patch: Partial<AppSettings>) => setSettings((s) => ({ ...s, ...patch })), []);

  const actions = useMemo(
    () => ({
      update,
      toggle: () => {
        // With the accuracy meter on, the mic needs the play-and-record session instead.
        if (!settingsRef.current.meter.enabled) setPlaybackAudioSession();
        void engine.toggle();
      },
      setBpm: (bpm: number) => update({ bpm: clampBpm(bpm) }),
      nudgeBpm: (delta: number) => setSettings((s) => ({ ...s, bpm: clampBpm(s.bpm + delta) })),
      tap: () => {
        const bpm = tapRef.current.tap(performance.now());
        if (bpm !== null) update({ bpm });
        return bpm;
      },
      /** keepPattern: custom steppers keep the user's edits; picking a preset loads its default pattern. */
      setMeter: (beatsPerBar: number, beatUnit: number, keepPattern = false) =>
        setSettings((s) => ({
          ...s,
          beatsPerBar,
          beatUnit,
          accents: resizeAccents(keepPattern ? s.accents : [], beatsPerBar, beatUnit),
        })),
      resetAccents: () => setSettings((s) => ({ ...s, accents: resizeAccents([], s.beatsPerBar, s.beatUnit) })),
      cycleBeat: (i: number) =>
        setSettings((s) => ({ ...s, accents: s.accents.map((a, j) => (j === i ? cycleAccent(a) : a)) })),
      /** Put the user's own rhythm and trainer settings back on the engine (after a lesson). */
      restoreEngine: () => {
        engine.setRhythm(rhythmOf(settingsRef.current));
        engine.setPractice(settingsRef.current.practice);
        setFinished(false);
      },
      updateMeter: (patch: Partial<AppSettings['meter']>) =>
        setSettings((s) => ({ ...s, meter: { ...s.meter, ...patch } })),
      updatePractice: (patch: Partial<PracticeSettings>) =>
        setSettings((s) => ({ ...s, practice: { ...s.practice, ...patch } })),
      preview: (sound: AppSettings['sound']) => void engine.preview(sound),
    }),
    [engine, update],
  );

  return { settings, running, finished, beat, engine, ...actions };
}

export type Metronome = ReturnType<typeof useMetronome>;
