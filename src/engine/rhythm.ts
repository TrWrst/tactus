import { MAX_BPM, MIN_BPM, type Subdivision } from './types';

export const clampBpm = (bpm: number): number => {
  if (!Number.isFinite(bpm)) return MIN_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
};

export const SUBDIVISIONS: { value: Subdivision; name: string; short: string }[] = [
  { value: 1, name: 'Quarter (beat only)', short: 'Beat' },
  { value: 2, name: 'Eighths', short: '2' },
  { value: 3, name: 'Triplets', short: '3' },
  { value: 4, name: 'Sixteenths', short: '4' },
  { value: 5, name: 'Quintuplets', short: '5' },
  { value: 6, name: 'Sextuplets', short: '6' },
  { value: 7, name: 'Septuplets', short: '7' },
];

export const MIN_SWING = 0.5;
export const MAX_SWING = 0.75;

/** Swing only makes sense when clicks pair up evenly. */
export const isSwingable = (subdivision: number): boolean => subdivision >= 2 && subdivision % 2 === 0;

export const clampSwing = (swing: number): number =>
  Number.isFinite(swing) ? Math.min(MAX_SWING, Math.max(MIN_SWING, swing)) : MIN_SWING;

/**
 * Position of each click inside one beat, as a fraction of the beat (0 ≤ x < 1).
 * With swing, every pair of clicks is re-split: the on-click keeps its place and the
 * off-click moves to `ratio` of the pair's length (0.5 = straight).
 */
export function subdivisionOffsets(subdivision: number, swing = 0.5): number[] {
  const n = Math.max(1, Math.floor(subdivision));
  const ratio = isSwingable(n) ? clampSwing(swing) : 0.5;
  const offsets: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i % 2 === 1 && isSwingable(n)) {
      const pairStart = (i - 1) / n;
      offsets.push(pairStart + (2 / n) * ratio);
    } else {
      offsets.push(i / n);
    }
  }
  return offsets;
}

export const beatDuration = (bpm: number): number => 60 / bpm;

export interface MeterPreset {
  beatsPerBar: number;
  beatUnit: number;
  label: string;
}

export const METER_PRESETS: MeterPreset[] = [
  { beatsPerBar: 2, beatUnit: 4, label: '2/4' },
  { beatsPerBar: 3, beatUnit: 4, label: '3/4' },
  { beatsPerBar: 4, beatUnit: 4, label: '4/4' },
  { beatsPerBar: 5, beatUnit: 4, label: '5/4' },
  { beatsPerBar: 6, beatUnit: 8, label: '6/8' },
  { beatsPerBar: 7, beatUnit: 8, label: '7/8' },
  { beatsPerBar: 12, beatUnit: 8, label: '12/8' },
];

export const MAX_BEATS_PER_BAR = 16;
export const BEAT_UNITS = [2, 4, 8, 16] as const;

const MARKINGS: [number, string][] = [
  [40, 'Grave'],
  [55, 'Largo'],
  [66, 'Larghetto'],
  [76, 'Adagio'],
  [92, 'Andante'],
  [108, 'Moderato'],
  [120, 'Allegretto'],
  [156, 'Allegro'],
  [176, 'Vivace'],
  [200, 'Presto'],
  [Infinity, 'Prestissimo'],
];

/** Traditional Italian tempo marking for a BPM (approximate, for display only). */
export const tempoMarking = (bpm: number): string => MARKINGS.find(([max]) => bpm < max)![1];
