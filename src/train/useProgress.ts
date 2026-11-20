import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lesson } from './curriculum';
import {
  WARMUP_BONUS_XP,
  dayKey,
  emptyProgress,
  loadProgress,
  recordEdge,
  recordResult,
  saveProgress,
  type EdgeState,
  type Progress,
  type RecordOutcome,
} from './progress';
import type { LessonResult } from './scorer';

/** Training progress state, persisted to localStorage on every change. */
export function useProgress() {
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const ref = useRef(progress);
  ref.current = progress;

  useEffect(() => saveProgress(progress), [progress]);

  const commit = (p: Progress) => {
    ref.current = p;
    setProgress(p);
  };

  const record = useCallback((lesson: Lesson, result: LessonResult): RecordOutcome => {
    const o = recordResult(ref.current, lesson, result, new Date());
    commit(o.progress);
    return o;
  }, []);

  /** Pays the daily warm-up bonus once per day; returns the XP paid. */
  const warmupBonus = useCallback((): number => {
    const today = dayKey(new Date());
    if (ref.current.warmupDay === today) return 0;
    commit({ ...ref.current, xp: ref.current.xp + WARMUP_BONUS_XP, warmupDay: today });
    return WARMUP_BONUS_XP;
  }, []);

  const finishEdge = useCallback((s: EdgeState): { record: boolean } => {
    const before = ref.current.edge[s.pattern] ?? 0;
    commit(recordEdge(ref.current, s));
    return { record: s.best > before };
  }, []);

  const reset = useCallback(() => commit(emptyProgress()), []);

  return { progress, record, warmupBonus, finishEdge, reset };
}

export type ProgressApi = ReturnType<typeof useProgress>;
