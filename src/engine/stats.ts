/** Rolling scheduler-timing statistics (pure, so it can be unit tested). */

export interface JitterReport {
  ticks: number;
  /** Wake-up interval of the scheduler timer, ms. */
  tickMean: number;
  tickStd: number;
  tickP99: number;
  tickMax: number;
  /** How far ahead of their play time events were handed to Web Audio, ms. */
  marginMin: number;
  marginMean: number;
  scheduled: number;
  /** Events scheduled after their intended time (would sound late). */
  late: number;
  /** Events skipped because the scheduler fell far behind (e.g. a frozen tab). */
  dropped: number;
}

export class JitterStats {
  private intervals: number[] = [];
  private lastTick: number | null = null;
  private margins: number[] = [];
  private late = 0;
  private dropped = 0;
  private scheduled = 0;

  constructor(private readonly capacity = 4000) {}

  tick(nowMs: number): void {
    if (this.lastTick !== null) push(this.intervals, nowMs - this.lastTick, this.capacity);
    this.lastTick = nowMs;
  }

  /** Forget the last tick time (e.g. after the page was hidden) so the gap is not counted. */
  pause(): void {
    this.lastTick = null;
  }

  event(marginSec: number): void {
    this.scheduled++;
    if (marginSec < 0) this.late++;
    push(this.margins, marginSec * 1000, this.capacity);
  }

  drop(n = 1): void {
    this.dropped += n;
  }

  reset(): void {
    this.intervals = [];
    this.margins = [];
    this.lastTick = null;
    this.late = this.dropped = this.scheduled = 0;
  }

  report(): JitterReport {
    const iv = this.intervals;
    const mean = avg(iv);
    const sorted = [...iv].sort((a, b) => a - b);
    return {
      ticks: iv.length,
      tickMean: mean,
      tickStd: Math.sqrt(avg(iv.map((x) => (x - mean) ** 2))),
      tickP99: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : 0,
      tickMax: sorted.length ? sorted[sorted.length - 1] : 0,
      marginMin: this.margins.length ? Math.min(...this.margins) : 0,
      marginMean: avg(this.margins),
      scheduled: this.scheduled,
      late: this.late,
      dropped: this.dropped,
    };
  }
}

function push(arr: number[], v: number, cap: number) {
  arr.push(v);
  if (arr.length > cap) arr.shift();
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
