/** Shared types for the audio engine. Framework-free. */

export const MIN_BPM = 20;
export const MAX_BPM = 300;

export type AccentLevel = 'accent' | 'normal' | 'soft' | 'mute';

/** Number of evenly spaced clicks per beat (1 = beat only, 3 = triplets, …). */
export type Subdivision = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type SoundId = 'blip' | 'wood' | 'tick' | 'bell' | 'shaker' | 'thump' | 'beep' | 'tone';

/** Everything the engine needs to know to produce clicks. */
export interface RhythmSettings {
  bpm: number;
  /** Beats per bar (numerator). */
  beatsPerBar: number;
  /** Note value that gets the beat (denominator). BPM counts these notes. */
  beatUnit: number;
  /** One entry per beat. Length is kept equal to beatsPerBar. */
  accents: AccentLevel[];
  subdivision: Subdivision;
  /** 0.5 = straight, 0.667 ≈ triplet swing, 0.75 = dotted. Only applies to even subdivisions. */
  swing: number;
  /** Bars of count-in before the pattern starts. */
  countInBars: 0 | 1 | 2;
}

/** The voice used for a scheduled click. */
export type ClickVoice = 'accent' | 'normal' | 'soft' | 'sub' | 'countIn' | 'countInAccent';

/** One click (or silent slot) produced by the sequencer. */
export interface BeatEvent {
  /** AudioContext time in seconds. */
  time: number;
  /** 0-based bar number counted from the first non-count-in bar (count-in bars are negative). */
  bar: number;
  /** 0-based beat in the bar. */
  beat: number;
  /** 0-based subdivision inside the beat (0 = the beat itself). */
  sub: number;
  isCountIn: boolean;
  /** Accent level of the owning beat. */
  level: AccentLevel;
  /** null when the slot is silent (muted beat). */
  voice: ClickVoice | null;
  /** BPM in effect for this beat (includes tempo-ramp changes). */
  bpm: number;
  /** Silenced by the muting trainer (not by the accent pattern). */
  trainerMuted: boolean;
}
