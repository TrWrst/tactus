import type { AccentLevel } from './types';

export const ACCENT_CYCLE: AccentLevel[] = ['accent', 'normal', 'soft', 'mute'];

export const ACCENT_LABELS: Record<AccentLevel, string> = {
  accent: 'Accent',
  normal: 'Normal',
  soft: 'Soft',
  mute: 'Muted',
};

/** Tap behaviour: Accent → Normal → Soft → Muted → Accent. */
export const cycleAccent = (level: AccentLevel): AccentLevel =>
  ACCENT_CYCLE[(ACCENT_CYCLE.indexOf(level) + 1) % ACCENT_CYCLE.length];

/**
 * Beat groupings used for default accents. Compound / odd meters group the
 * beat-unit notes so the start of each group gets a secondary (normal) accent.
 */
export function defaultGrouping(beatsPerBar: number, beatUnit: number): number[] {
  if (beatUnit >= 8 && beatsPerBar > 3) {
    if (beatsPerBar % 3 === 0) return Array(beatsPerBar / 3).fill(3); // 6/8, 9/8, 12/8
    if (beatsPerBar === 5) return [3, 2];
    if (beatsPerBar === 7) return [2, 2, 3];
    // Generic: groups of 2 with a trailing 3 if odd.
    const groups: number[] = Array(Math.floor(beatsPerBar / 2)).fill(2);
    if (beatsPerBar % 2 === 1) groups[groups.length - 1] = 3;
    return groups;
  }
  return Array(beatsPerBar).fill(1);
}

export function defaultAccents(beatsPerBar: number, beatUnit: number): AccentLevel[] {
  const groups = defaultGrouping(beatsPerBar, beatUnit);
  const grouped = groups.some((g) => g > 1);
  const out: AccentLevel[] = [];
  groups.forEach((size) => {
    for (let i = 0; i < size; i++) out.push(i === 0 ? 'normal' : grouped ? 'soft' : 'normal');
  });
  out[0] = 'accent';
  return out;
}

export const isValidAccent = (x: unknown): x is AccentLevel =>
  typeof x === 'string' && (ACCENT_CYCLE as string[]).includes(x);

/**
 * Keep the user's pattern when the bar length changes: existing beats keep their
 * level, new beats get the default level for the new meter.
 */
export function resizeAccents(current: AccentLevel[], beatsPerBar: number, beatUnit: number): AccentLevel[] {
  const defaults = defaultAccents(beatsPerBar, beatUnit);
  return defaults.map((d, i) => (i < current.length && isValidAccent(current[i]) ? current[i] : d));
}
