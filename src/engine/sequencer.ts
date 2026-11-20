import { DEFAULT_PRACTICE, type PracticeSettings, rampBpm, rampStepsElapsed, seededRandom, stopReached, trainerMutesBeat } from './practice';
import { subdivisionOffsets } from './rhythm';
import type { BeatEvent, ClickVoice, RhythmSettings } from './types';

/**
 * Pure beat math for the lookahead scheduler. It knows nothing about Web Audio:
 * give it a start time and ask for every event before a horizon.
 *
 * Changes to tempo, subdivision and swing take effect on the next beat, so a beat
 * never gets stretched half-way through. Accent changes apply to the next event.
 *
 * Practice trainers (muting, tempo ramp, playback counter) are evaluated here too,
 * on the audio timeline, so they are exactly as precise as the clicks.
 */
export class Sequencer {
  private s: RhythmSettings;
  private p: PracticeSettings;
  private readonly rand: () => number;
  private bar: number;
  private beat = 0;
  private sub = 0;
  private beatStart: number;
  /** Audio time of bar 0, beat 0 (after the count-in). */
  private patternStart: number | null = null;
  // Values locked at the start of the current beat.
  private beatDur = 0;
  private beatOffsets: number[] = [0];
  private beatBpm = 0;
  private beatTrainerMuted = false;
  private finishedAt: number | null = null;

  constructor(settings: RhythmSettings, startTime: number, practice: PracticeSettings = DEFAULT_PRACTICE, seed = 1) {
    this.s = { ...settings, accents: [...settings.accents] };
    this.p = { ...practice };
    this.rand = seededRandom(seed);
    this.bar = 0 - settings.countInBars; // avoid -0
    this.beatStart = startTime;
    this.lockBeat();
  }

  get settings(): Readonly<RhythmSettings> {
    return this.s;
  }

  /** True once the playback counter has run out. */
  get done(): boolean {
    return this.finishedAt !== null;
  }

  /** Audio time at which playback should end (start of the first beat not played). */
  get endTime(): number | null {
    return this.finishedAt;
  }

  /** Time of the next event that `next()` would return (Infinity when done). */
  get nextTime(): number {
    if (this.finishedAt !== null) return Infinity;
    return this.beatStart + this.beatOffsets[this.sub] * this.beatDur;
  }

  /** BPM of the beat currently locked in (may differ from settings.bpm during a ramp). */
  get currentBpm(): number {
    return this.beatBpm;
  }

  update(settings: RhythmSettings): void {
    this.s = { ...settings, accents: [...settings.accents] };
  }

  updatePractice(practice: PracticeSettings): void {
    this.p = { ...practice };
  }

  /** Returns the event at the current position and advances one slot. */
  next(): BeatEvent {
    if (this.sub === 0 && this.beat >= this.s.beatsPerBar) {
      // The bar was shortened after this beat was locked: start the next bar now.
      this.beat = 0;
      this.bar++;
    }
    const isCountIn = this.bar < 0;
    const level = isCountIn ? (this.beat === 0 ? 'accent' : 'normal') : (this.s.accents[this.beat] ?? 'normal');
    let voice: ClickVoice | null;
    if (isCountIn) voice = this.beat === 0 ? 'countInAccent' : 'countIn';
    else if (level === 'mute' || this.beatTrainerMuted) voice = null;
    else if (this.sub > 0) voice = 'sub';
    else voice = level;

    const ev: BeatEvent = {
      time: this.nextTime,
      bar: this.bar,
      beat: this.beat,
      sub: this.sub,
      isCountIn,
      level,
      voice,
      bpm: this.beatBpm,
      trainerMuted: this.beatTrainerMuted,
    };

    this.sub++;
    if (this.sub >= this.beatOffsets.length) {
      this.sub = 0;
      this.beatStart += this.beatDur;
      this.beat++;
      if (this.beat >= this.s.beatsPerBar) {
        this.beat = 0;
        this.bar++;
      }
      this.lockBeat();
    }
    return ev;
  }

  /** All events with time < horizon, in order. */
  scheduleUntil(horizon: number): BeatEvent[] {
    const out: BeatEvent[] = [];
    while (this.nextTime < horizon) out.push(this.next());
    return out;
  }

  private lockBeat(): void {
    // If the bar got shorter mid-bar, wrap now instead of playing beats that no longer exist.
    if (this.beat >= this.s.beatsPerBar) {
      this.beat = 0;
      this.bar++;
    }
    if (this.bar >= 0 && this.patternStart === null) this.patternStart = this.beatStart;
    const elapsed = this.patternStart === null ? 0 : this.beatStart - this.patternStart;

    if (stopReached(this.p, this.bar, elapsed)) {
      this.finishedAt = this.beatStart;
      return;
    }

    let bpm = this.s.bpm;
    if (this.p.rampOn && this.bar >= 0) {
      const k = rampStepsElapsed(this.bar, elapsed, this.p.rampEvery, this.p.rampUnit);
      bpm = rampBpm(this.s.bpm, this.p.rampTarget, this.p.rampStep, k, this.p.rampEnd);
    }
    this.beatBpm = bpm;
    this.beatDur = 60 / bpm;
    this.beatTrainerMuted = trainerMutesBeat(this.p, this.bar, this.rand);
    const subs = this.bar < 0 ? 1 : this.s.subdivision;
    this.beatOffsets = subdivisionOffsets(subs, this.s.swing);
  }
}
