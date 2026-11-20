/**
 * Percussive onset detector (stick on pad, clap). Pure and sample-accurate so it
 * runs unchanged inside the AudioWorklet and in unit tests.
 *
 * Signal path per sample: one-pole high-pass (~150 Hz, removes handling rumble)
 * → rectify → instant-attack peak follower ("fast") compared with an adaptive
 * noise floor ("slow", only updated while quiet). An onset is the sample where
 * fast crosses the threshold, at least `minGapMs` after the previous one, and only after
 * the signal has fallen below half the threshold since then (hysteresis: a ringing
 * tail that hovers around the threshold can't re-trigger).
 * The peak is measured over the following 10 ms, so onsets are reported 10 ms late
 * but carry the exact frame of the attack.
 */

export interface Onset {
  /** Absolute frame (sample index) of the attack. */
  frame: number;
  /** Peak absolute amplitude in the 10 ms after the attack (0–1). */
  peak: number;
}

/**
 * 'full': listen to everything (headphones, calibration).
 * 'low': listen only below ~800 Hz (speaker mode). The speaker-mode click is a pure
 * tone above 2.5 kHz (≈60 dB down after the 6th-order filter), so it is filtered out while stick hits, claps and pillow thuds,
 * which all carry plenty of low/mid energy, still come through.
 */
export type DetectionBand = 'full' | 'low';
export const LOW_BAND_CUTOFF_HZ = 800;
/** Extra detection delay of the low-band filter (median 0.73 ms on noise-burst hits); subtracted so both bands agree. */
export const LOW_BAND_DELAY_MS = 0.7;

/** Transposed direct form II biquad (RBJ cookbook low-pass). */
class Biquad {
  private z1 = 0;
  private z2 = 0;
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  constructor(sampleRate: number, freq: number, q: number) {
    const w = (2 * Math.PI * freq) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = (1 - cos) / 2 / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

export interface OnsetOptions {
  sampleRate: number;
  band?: DetectionBand;
  /** 1 (only loud hits) … 10 (very quiet hits). */
  sensitivity?: number;
  /** Ignore new onsets closer than this to the previous one. */
  minGapMs?: number;
}

export const sensitivityParams = (s: number) => {
  const t = (Math.min(10, Math.max(1, s)) - 1) / 9;
  return {
    /** Threshold as a multiple of the noise floor. */
    ratio: 12 - 8 * t,
    /** Absolute minimum threshold (full scale = 1). */
    absFloor: 0.03 * Math.pow(0.05, t),
  };
};

export class OnsetDetector {
  private readonly sr: number;
  private readonly hpA: number;
  private readonly fastRel: number;
  private readonly slowK: number;
  private readonly minGap: number;
  private readonly peakWin: number;
  private ratio = 8;
  private absFloor = 0.008;

  private hpPrevIn = 0;
  private hpPrevOut = 0;
  private fast = 0;
  private slow: number;
  private armed = true;
  private lastOnset = -Infinity;
  private pending: Onset | null = null;
  private band: DetectionBand = 'full';
  private lp: Biquad[] = [];
  private bandDelay = 0;

  constructor(opts: OnsetOptions) {
    this.sr = opts.sampleRate;
    const rc = 1 / (2 * Math.PI * 150);
    this.hpA = rc / (rc + 1 / this.sr);
    this.fastRel = Math.exp(-1 / (0.005 * this.sr));
    this.slowK = 1 - Math.exp(-1 / (0.25 * this.sr));
    this.minGap = Math.round(((opts.minGapMs ?? 35) / 1000) * this.sr);
    this.peakWin = Math.round(0.01 * this.sr);
    this.setSensitivity(opts.sensitivity ?? 5);
    this.setBand(opts.band ?? 'full');
    this.slow = this.absFloor / this.ratio;
  }

  setSensitivity(s: number): void {
    const p = sensitivityParams(s);
    this.ratio = p.ratio;
    this.absFloor = p.absFloor;
  }

  /** 6th-order Butterworth low-pass (three biquads) in 'low' mode. */
  setBand(band: DetectionBand): void {
    if (band === this.band && (band === 'full' || this.lp.length)) return;
    this.band = band;
    this.lp =
      band === 'low'
        ? [0.5176, 0.7071, 1.9319].map((q) => new Biquad(this.sr, LOW_BAND_CUTOFF_HZ, q))
        : [];
    this.bandDelay = band === 'low' ? Math.round((LOW_BAND_DELAY_MS / 1000) * this.sr) : 0;
  }

  /** Feed one block of samples starting at absolute frame `startFrame`. */
  process(block: ArrayLike<number>, startFrame: number): Onset[] {
    const out: Onset[] = [];
    for (let i = 0; i < block.length; i++) {
      const frame = startFrame + i;
      let x = block[i];
      for (const f of this.lp) x = f.process(x);
      const hp = this.hpA * (this.hpPrevOut + x - this.hpPrevIn);
      this.hpPrevIn = x;
      this.hpPrevOut = hp;
      const a = Math.abs(hp);

      this.fast = Math.max(a, this.fast * this.fastRel);
      const threshold = Math.max(this.absFloor, this.slow * this.ratio);
      if (this.fast < threshold) this.slow += (a - this.slow) * this.slowK; // learn the floor only while quiet

      if (this.pending) {
        if (a > this.pending.peak) this.pending.peak = a;
        if (frame - this.pending.frame >= this.peakWin) {
          out.push(this.pending);
          this.pending = null;
        }
      }

      if (this.fast < threshold * 0.5) this.armed = true;
      if (this.armed && this.fast >= threshold && frame - this.lastOnset >= this.minGap) {
        if (this.pending) out.push(this.pending);
        this.pending = { frame: frame - this.bandDelay, peak: a };
        this.lastOnset = frame;
        this.armed = false;
      }
    }
    return out;
  }
}
