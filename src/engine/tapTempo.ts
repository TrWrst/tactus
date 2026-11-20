import { clampBpm } from './rhythm';

export interface TapTempoOptions {
  /** Taps kept for averaging (so maxTaps - 1 intervals). */
  maxTaps?: number;
  /** A pause longer than this (ms) starts a new measurement. */
  resetAfterMs?: number;
  /** An interval this far (fraction) from the running mean starts a new measurement. */
  outlierRatio?: number;
}

/**
 * Tap tempo: averages the intervals between the last 2–8 taps.
 * Pure: the caller passes timestamps (ms), so it is deterministic in tests.
 */
export class TapTempo {
  private taps: number[] = [];
  private readonly maxTaps: number;
  private readonly resetAfterMs: number;
  private readonly outlierRatio: number;

  constructor(opts: TapTempoOptions = {}) {
    this.maxTaps = opts.maxTaps ?? 8;
    this.resetAfterMs = opts.resetAfterMs ?? 2000;
    this.outlierRatio = opts.outlierRatio ?? 0.4;
  }

  /** Register a tap. Returns the averaged BPM once there are ≥ 2 taps, else null. */
  tap(nowMs: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined) {
      const interval = nowMs - last;
      if (interval <= 0 || interval > this.resetAfterMs) {
        this.taps = [];
      } else if (this.taps.length >= 3) {
        const mean = this.meanInterval()!;
        // A sudden big change of tempo means the player changed their mind: restart from the last tap.
        if (Math.abs(interval - mean) / mean > this.outlierRatio) this.taps = [last];
      }
    }
    this.taps.push(nowMs);
    if (this.taps.length > this.maxTaps) this.taps.shift();
    const mean = this.meanInterval();
    return mean === null ? null : clampBpm(60000 / mean);
  }

  get count(): number {
    return this.taps.length;
  }

  reset(): void {
    this.taps = [];
  }

  private meanInterval(): number | null {
    if (this.taps.length < 2) return null;
    return (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
  }
}
