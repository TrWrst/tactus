import { describe, expect, it } from 'vitest';
import { TapTempo } from './tapTempo';

const tapAt = (t: TapTempo, times: number[]) => times.map((x) => t.tap(x));

describe('TapTempo', () => {
  it('needs two taps', () => {
    const t = new TapTempo();
    expect(t.tap(0)).toBeNull();
    expect(t.tap(500)).toBe(120);
  });

  it('averages the intervals of a slightly uneven player', () => {
    const t = new TapTempo();
    const r = tapAt(t, [0, 510, 990, 1505, 2000]);
    expect(r.at(-1)).toBe(120); // 2000 ms / 4 intervals = 500 ms
  });

  it('only uses the last 8 taps', () => {
    const t = new TapTempo({ outlierRatio: 10 }); // disable outlier reset for this test
    // 4 slow taps (1000 ms), then 8 taps at 500 ms → window is purely the fast ones.
    const times = [0, 1000, 2000, 3000];
    for (let i = 1; i <= 8; i++) times.push(3000 + i * 500);
    const r = tapAt(t, times);
    expect(t.count).toBe(8);
    expect(r.at(-1)).toBe(120);
  });

  it('starts over after a long pause', () => {
    const t = new TapTempo();
    tapAt(t, [0, 500, 1000]);
    expect(t.tap(5000)).toBeNull();
    expect(t.tap(5750)).toBe(80);
  });

  it('restarts the average on a sudden tempo change', () => {
    const t = new TapTempo();
    tapAt(t, [0, 500, 1000, 1500]);
    const r = tapAt(t, [1750, 2000, 2250]);
    expect(r.at(-1)).toBe(240);
  });

  it('clamps to the supported range', () => {
    const t = new TapTempo();
    expect(tapAt(t, [0, 100, 200]).at(-1)).toBe(300);
  });

  it('ignores duplicate timestamps', () => {
    const t = new TapTempo();
    t.tap(0);
    expect(t.tap(0)).toBeNull();
  });
});
