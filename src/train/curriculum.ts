import type { PracticeSettings } from '../engine/practice';
import type { AccentLevel, Subdivision } from '../engine/types';

/**
 * Timing curriculum: 5 stages × (6 lessons + a stage test). Original material.
 * Rudiment names follow the Percussive Arts Society's public list of International
 * Drum Rudiments; the stage-by-stage tempo/subdivision progression is modelled on
 * graded drum exams; stage 3 uses the widely taught "gap click" method.
 */

export type Skill = 'pulse' | 'subdivision' | 'silence' | 'rudiment' | 'extreme';

export interface Lesson {
  id: string;
  stage: number;
  /** 0-based position in the stage; the test is last. */
  index: number;
  title: string;
  /** One line shown before playing. */
  goal: string;
  tip?: string;
  skill: Skill;
  bpm: number;
  beatsPerBar: number;
  click: {
    /** Clicks per beat. */
    sub: Subdivision;
    /** One code per beat: A accent, N normal, S soft, - silent. Default "A N N …". */
    accents?: string;
  };
  play: {
    /** Notes the player should play per beat; an array alternates bar by bar. */
    per: number | number[];
    /** Optional per-bar mask over the notes ("x" play, "." rest). */
    mask?: string;
    /** Shift of the played notes, as a fraction of a beat (0.5 = on the "and"). */
    offset?: number;
    /** Sticking guide, e.g. "R L R R L R L L". Not scored. */
    sticking?: string;
  };
  /** Scored bars (after the count-in). */
  bars: number;
  countIn?: 1 | 2;
  /** Trainer settings while the lesson runs (gap click, random mutes, tempo ramp). */
  practice?: Partial<PracticeSettings>;
  test?: boolean;
}

export interface Stage {
  n: number;
  title: string;
  blurb: string;
  skill: Skill;
}

export const STAGES: Stage[] = [
  { n: 1, title: 'Pulse', blurb: 'Steady quarter and eighth notes. Land every beat.', skill: 'pulse' },
  { n: 2, title: 'Subdivide', blurb: 'Clean 8ths, triplets and 16ths with less help from the click.', skill: 'subdivision' },
  { n: 3, title: 'Inner clock', blurb: 'The click goes quiet. Keep the time yourself.', skill: 'silence' },
  { n: 4, title: 'Rudiments in time', blurb: 'Classic rudiments, scored as perfectly even notes.', skill: 'rudiment' },
  { n: 5, title: 'Extremes', blurb: 'Very slow, fast, off-beat, ramping and long.', skill: 'extreme' },
];

type Def = Omit<Lesson, 'id' | 'stage' | 'index' | 'skill'> & { id?: string };

const SINGLES = 'R L R L R L R L R L R L R L R L';
const DOUBLES = 'R R L L R R L L R R L L R R L L';
const PARADIDDLE = 'R L R R L R L L R L R R L R L L';
const PARADIDDLE_DIDDLE = 'R L R R L L R L R R L L R L R R L L R L R R L L';

const DEFS: Record<number, Def[]> = {
  1: [
    { title: 'First pulse', goal: 'Play quarter notes with the click.', bpm: 80, beatsPerBar: 4, click: { sub: 1 }, play: { per: 1 }, bars: 8 },
    { title: 'Steady at 100', goal: 'Quarter notes, a little faster.', bpm: 100, beatsPerBar: 4, click: { sub: 1 }, play: { per: 1 }, bars: 8 },
    {
      title: 'Slow and steady',
      goal: 'Quarter notes at 60. Slow is harder than it sounds.',
      tip: 'Count "1 e & a" in your head to fill the space.',
      bpm: 60,
      beatsPerBar: 4,
      click: { sub: 1 },
      play: { per: 1 },
      bars: 8,
    },
    { title: 'Waltz time', goal: 'Quarter notes in 3/4.', bpm: 90, beatsPerBar: 3, click: { sub: 1 }, play: { per: 1 }, bars: 8 },
    { title: 'Eighth notes', goal: 'Two even notes per click.', bpm: 80, beatsPerBar: 4, click: { sub: 2 }, play: { per: 2, sticking: 'R L R L R L R L' }, bars: 8 },
    { title: 'Hold it longer', goal: '16 bars of quarter notes without drifting.', bpm: 90, beatsPerBar: 4, click: { sub: 1 }, play: { per: 1 }, bars: 16 },
    {
      title: 'Stage test: Pulse',
      goal: 'Eighth notes at 90 with only quarter-note clicks.',
      bpm: 90,
      beatsPerBar: 4,
      click: { sub: 1 },
      play: { per: 2, sticking: 'R L R L R L R L' },
      bars: 12,
      test: true,
    },
  ],
  2: [
    { title: 'Eighths alone', goal: 'Eighth notes; the click only gives quarters.', bpm: 80, beatsPerBar: 4, click: { sub: 1 }, play: { per: 2, sticking: 'R L R L R L R L' }, bars: 8 },
    { title: 'Triplet grid', goal: 'Three even notes per beat.', bpm: 70, beatsPerBar: 4, click: { sub: 3 }, play: { per: 3, sticking: 'R L R L R L R L R L R L' }, bars: 8 },
    { title: '16ths at 70', goal: 'Four even notes per beat.', bpm: 70, beatsPerBar: 4, click: { sub: 2 }, play: { per: 4, sticking: SINGLES }, bars: 8 },
    {
      title: 'Switch 8ths and triplets',
      goal: 'One bar of 8ths, one bar of triplets, and so on.',
      tip: 'Say "1 & 2 &" then "1 trip-let 2 trip-let".',
      bpm: 70,
      beatsPerBar: 4,
      click: { sub: 1 },
      play: { per: [2, 3] },
      bars: 8,
    },
    { title: '16ths at 80', goal: '16th notes with quarter-note clicks.', bpm: 80, beatsPerBar: 4, click: { sub: 1 }, play: { per: 4, sticking: SINGLES }, bars: 8 },
    {
      title: 'Accents, no rushing',
      goal: '16ths, accenting each beat. Accents tend to rush; keep them on the grid.',
      bpm: 80,
      beatsPerBar: 4,
      click: { sub: 1 },
      play: { per: 4, sticking: '> R L R L > R L R L > R L R L > R L R L' },
      bars: 8,
    },
    { title: 'Stage test: Subdivide', goal: '16th notes at 90, quarter-note clicks.', bpm: 90, beatsPerBar: 4, click: { sub: 1 }, play: { per: 4, sticking: SINGLES }, bars: 12, test: true },
  ],
  3: [
    {
      title: 'Gap: 3 on, 1 off',
      goal: 'Three bars with the click, one bar of silence. Keep playing through it.',
      bpm: 80,
      beatsPerBar: 4,
      click: { sub: 1 },
      play: { per: 1 },
      bars: 16,
      practice: { muteMode: 'bars', playBars: 3, muteBars: 1 },
    },
    { title: 'Gap: 2 on, 2 off', goal: 'Two bars on, two bars silent.', bpm: 80, beatsPerBar: 4, click: { sub: 1 }, play: { per: 1 }, bars: 16, practice: { muteMode: 'bars', playBars: 2, muteBars: 2 } },
    { title: 'Gap: 1 on, 3 off', goal: 'One bar on, three bars silent.', bpm: 80, beatsPerBar: 4, click: { sub: 1 }, play: { per: 1 }, bars: 16, practice: { muteMode: 'bars', playBars: 1, muteBars: 3 } },
    {
      title: 'Click on 2 and 4',
      goal: 'The click only plays beats 2 and 4. Play all four beats.',
      bpm: 80,
      beatsPerBar: 4,
      click: { sub: 1, accents: '- A - A' },
      play: { per: 1 },
      bars: 8,
    },
    { title: 'Click on 1 only', goal: 'One click per bar. Play all four beats.', bpm: 80, beatsPerBar: 4, click: { sub: 1, accents: 'A - - -' }, play: { per: 1 }, bars: 8 },
    {
      title: 'Random silence',
      goal: 'Eighth notes; a quarter of the clicks disappear at random.',
      bpm: 90,
      beatsPerBar: 4,
      click: { sub: 1 },
      play: { per: 2, sticking: 'R L R L R L R L' },
      bars: 12,
      practice: { muteMode: 'random', randomPct: 25 },
    },
    {
      title: 'Stage test: Inner clock',
      goal: 'One bar of click, seven bars of silence, twice.',
      bpm: 80,
      beatsPerBar: 4,
      click: { sub: 1 },
      play: { per: 1 },
      bars: 16,
      practice: { muteMode: 'bars', playBars: 1, muteBars: 7 },
      test: true,
    },
  ],
  4: [
    { title: 'Single strokes', goal: 'Single stroke roll as even 16ths.', bpm: 70, beatsPerBar: 4, click: { sub: 1 }, play: { per: 4, sticking: SINGLES }, bars: 8 },
    { title: 'Double strokes', goal: 'Double stroke roll: both notes of each pair equally spaced.', tip: 'The second note of a double tends to come early.', bpm: 70, beatsPerBar: 4, click: { sub: 1 }, play: { per: 4, sticking: DOUBLES }, bars: 8 },
    { title: 'Single paradiddle', goal: 'Paradiddles as even 16ths.', bpm: 70, beatsPerBar: 4, click: { sub: 1 }, play: { per: 4, sticking: PARADIDDLE }, bars: 8 },
    { title: 'Paradiddle-diddle', goal: 'Six notes per beat (sextuplets).', bpm: 60, beatsPerBar: 4, click: { sub: 1 }, play: { per: 6, sticking: PARADIDDLE_DIDDLE }, bars: 8 },
    {
      title: 'Displaced accents',
      goal: '16ths with an accent every third note. Accents must not pull the time.',
      bpm: 75,
      beatsPerBar: 4,
      click: { sub: 1 },
      play: { per: 4, sticking: '>R L R >L R L >R L R >L R L >R L R >L' },
      bars: 8,
    },
    { title: 'Singles at 90', goal: 'Single strokes, faster.', bpm: 90, beatsPerBar: 4, click: { sub: 1 }, play: { per: 4, sticking: SINGLES }, bars: 8 },
    { title: 'Stage test: Rudiments', goal: 'Paradiddles at 85.', bpm: 85, beatsPerBar: 4, click: { sub: 1 }, play: { per: 4, sticking: PARADIDDLE }, bars: 12, test: true },
  ],
  5: [
    { title: 'Very slow: 50', goal: 'Quarter notes at 50 BPM.', tip: 'Subdivide in your head; let your whole body feel the space.', bpm: 50, beatsPerBar: 4, click: { sub: 1 }, play: { per: 1 }, bars: 8 },
    { title: 'Ultra slow: 40', goal: 'Quarter notes at 40 BPM. Every gap is 1.5 seconds.', bpm: 40, beatsPerBar: 4, click: { sub: 1 }, play: { per: 1 }, bars: 6 },
    { title: 'Fast 16ths', goal: 'Single strokes at 120.', bpm: 120, beatsPerBar: 4, click: { sub: 1 }, play: { per: 4, sticking: SINGLES }, bars: 8 },
    {
      title: 'Follow the ramp',
      goal: 'Quarter notes while the tempo climbs from 80 to 120.',
      bpm: 80,
      beatsPerBar: 4,
      click: { sub: 1 },
      play: { per: 1 },
      bars: 22,
      practice: { rampOn: true, rampStep: 4, rampEvery: 2, rampUnit: 'bars', rampTarget: 120, rampEnd: 'hold' },
    },
    {
      title: 'Off-beat click',
      goal: 'Treat every click as the "and": play exactly halfway between clicks.',
      bpm: 90,
      beatsPerBar: 4,
      click: { sub: 1, accents: 'N N N N' },
      play: { per: 1, offset: 0.5 },
      bars: 8,
    },
    { title: 'Endurance: 3 minutes', goal: 'Eighth notes at 90 for three minutes. Watch your drift.', bpm: 90, beatsPerBar: 4, click: { sub: 1 }, play: { per: 2, sticking: 'R L R L R L R L' }, bars: 68 },
    {
      title: 'Final exam',
      goal: '16ths at 100: two bars with the click, two bars without.',
      bpm: 100,
      beatsPerBar: 4,
      click: { sub: 1 },
      play: { per: 4, sticking: SINGLES },
      bars: 16,
      practice: { muteMode: 'bars', playBars: 2, muteBars: 2 },
      test: true,
    },
  ],
};

export const LESSONS: Lesson[] = STAGES.flatMap((st) =>
  DEFS[st.n].map((d, index) => ({
    ...d,
    id: d.id ?? `s${st.n}-${d.test ? 'test' : index + 1}`,
    stage: st.n,
    index,
    skill: st.skill,
  })),
);

export const lessonById = (id: string): Lesson | undefined => LESSONS.find((l) => l.id === id);
export const lessonsOfStage = (n: number): Lesson[] => LESSONS.filter((l) => l.stage === n);

export const accentsFromCode = (code: string | undefined, beats: number): AccentLevel[] => {
  const map: Record<string, AccentLevel> = { A: 'accent', N: 'normal', S: 'soft', '-': 'mute' };
  const parts = (code ?? '').split(/\s+/).filter(Boolean);
  return Array.from({ length: beats }, (_, i) => map[parts[i] ?? (i === 0 ? 'A' : 'N')] ?? 'normal');
};

export const notesPerBeat = (lesson: Lesson, bar: number): number => {
  const p = lesson.play.per;
  return Array.isArray(p) ? p[((bar % p.length) + p.length) % p.length] : p;
};

/** Seconds of scored playing at the lesson's starting tempo. */
export const lessonSeconds = (l: Lesson): number => (l.bars * l.beatsPerBar * 60) / l.bpm;

/** Stars needed on the previous lesson to unlock the next one. */
export const STARS_TO_UNLOCK = 1;
/** Stars needed on a stage test to open the next stage. */
export const STARS_TO_PASS_TEST = 2;

/** Is the lesson playable, given the best stars per lesson id so far? */
export function isUnlocked(lesson: Lesson, bestStars: (id: string) => number): boolean {
  if (lesson.stage === 1 && lesson.index === 0) return true;
  if (lesson.index === 0) {
    const prevTest = LESSONS.find((l) => l.stage === lesson.stage - 1 && l.test);
    return !!prevTest && bestStars(prevTest.id) >= STARS_TO_PASS_TEST;
  }
  const prev = LESSONS.find((l) => l.stage === lesson.stage && l.index === lesson.index - 1)!;
  return bestStars(prev.id) >= STARS_TO_UNLOCK;
}
