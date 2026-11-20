import { describe, expect, it } from 'vitest';
import { JitterStats } from './stats';

describe('JitterStats', () => {
  it('measures tick intervals and spread', () => {
    const s = new JitterStats();
    [0, 25, 50, 80, 100].forEach((t) => s.tick(t));
    const r = s.report();
    expect(r.ticks).toBe(4);
    expect(r.tickMean).toBe(25);
    expect(r.tickMax).toBe(30);
    expect(r.tickStd).toBeCloseTo(Math.sqrt((0 + 0 + 25 + 25) / 4));
  });

  it('counts late events and the minimum margin', () => {
    const s = new JitterStats();
    [0.1, 0.05, -0.002].forEach((m) => s.event(m));
    const r = s.report();
    expect(r.late).toBe(1);
    expect(r.marginMin).toBeCloseTo(-2);
    expect(r.scheduled).toBe(3);
  });

  it('does not count the gap across a pause', () => {
    const s = new JitterStats();
    s.tick(0); s.tick(25); s.pause(); s.tick(10_000); s.tick(10_025);
    expect(s.report().tickMax).toBe(25);
  });
});
