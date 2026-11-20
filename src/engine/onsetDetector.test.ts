import { describe, expect, it } from 'vitest';
import { OnsetDetector, type DetectionBand } from './onsetDetector';
import { TONE_BASE_HZ } from './sounds';
import { seededRandom } from './practice';

const SR = 48000;

/** Background noise plus decaying noise bursts ("hits") at the given frames. */
function synth(lengthSec: number, hits: { frame: number; amp: number }[], noise = 0.002, seed = 3): Float32Array {
  const r = seededRandom(seed);
  const buf = new Float32Array(Math.round(lengthSec * SR));
  for (let i = 0; i < buf.length; i++) buf[i] = (r() * 2 - 1) * noise;
  for (const h of hits) {
    const len = Math.round(0.08 * SR);
    for (let i = 0; i < len && h.frame + i < buf.length; i++) {
      buf[h.frame + i] += (r() * 2 - 1) * h.amp * Math.exp(-i / (0.012 * SR));
    }
  }
  return buf;
}

function detect(buf: Float32Array, sensitivity = 5, block = 128, band: DetectionBand = 'full') {
  const d = new OnsetDetector({ sampleRate: SR, sensitivity, band });
  const out = [];
  for (let i = 0; i < buf.length; i += block) out.push(...d.process(buf.subarray(i, i + block), i));
  return out;
}

describe('OnsetDetector', () => {
  it('finds each hit within 1 ms of its attack, across block boundaries', () => {
    const frames = [12_000, 30_127, 48_000, 60_001, 84_500];
    const found = detect(synth(2, frames.map((frame) => ({ frame, amp: 0.4 }))));
    expect(found.length).toBe(frames.length);
    found.forEach((o, i) => expect(Math.abs(o.frame - frames[i])).toBeLessThanOrEqual(SR / 1000));
  });

  it('reports a peak proportional to hit strength', () => {
    const found = detect(synth(1, [{ frame: 6000, amp: 0.1 }, { frame: 30000, amp: 0.5 }]));
    expect(found[1].peak).toBeGreaterThan(found[0].peak * 2.5);
  });

  it('ignores background noise', () => {
    expect(detect(synth(2, [], 0.004))).toEqual([]);
  });

  it('does not double-trigger on a ringing hit', () => {
    const found = detect(synth(1, [{ frame: 10000, amp: 0.8 }]));
    expect(found.length).toBe(1);
  });

  it('separates fast notes (16ths at 200 BPM = 75 ms)', () => {
    const frames = Array.from({ length: 8 }, (_, i) => 5000 + Math.round(i * 0.075 * SR));
    expect(detect(synth(1, frames.map((frame) => ({ frame, amp: 0.3 })))).length).toBe(8);
  });

  it('higher sensitivity catches quiet hits that low sensitivity misses', () => {
    const buf = synth(1, [{ frame: 10000, amp: 0.012 }]);
    expect(detect(buf, 1)).toEqual([]);
    expect(detect(buf, 9).length).toBe(1);
  });
});

/** The speaker-mode click as it would reach the mic: sine, 4 ms raised-cosine attack, ~18 ms decay. */
function addTone(buf: Float32Array, frame: number, freq: number, amp: number) {
  const att = 0.004 * SR;
  for (let i = 0; i < 0.12 * SR && frame + i < buf.length; i++) {
    const env = i < att ? 0.5 * (1 - Math.cos((Math.PI * i) / att)) : Math.exp(-(i - att) / (0.018 * SR));
    buf[frame + i] += amp * env * Math.sin((2 * Math.PI * freq * i) / SR);
  }
}

describe('speaker mode (low band)', () => {
  // Every voice pitch the tone can have: sub 0.84 … count-in accent 1.89.
  const pitches = [0.84, 1, 1.26, 1.5, 1.89].map((p) => TONE_BASE_HZ * p);

  it('ignores loud tone clicks at every voice pitch', () => {
    const buf = synth(2, []);
    pitches.forEach((f, i) => addTone(buf, 4000 + i * 18000, f, 0.8));
    expect(detect(buf, 8, 128, 'low')).toEqual([]);
    expect(detect(buf, 8, 128, 'full').length).toBe(pitches.length); // proof the clicks are there
  });

  it('still finds hits that land on top of a click, within 1 ms', () => {
    const frames = [10000, 34000, 58000, 82000];
    const buf = synth(2, frames.map((frame) => ({ frame: frame + 96, amp: 0.3 }))); // hits 2 ms after each click
    frames.forEach((f) => addTone(buf, f, TONE_BASE_HZ, 0.8));
    const found = detect(buf, 5, 128, 'low');
    expect(found.length).toBe(frames.length);
    found.forEach((o, i) => expect(Math.abs(o.frame - (frames[i] + 96))).toBeLessThanOrEqual(SR / 1000));
  });

  it('agrees with full-band timing (filter delay compensated)', () => {
    const frames = [12000, 40000, 70000];
    const buf = synth(2, frames.map((frame) => ({ frame, amp: 0.3 })));
    const lo = detect(buf, 5, 128, 'low');
    const fu = detect(buf, 5, 128, 'full');
    lo.forEach((o, i) => expect(Math.abs(o.frame - fu[i].frame)).toBeLessThanOrEqual(SR / 1000));
  });
});
