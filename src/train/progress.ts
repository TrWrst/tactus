import { LESSONS, STAGES, isUnlocked, lessonById, type Lesson, type Skill } from './curriculum';
import type { LessonResult } from './scorer';

/** Training progress: pure reducer + storage. Everything stays on this device. */

export interface LessonRecord {
  bestStars: number;
  bestSdMs: number | null;
  bestScore: number;
  plays: number;
}

export interface HistoryEntry {
  /** ISO timestamp. */
  at: string;
  lessonId: string;
  skill: Skill;
  bpm: number;
  stars: number;
  score: number;
  sdMs: number;
  meanMs: number;
}

export type EdgePattern = 'quarters' | 'eighths' | 'sixteenths' | 'paradiddle';

export interface Progress {
  version: 1;
  xp: number;
  streak: { count: number; lastDay: string | null };
  lessons: Record<string, LessonRecord>;
  badges: Record<string, string>; // id → ISO date earned
  history: HistoryEntry[];
  edge: Partial<Record<EdgePattern, number>>; // best clean BPM
  warmupDay: string | null; // last day the warm-up bonus was paid
}

export const PROGRESS_KEY = 'tactus.progress.v1';
const HISTORY_CAP = 400;

export const emptyProgress = (): Progress => ({
  version: 1,
  xp: 0,
  streak: { count: 0, lastDay: null },
  lessons: {},
  badges: {},
  history: [],
  edge: {},
  warmupDay: null,
});

export const bestStarsOf = (p: Progress) => (id: string) => p.lessons[id]?.bestStars ?? 0;
export const lessonUnlocked = (p: Progress, l: Lesson) => isUnlocked(l, bestStarsOf(p));
export const totalStars = (p: Progress) => LESSONS.reduce((s, l) => s + (p.lessons[l.id]?.bestStars ?? 0), 0);
export const MAX_STARS = LESSONS.length * 3;

/** Level from XP: level n needs 150·n·(n−1)/2 XP (150, 450, 900, …). */
export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  while (xp >= (150 * (level + 1) * level) / 2) level++;
  const floor = (150 * level * (level - 1)) / 2;
  const next = (150 * (level + 1) * level) / 2;
  return { level, into: xp - floor, need: next - floor };
}

// ---------- Badges ----------

export interface Badge {
  id: string;
  title: string;
  how: string;
}

export const BADGES: Badge[] = [
  { id: 'first-steps', title: 'First steps', how: 'Finish your first lesson' },
  { id: 'locked-in', title: 'Locked in', how: '64+ notes in a lesson, none missed or over 25 ms off' },
  { id: 'centurion', title: 'Centurion', how: 'A combo of 100' },
  { id: 'ghost-clock', title: 'Ghost clock', how: 'Pass the inner clock test (1 bar on, 7 off) with 2 stars' },
  { id: 'slow-burn', title: 'Slow burn', how: 'Spread under ±15 ms at 50 BPM or slower' },
  { id: 'iron-hands', title: 'Iron hands', how: '3-minute endurance with drift under 2 ms per minute' },
  { id: 'perfectionist', title: 'Perfectionist', how: '3 stars on 10 lessons' },
  { id: 'week-of-time', title: 'Week of time', how: 'A 7-day practice streak' },
  { id: 'edge-120', title: 'Edge 120', how: 'Clean 16ths at 120 BPM in Find your edge' },
  { id: 'graduate', title: 'Graduate', how: 'Pass the final exam' },
];

// ---------- Days ----------

export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const prevDay = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
};

function bumpStreak(p: Progress, today: string): Progress['streak'] {
  const s = p.streak;
  if (s.lastDay === today) return s;
  return { count: s.lastDay === prevDay(today) ? s.count + 1 : 1, lastDay: today };
}

// ---------- Recording results ----------

export interface RecordOutcome {
  progress: Progress;
  xpGained: number;
  newBadges: Badge[];
  improvedStars: boolean;
  newBestSd: boolean;
}

/** XP for one result: base for showing up, plus accuracy, stars, and new stars. */
export function xpFor(r: LessonResult, prevBestStars: number): number {
  if (r.expected === 0) return 0;
  return Math.round(10 + r.score * 0.5 + r.stars * 10 + Math.max(0, r.stars - prevBestStars) * 25);
}

/**
 * Fold one finished lesson into progress. `lesson` may be a generated one
 * (warm-up / edge round), which earns XP and streak but no stars on the map.
 */
export function recordResult(p: Progress, lesson: Lesson, r: LessonResult, now: Date): RecordOutcome {
  const today = dayKey(now);
  const onMap = !!lessonById(lesson.id);
  const prev = p.lessons[lesson.id];
  const prevStars = prev?.bestStars ?? 0;
  const xpGained = xpFor(r, onMap ? prevStars : 3);
  const counts = r.expected > 0 && r.perfect + r.great + r.good + r.off > 0;

  const lessons = { ...p.lessons };
  let newBestSd = false;
  if (onMap && counts) {
    const sdOk = r.stars > 0 ? r.sdMs : null;
    newBestSd = sdOk !== null && (prev?.bestSdMs == null || sdOk < prev.bestSdMs);
    lessons[lesson.id] = {
      bestStars: Math.max(prevStars, r.stars),
      bestSdMs: newBestSd ? sdOk : (prev?.bestSdMs ?? null),
      bestScore: Math.max(prev?.bestScore ?? 0, r.score),
      plays: (prev?.plays ?? 0) + 1,
    };
  }

  const history = counts
    ? [
        ...p.history,
        { at: now.toISOString(), lessonId: lesson.id, skill: lesson.skill, bpm: lesson.bpm, stars: r.stars, score: r.score, sdMs: r.sdMs, meanMs: r.meanMs },
      ].slice(-HISTORY_CAP)
    : p.history;

  let next: Progress = {
    ...p,
    xp: p.xp + xpGained,
    streak: counts ? bumpStreak(p, today) : p.streak,
    lessons,
    history,
  };

  const earned = badgesEarned(next, lesson, r).filter((b) => !p.badges[b.id]);
  if (earned.length) {
    next = { ...next, badges: { ...next.badges, ...Object.fromEntries(earned.map((b) => [b.id, now.toISOString()])) } };
  }
  return { progress: next, xpGained, newBadges: earned, improvedStars: onMap && r.stars > prevStars, newBestSd };
}

function badgesEarned(p: Progress, lesson: Lesson, r: LessonResult): Badge[] {
  const ids = new Set<string>();
  const matched = r.perfect + r.great + r.good + r.off;
  if (matched > 0) ids.add('first-steps');
  if (r.expected >= 64 && r.miss === 0 && r.points.every((x) => Math.abs(x.ms) <= 25)) ids.add('locked-in');
  if (r.maxCombo >= 100) ids.add('centurion');
  if (lesson.id === 's3-test' && r.stars >= 2) ids.add('ghost-clock');
  if (lesson.bpm <= 50 && r.stars >= 1 && r.sdMs < 15) ids.add('slow-burn');
  if (lesson.bars * lesson.beatsPerBar * (60 / lesson.bpm) >= 170 && r.stars >= 1 && Math.abs(r.driftMsPerMin) < 2) ids.add('iron-hands');
  if (Object.values(p.lessons).filter((x) => x.bestStars >= 3).length >= 10) ids.add('perfectionist');
  if (p.streak.count >= 7) ids.add('week-of-time');
  if ((p.edge.sixteenths ?? 0) >= 120) ids.add('edge-120');
  if (lesson.id === 's5-test' && r.stars >= 2) ids.add('graduate');
  return BADGES.filter((b) => ids.has(b.id));
}

// ---------- Warm-up ----------

export const WARMUP_BONUS_XP = 30;

/** Skill with the worst recent spread (last 10 results per skill); defaults to pulse. */
export function weakestSkill(p: Progress): Skill {
  const bySkill = new Map<Skill, number[]>();
  for (const h of p.history) {
    if (!STAGES.some((s) => s.skill === h.skill)) continue;
    const xs = bySkill.get(h.skill) ?? [];
    xs.push(h.sdMs + (3 - h.stars) * 5); // stars break ties toward weaker skills
    bySkill.set(h.skill, xs.slice(-10));
  }
  let worst: Skill = 'pulse';
  let worstVal = -Infinity;
  for (const [skill, xs] of bySkill) {
    const v = xs.reduce((a, b) => a + b, 0) / xs.length;
    if (v > worstVal) {
      worstVal = v;
      worst = skill;
    }
  }
  return worst;
}

/** Three short rounds: pulse, the weakest unlocked skill, and a gap-click check. */
export function buildWarmup(p: Progress): Lesson[] {
  const base = { stage: 0, index: 0, beatsPerBar: 4, click: { sub: 1 as const } };
  const pulse: Lesson = { ...base, id: 'warmup-pulse', title: 'Warm-up 1 · Pulse', goal: 'Quarter notes to settle in.', skill: 'pulse', bpm: 90, play: { per: 1 }, bars: 6 };
  const weak = weakestSkill(p);
  const candidates = LESSONS.filter((l) => l.skill === weak && !l.test && lessonUnlocked(p, l));
  const pick = candidates[candidates.length - 1] ?? LESSONS[0];
  const focus: Lesson = { ...pick, id: 'warmup-focus', stage: 0, title: `Warm-up 2 · ${pick.title}`, bars: Math.min(pick.bars, 8) };
  const gap: Lesson = {
    ...base,
    id: 'warmup-gap',
    title: 'Warm-up 3 · Gap check',
    goal: 'Two bars on, two bars off.',
    skill: 'silence',
    bpm: 80,
    play: { per: 1 },
    bars: 8,
    practice: { muteMode: 'bars', playBars: 2, muteBars: 2 },
  };
  return [pulse, focus, gap];
}

// ---------- Find your edge (adaptive tempo staircase) ----------

export const EDGE_PATTERNS: { id: EdgePattern; title: string; per: number; sticking?: string }[] = [
  { id: 'quarters', title: 'Quarter notes', per: 1 },
  { id: 'eighths', title: 'Eighth notes', per: 2, sticking: 'R L R L R L R L' },
  { id: 'sixteenths', title: '16th notes', per: 4, sticking: 'R L R L R L R L R L R L R L R L' },
  { id: 'paradiddle', title: 'Paradiddles', per: 4, sticking: 'R L R R L R L L R L R R L R L L' },
];

export interface EdgeState {
  pattern: EdgePattern;
  bpm: number;
  best: number;
  fails: number;
  round: number;
  done: boolean;
}

export const EDGE_STEP = 4;
export const EDGE_MAX_FAILS = 3;
export const EDGE_MAX_ROUNDS = 25;

export function edgeStart(p: Progress, pattern: EdgePattern): EdgeState {
  const prevBest = p.edge[pattern];
  const bpm = prevBest ? Math.max(40, prevBest - 3 * EDGE_STEP) : 72;
  return { pattern, bpm, best: 0, fails: 0, round: 0, done: false };
}

/** A round passes with 2 stars (≥70% within ±35 ms and spread ≤ 15 ms). Faster on a pass, slower on a fail. */
export function edgeNext(s: EdgeState, stars: number): EdgeState {
  const passed = stars >= 2;
  const fails = s.fails + (passed ? 0 : 1);
  const round = s.round + 1;
  const best = passed ? Math.max(s.best, s.bpm) : s.best;
  const bpm = Math.min(300, Math.max(40, s.bpm + (passed ? EDGE_STEP : -EDGE_STEP)));
  return { ...s, bpm, best, fails, round, done: fails >= EDGE_MAX_FAILS || round >= EDGE_MAX_ROUNDS || (passed && s.bpm >= 300) };
}

export function edgeLesson(s: EdgeState): Lesson {
  const pat = EDGE_PATTERNS.find((x) => x.id === s.pattern)!;
  return {
    id: `edge-${s.pattern}`,
    stage: 0,
    index: s.round,
    title: `${pat.title} at ${s.bpm}`,
    goal: 'Play clean to go faster. Three misses ends the run.',
    skill: pat.per >= 4 ? 'rudiment' : 'pulse',
    bpm: s.bpm,
    beatsPerBar: 4,
    click: { sub: 1 },
    play: { per: pat.per, sticking: pat.sticking },
    bars: 4,
  };
}

export const recordEdge = (p: Progress, s: EdgeState): Progress =>
  s.best > (p.edge[s.pattern] ?? 0) ? { ...p, edge: { ...p.edge, [s.pattern]: s.best } } : p;

// ---------- Storage ----------

export function loadProgress(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Progress {
  try {
    const raw = storage?.getItem(PROGRESS_KEY);
    if (!raw) return emptyProgress();
    const d = JSON.parse(raw) as Partial<Progress>;
    if (d.version !== 1) return emptyProgress();
    const e = emptyProgress();
    return {
      ...e,
      xp: typeof d.xp === 'number' && d.xp >= 0 ? d.xp : 0,
      streak: d.streak && typeof d.streak.count === 'number' ? d.streak : e.streak,
      lessons: d.lessons && typeof d.lessons === 'object' ? d.lessons : {},
      badges: d.badges && typeof d.badges === 'object' ? d.badges : {},
      history: Array.isArray(d.history) ? d.history.slice(-HISTORY_CAP) : [],
      edge: d.edge && typeof d.edge === 'object' ? d.edge : {},
      warmupDay: typeof d.warmupDay === 'string' ? d.warmupDay : null,
    };
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(p: Progress, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* quota / private mode */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}
