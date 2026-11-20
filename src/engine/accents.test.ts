import { describe, expect, it } from 'vitest';
import { cycleAccent, defaultAccents, resizeAccents } from './accents';

describe('accent patterns', () => {
  it('cycles Accent → Normal → Soft → Muted → Accent', () => {
    expect(cycleAccent('accent')).toBe('normal');
    expect(cycleAccent('normal')).toBe('soft');
    expect(cycleAccent('soft')).toBe('mute');
    expect(cycleAccent('mute')).toBe('accent');
  });

  it.each([
    [4, 4, 'A N N N'],
    [3, 4, 'A N N'],
    [2, 4, 'A N'],
    [5, 4, 'A N N N N'],
    [6, 8, 'A S S N S S'],
    [7, 8, 'A S N S N S S'],
    [12, 8, 'A S S N S S N S S N S S'],
    [5, 8, 'A S S N S'],
    [3, 8, 'A N N'],
  ])('defaults for %i/%i are %s', (n, d, expected) => {
    const code = { accent: 'A', normal: 'N', soft: 'S', mute: 'M' } as const;
    expect(defaultAccents(n, d).map((a) => code[a]).join(' ')).toBe(expected);
  });

  it('keeps existing beats when growing the bar', () => {
    expect(resizeAccents(['accent', 'mute', 'soft'], 5, 4)).toEqual(['accent', 'mute', 'soft', 'normal', 'normal']);
  });

  it('truncates when shrinking the bar', () => {
    expect(resizeAccents(['soft', 'mute', 'soft', 'normal'], 2, 4)).toEqual(['soft', 'mute']);
  });
});
