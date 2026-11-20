import { LESSONS, STAGES, lessonsOfStage, type Lesson } from './curriculum';
import { EDGE_PATTERNS, dayKey, levelOf, lessonUnlocked, totalStars, MAX_STARS, WARMUP_BONUS_XP } from './progress';
import { Stars } from './shared';
import { LockIcon } from '../ui/icons';
import type { Plan } from './LessonScreen';
import type { ProgressApi } from './useProgress';

/** The lesson map: warm-up, find your edge, and the five stages. */
export function TrainTab({
  prog,
  calibrated,
  onPlan,
  onOpenSetup,
}: {
  prog: ProgressApi;
  calibrated: boolean;
  onPlan(p: Plan): void;
  onOpenSetup(): void;
}) {
  const p = prog.progress;
  const lvl = levelOf(p.xp);
  const nextUp = LESSONS.find((l) => lessonUnlocked(p, l) && (p.lessons[l.id]?.bestStars ?? 0) === 0);
  const warmupDone = p.warmupDay === dayKey(new Date());

  return (
    <div className="tab-page">
      <div className="train-head">
        <div>
          <div className="lvl">Level {lvl.level}</div>
          <div className="xpbar" role="progressbar" aria-label="Experience" aria-valuenow={lvl.into} aria-valuemin={0} aria-valuemax={lvl.need}>
            <span style={{ width: `${(lvl.into / lvl.need) * 100}%` }} />
          </div>
        </div>
        <div className="head-stats">
          <span title="Practice streak">{p.streak.count} day{p.streak.count === 1 ? '' : 's'}</span>
          <span title="Stars">{totalStars(p)}/{MAX_STARS} ★</span>
        </div>
      </div>

      {!calibrated && (
        <div className="callout">
          Lessons listen through the microphone. Set up and calibrate the accuracy meter first.
          <button type="button" className="wide-btn" onClick={onOpenSetup}>Set up and calibrate</button>
        </div>
      )}

      <div className="train-cards">
        <button type="button" className="train-card accent" onClick={() => onPlan({ kind: 'warmup' })}>
          <b>Daily warm-up</b>
          <span>3 rounds · ~3 min · {warmupDone ? 'done today' : `+${WARMUP_BONUS_XP} XP bonus`}</span>
        </button>
        {nextUp && (
          <button type="button" className="train-card" onClick={() => onPlan({ kind: 'lesson', lesson: nextUp })}>
            <b>Next up: {nextUp.title}</b>
            <span>Stage {nextUp.stage} · {nextUp.bpm} BPM</span>
          </button>
        )}
      </div>

      <section className="edge" aria-labelledby="edge-h">
        <h3 id="edge-h">Find your edge</h3>
        <p className="hint">The tempo rises while you stay clean. Finds your top tempo.</p>
        <div className="edge-grid">
          {EDGE_PATTERNS.map((e) => (
            <button key={e.id} type="button" className="edge-btn" onClick={() => onPlan({ kind: 'edge', pattern: e.id })}>
              <span>{e.title}</span>
              <b>{p.edge[e.id] ? `${p.edge[e.id]} BPM` : '—'}</b>
            </button>
          ))}
        </div>
      </section>

      {STAGES.map((st) => {
        const lessons = lessonsOfStage(st.n);
        const open = lessonUnlocked(p, lessons[0]);
        const stars = lessons.reduce((s, l) => s + (p.lessons[l.id]?.bestStars ?? 0), 0);
        return (
          <section key={st.n} className={`stage ${open ? '' : 'locked'}`} aria-labelledby={`st-${st.n}`}>
            <div className="stage-head">
              <h3 id={`st-${st.n}`}>
                Stage {st.n} · {st.title}
              </h3>
              <span className="hint">{stars}/{lessons.length * 3} ★</span>
            </div>
            <p className="hint">{open ? st.blurb : `Pass the stage ${st.n - 1} test with 2 stars to open.`}</p>
            <ul className="lesson-list">
              {lessons.map((l) => (
                <LessonRow key={l.id} lesson={l} prog={prog} isNext={nextUp?.id === l.id} onPlan={onPlan} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function LessonRow({ lesson, prog, isNext, onPlan }: { lesson: Lesson; prog: ProgressApi; isNext: boolean; onPlan(p: Plan): void }) {
  const p = prog.progress;
  const unlocked = lessonUnlocked(p, lesson);
  const stars = p.lessons[lesson.id]?.bestStars ?? 0;
  const status = !unlocked ? 'locked' : stars > 0 ? 'done' : 'open';
  return (
    <li>
      <button
        type="button"
        className={`lesson-row ${status} ${isNext ? 'next' : ''} ${lesson.test ? 'test' : ''}`}
        disabled={!unlocked}
        onClick={() => onPlan({ kind: 'lesson', lesson })}
        aria-label={`${lesson.title}, ${lesson.bpm} BPM, ${!unlocked ? 'locked' : `${stars} of 3 stars`}`}
      >
        <span className={`lesson-dot ${status}`} aria-hidden="true">
          {status === 'locked' ? <LockIcon width={14} height={14} /> : status === 'done' ? '✓' : lesson.test ? '★' : '▶'}
        </span>
        <span className="lesson-name">
          {lesson.title}
          <small>{lesson.bpm} BPM{isNext ? ' · next up' : ''}</small>
        </span>
        {unlocked && <Stars n={stars} size="sm" />}
      </button>
    </li>
  );
}
