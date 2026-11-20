import { useEffect, useRef, useState } from 'react';
import type { Accuracy } from '../state/useAccuracy';
import type { Metronome } from '../state/useMetronome';
import { CloseIcon } from '../ui/icons';
import { LESSONS, lessonSeconds, type Lesson } from './curriculum';
import {
  EDGE_PATTERNS,
  buildWarmup,
  dayKey,
  edgeLesson,
  edgeNext,
  edgeStart,
  lessonUnlocked,
  type Badge,
  type EdgePattern,
  type EdgeState,
  type RecordOutcome,
} from './progress';
import { WINDOWS, type LessonResult } from './scorer';
import { JUDGMENT_LABEL, MiniTimeline, Stars, fmtMs, nextStarHint } from './shared';
import { useLessonRunner } from './useLessonRunner';
import type { ProgressApi } from './useProgress';

export type Plan = { kind: 'lesson'; lesson: Lesson } | { kind: 'warmup' } | { kind: 'edge'; pattern: EdgePattern };

interface Props {
  plan: Plan;
  m: Metronome;
  acc: Accuracy;
  prog: ProgressApi;
  onExit(): void;
  onOpenSetup(): void;
  onPlan(p: Plan): void;
}

interface Round {
  lesson: Lesson;
  result: LessonResult;
  outcome: RecordOutcome;
  note?: string;
}

type Step = 'intro' | 'run' | 'between' | 'result';

const clickText = (l: Lesson) => {
  const code = l.click.accents?.split(/\s+/) ?? [];
  const silentBeats = code.map((c, i) => (c === '-' ? i : -1)).filter((i) => i >= 0);
  const sub = l.click.sub > 1 ? `, ${l.click.sub} clicks per beat` : '';
  if (l.play.offset) return 'Click on every beat. You play halfway between.';
  if (silentBeats.length) return `Click only on beat${code.length - silentBeats.length > 1 ? 's' : ''} ${code.map((c, i) => (c === '-' ? null : i + 1)).filter(Boolean).join(' and ')}.`;
  const pr = l.practice;
  if (pr?.muteMode === 'bars') return `Click for ${pr.playBars} bar${pr.playBars === 1 ? '' : 's'}, then silent for ${pr.muteBars}.`;
  if (pr?.muteMode === 'random') return `Click on every beat, ${pr.randomPct}% randomly silent.`;
  if (pr?.rampOn) return `Click speeds up by ${pr.rampStep} BPM every ${pr.rampEvery} bars, to ${pr.rampTarget}.`;
  return `Click on every beat${sub}.`;
};

const playText = (l: Lesson) => {
  const per = Array.isArray(l.play.per) ? l.play.per : [l.play.per];
  const name = (n: number) => ({ 1: 'quarter notes', 2: '8th notes', 3: 'triplets', 4: '16th notes', 6: 'sextuplets' })[n] ?? `${n} per beat`;
  const txt = per.length > 1 ? `Alternate ${per.map(name).join(' and ')}, one bar each.` : `${name(per[0])}.`;
  return txt.charAt(0).toUpperCase() + txt.slice(1);
};

export function LessonScreen({ plan, m, acc, prog, onExit, onOpenSetup, onPlan }: Props) {
  const runner = useLessonRunner(m, acc);
  const [step, setStep] = useState<Step>('intro');
  const [rounds, setRounds] = useState<Round[]>([]);
  const [edge, setEdge] = useState<EdgeState | null>(null);
  const [bonus, setBonus] = useState(0);
  const [edgeRecord, setEdgeRecord] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const cancelled = useRef(false);
  const calibrated = m.settings.meter.latencyMs !== null;

  const warmup = useRef<Lesson[]>(plan.kind === 'warmup' ? buildWarmup(prog.progress) : []);
  const firstLesson: Lesson =
    plan.kind === 'lesson' ? plan.lesson : plan.kind === 'warmup' ? warmup.current[0] : edgeLesson(edgeStart(prog.progress, plan.pattern));

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const wait = (sec: number) =>
    new Promise<boolean>((resolve) => {
      setCountdown(sec);
      let left = sec;
      const id = window.setInterval(() => {
        left--;
        setCountdown(left);
        if (cancelled.current) {
          window.clearInterval(id);
          resolve(false);
        } else if (left <= 0) {
          window.clearInterval(id);
          resolve(true);
        }
      }, 1000);
    });

  const start = async () => {
    cancelled.current = false;
    setRounds([]);
    setBonus(0);
    setEdgeRecord(false);
    if (plan.kind === 'lesson') {
      setStep('run');
      const r = await runner.run(plan.lesson);
      if (!r) return setStep('intro');
      setRounds([{ lesson: plan.lesson, result: r, outcome: prog.record(plan.lesson, r) }]);
      setStep('result');
    } else if (plan.kind === 'warmup') {
      const done: Round[] = [];
      for (let i = 0; i < warmup.current.length; i++) {
        setStep('run');
        const l = warmup.current[i];
        const r = await runner.run(l);
        if (!r || cancelled.current) return setStep(done.length ? 'result' : 'intro');
        done.push({ lesson: l, result: r, outcome: prog.record(l, r) });
        setRounds([...done]);
        if (i < warmup.current.length - 1) {
          setStep('between');
          if (!(await wait(4))) return setStep('result');
        }
      }
      setBonus(prog.warmupBonus());
      setStep('result');
    } else {
      let s = edgeStart(prog.progress, plan.pattern);
      setEdge(s);
      const done: Round[] = [];
      while (!s.done) {
        setStep('run');
        const l = edgeLesson(s);
        const r = await runner.run(l);
        if (!r || cancelled.current) break;
        const next = edgeNext(s, r.stars);
        done.push({ lesson: l, result: r, outcome: prog.record(l, r), note: r.stars >= 2 ? `✓ Clean at ${s.bpm}` : `✗ Too loose at ${s.bpm}` });
        setRounds([...done]);
        s = next;
        setEdge(s);
        if (!s.done) {
          setStep('between');
          if (!(await wait(3))) break;
        }
      }
      if (done.length) setEdgeRecord(prog.finishEdge(s).record);
      setStep(done.length ? 'result' : 'intro');
    }
  };

  const quit = () => {
    cancelled.current = true;
    runner.abort();
  };

  const title =
    plan.kind === 'lesson' ? plan.lesson.title : plan.kind === 'warmup' ? 'Daily warm-up' : `Find your edge · ${EDGE_PATTERNS.find((p) => p.id === plan.pattern)!.title}`;

  return (
    <div className="lesson-screen" role="dialog" aria-modal="true" aria-label={title}>
      <header className="lesson-top">
        <button type="button" className="icon-btn" aria-label={step === 'run' ? 'Quit lesson' : 'Close'} onClick={step === 'run' || step === 'between' ? quit : onExit}>
          <CloseIcon />
        </button>
        <h2>{title}</h2>
        <span className="lesson-top-meta">
          {plan.kind === 'warmup' && step !== 'intro' && step !== 'result' ? `Round ${Math.min(rounds.length + (step === 'run' ? 1 : 0), 3)}/3` : ''}
          {plan.kind === 'edge' && edge && step !== 'intro' && step !== 'result' ? `Best ${edge.best || '—'}` : ''}
        </span>
      </header>

      <div className="lesson-body">
        {step === 'intro' && (
          <Intro plan={plan} lesson={firstLesson} warmup={warmup.current} prog={prog} calibrated={calibrated} error={runner.error} onOpenSetup={onOpenSetup} onStart={() => void start()} />
        )}
        {step === 'run' && <Live runner={runner} lesson={plan.kind === 'edge' && edge ? edgeLesson(edge) : (plan.kind === 'warmup' ? warmup.current[rounds.length] : firstLesson)} />}
        {step === 'between' && rounds.length > 0 && (
          <div className="between">
            <RoundCard round={rounds[rounds.length - 1]} />
            <p className="between-next">
              {plan.kind === 'edge' && edge ? `Next: ${edge.bpm} BPM` : `Next: ${warmup.current[rounds.length]?.title ?? ''}`} in {countdown}…
            </p>
            <button type="button" className="wide-btn secondary" onClick={() => (cancelled.current = true)}>
              Stop here
            </button>
          </div>
        )}
        {step === 'result' && plan.kind === 'lesson' && rounds[0] && (
          <LessonResultView
            round={rounds[0]}
            onRetry={() => void start()}
            next={nextLessonAfter(plan.lesson, prog)}
            onNext={(l) => {
              onPlan({ kind: 'lesson', lesson: l });
              setStep('intro');
              setRounds([]);
            }}
            onExit={onExit}
          />
        )}
        {step === 'result' && plan.kind !== 'lesson' && (
          <SequenceResult plan={plan} rounds={rounds} bonus={bonus} edge={edge} edgeRecord={edgeRecord} onAgain={() => void start()} onExit={onExit} />
        )}
      </div>
    </div>
  );
}

function nextLessonAfter(l: Lesson, prog: ProgressApi): Lesson | null {
  const i = LESSONS.findIndex((x) => x.id === l.id);
  const next = LESSONS[i + 1];
  return next && lessonUnlocked(prog.progress, next) ? next : null;
}

function Intro({
  plan,
  lesson,
  warmup,
  prog,
  calibrated,
  error,
  onOpenSetup,
  onStart,
}: {
  plan: Plan;
  lesson: Lesson;
  warmup: Lesson[];
  prog: ProgressApi;
  calibrated: boolean;
  error: string | null;
  onOpenSetup(): void;
  onStart(): void;
}) {
  const rec = prog.progress.lessons[lesson.id];
  return (
    <div className="intro">
      {plan.kind === 'lesson' && (
        <>
          <p className="intro-goal">{lesson.goal}</p>
          {lesson.tip && <p className="hint">Tip: {lesson.tip}</p>}
          <dl className="intro-facts">
            <div><dt>Tempo</dt><dd>{lesson.bpm} BPM · {lesson.beatsPerBar}/4</dd></div>
            <div><dt>Length</dt><dd>{lesson.bars} bars · {Math.round(lessonSeconds(lesson))} s{lesson.countIn === 2 ? ' + 2-bar count-in' : ' + 1-bar count-in'}</dd></div>
            <div><dt>You play</dt><dd>{playText(lesson)}</dd></div>
            <div><dt>Click</dt><dd>{clickText(lesson)}</dd></div>
          </dl>
          {lesson.play.sticking && <p className="sticking" aria-label="Suggested sticking">{lesson.play.sticking}</p>}
          {lesson.test && <p className="callout">Stage test: 2 stars open the next stage.</p>}
          {rec && (
            <p className="hint">
              Your best: <Stars n={rec.bestStars} size="sm" /> {rec.bestSdMs !== null ? `· spread ±${rec.bestSdMs.toFixed(1)} ms` : ''} · {rec.plays} play{rec.plays === 1 ? '' : 's'}
            </p>
          )}
        </>
      )}
      {plan.kind === 'warmup' && (
        <>
          <p className="intro-goal">Three short rounds, about 1 minute each. Round 2 targets your weakest skill.</p>
          <ol className="round-list">
            {warmup.map((l) => (
              <li key={l.id}>
                <b>{l.title.replace(/^Warm-up \d · /, '')}</b> · {l.bpm} BPM · {l.bars} bars
              </li>
            ))}
          </ol>
          {prog.progress.warmupDay === dayKey(new Date()) ? null : (
            <p className="hint">Daily bonus: +30 XP.</p>
          )}
        </>
      )}
      {plan.kind === 'edge' && (
        <>
          <p className="intro-goal">4-bar rounds. Each clean round (2 stars) adds 4 BPM; a loose one takes 4 off. Three loose rounds end the run.</p>
          <dl className="intro-facts">
            <div><dt>Start</dt><dd>{lesson.bpm} BPM</dd></div>
            <div><dt>Your record</dt><dd>{prog.progress.edge[plan.pattern] ? `${prog.progress.edge[plan.pattern]} BPM` : '—'}</dd></div>
            <div><dt>You play</dt><dd>{playText(lesson)}</dd></div>
          </dl>
          {lesson.play.sticking && <p className="sticking">{lesson.play.sticking}</p>}
        </>
      )}
      <p className="hint">
        Scoring: Perfect ≤{WINDOWS.perfect} ms · Great ≤{WINDOWS.great} · Good ≤{WINDOWS.good}. Notes you skip count as misses.
      </p>
      {!calibrated ? (
        <div className="callout">
          The accuracy meter isn’t calibrated yet, so early and late can’t be judged.
          <button type="button" className="wide-btn" onClick={onOpenSetup}>
            Set up and calibrate
          </button>
        </div>
      ) : (
        <button type="button" className="play-btn start-lesson" onClick={onStart}>
          Start
        </button>
      )}
      {error && <p className="hint error" role="alert">{error}</p>}
    </div>
  );
}

function Live({ runner, lesson }: { runner: ReturnType<typeof useLessonRunner>; lesson: Lesson }) {
  const live = runner.live;
  if (!live) return <p className="hint">Starting…</p>;
  const barNow = Math.max(0, live.bar);
  const pos = live.offsetMs === null ? null : 50 + (Math.max(-50, Math.min(50, live.offsetMs)) / 50) * 50;
  const c = live.counts;
  return (
    <div className="live">
      <div className="live-progress" aria-label={`Bar ${barNow + 1} of ${lesson.bars}`}>
        <span style={{ width: `${(Math.min(lesson.bars, live.countInBeat ? 0 : barNow + 1) / lesson.bars) * 100}%` }} />
      </div>
      <div className="live-meta">
        <span>{live.countInBeat ? `Count-in ${live.countInBeat}` : `Bar ${barNow + 1} / ${lesson.bars}`}</span>
        <span>{live.bpm} BPM</span>
      </div>
      <div className="live-judgment" aria-live="polite">
        {live.silent && !live.countInBeat ? (
          <span className="silent-flag">Silent · keep going</span>
        ) : (
          <span className="silent-flag placeholder" aria-hidden="true">·</span>
        )}
        {live.judgment ? (
          <div key={live.n} className={`judgment j-${live.judgment}`}>
            {JUDGMENT_LABEL[live.judgment]}
            <small>{live.offsetMs !== null ? fmtMs(live.offsetMs) : ' '}</small>
          </div>
        ) : (
          <div className="judgment idle">{runner.phase === 'finishing' ? 'Scoring…' : live.countInBeat ? 'Get ready' : 'Play'}</div>
        )}
      </div>
      <div className="live-track" aria-hidden="true">
        <span className="lt-band" />
        <span className="lt-center" />
        {pos !== null && <span key={live.n} className="lt-dot" style={{ left: `${pos}%` }} />}
      </div>
      <div className="live-track-labels" aria-hidden="true">
        <span>early</span>
        <span>late</span>
      </div>
      <div className="combo">
        <b>×{live.combo}</b>
        <span>combo</span>
      </div>
      <div className="counts">
        {(['perfect', 'great', 'good', 'off', 'miss'] as const).map((k) => (
          <div key={k} className={`count j-${k}`}>
            <span>{JUDGMENT_LABEL[k]}</span>
            <b>{c[k]}</b>
          </div>
        ))}
      </div>
      {lesson.play.sticking && <p className="sticking">{lesson.play.sticking}</p>}
    </div>
  );
}

function RoundCard({ round }: { round: Round }) {
  const r = round.result;
  return (
    <div className="round-card">
      <div className="row-between">
        <b>{round.note ?? round.lesson.title}</b>
        <Stars n={r.stars} size="sm" />
      </div>
      <p className="hint">
        Score {r.score}% · spread ±{r.sdMs.toFixed(1)} ms · {fmtMs(r.meanMs)} average · +{round.outcome.xpGained} XP
      </p>
    </div>
  );
}

function Outcome({ outcome }: { outcome: RecordOutcome }) {
  return (
    <>
      {outcome.newBadges.map((b: Badge) => (
        <div key={b.id} className="badge-earned">
          <span className="badge-icon" aria-hidden="true">★</span>
          <div>
            <b>Badge: {b.title}</b>
            <div className="hint">{b.how}</div>
          </div>
        </div>
      ))}
    </>
  );
}

function LessonResultView({
  round,
  onRetry,
  next,
  onNext,
  onExit,
}: {
  round: Round;
  onRetry(): void;
  next: Lesson | null;
  onNext(l: Lesson): void;
  onExit(): void;
}) {
  const r = round.result;
  const o = round.outcome;
  const hint = nextStarHint(r);
  const tendency = Math.abs(r.meanMs) < 3 ? 'right on the click' : r.meanMs < 0 ? 'ahead (rushing)' : 'behind (dragging)';
  return (
    <div className="result">
      <div className="result-hero">
        <Stars n={r.stars} size="lg" />
        <div className="result-title">{r.stars === 0 ? 'Not yet' : round.lesson.test && r.stars < 2 ? 'Almost: tests need 2 stars' : 'Lesson complete'}</div>
        <div className="result-chips">
          <span className="chip-xp">+{o.xpGained} XP</span>
          {o.newBestSd && <span className="chip-xp">New best spread</span>}
          {o.improvedStars && <span className="chip-xp">New stars</span>}
        </div>
      </div>
      <div className="tiles">
        <div className="tile"><b>{r.score}%</b><span>score</span></div>
        <div className="tile"><b>±{r.sdMs.toFixed(1)} ms</b><span>spread</span></div>
        <div className="tile"><b>{fmtMs(r.meanMs)}</b><span>{tendency}</span></div>
        <div className="tile"><b>{Math.round(r.within20 * 100)}%</b><span>within ±20 ms</span></div>
      </div>
      <div className="counts">
        {(['perfect', 'great', 'good', 'off', 'miss', 'extra'] as const).map((k) => (
          <div key={k} className={`count j-${k}`}>
            <span>{JUDGMENT_LABEL[k]}</span>
            <b>{r[k]}</b>
          </div>
        ))}
      </div>
      <p className="hint">Longest combo ×{r.maxCombo}</p>
      {hint && <p className="callout">{hint}</p>}
      <Outcome outcome={o} />
      <MiniTimeline r={r} />
      <ul className="insights">
        {r.durationSec >= 30 && <li>Drift {fmtMs(r.driftMsPerMin)} per minute{Math.abs(r.driftMsPerMin) < 3 ? ' (steady)' : r.driftMsPerMin > 0 ? ' (falling behind)' : ' (pushing ahead)'}.</li>}
        {r.silentMeanAbsMs !== null && r.audibleMeanAbsMs !== null && (
          <li>
            Without the click: ±{r.silentMeanAbsMs.toFixed(1)} ms average error, with it ±{r.audibleMeanAbsMs.toFixed(1)} ms.
          </li>
        )}
        {r.extra > 0 && <li>{r.extra} extra hit{r.extra === 1 ? '' : 's'} between notes.</li>}
        {r.ignored.bounce + r.ignored.double > 0 && (
          <li>
            {r.ignored.bounce + r.ignored.double} rebound or echo sound{r.ignored.bounce + r.ignored.double === 1 ? '' : 's'} right after your hits
            {r.ignored.bounce + r.ignored.double === 1 ? ' was' : ' were'} not counted.
          </li>
        )}
      </ul>
      <div className="btn-row">
        <button type="button" className="wide-btn secondary" onClick={onRetry}>Retry</button>
        {next ? (
          <button type="button" className="wide-btn" onClick={() => onNext(next)}>Next lesson</button>
        ) : (
          <button type="button" className="wide-btn" onClick={onExit}>Back to lessons</button>
        )}
      </div>
    </div>
  );
}

function SequenceResult({
  plan,
  rounds,
  bonus,
  edge,
  edgeRecord,
  onAgain,
  onExit,
}: {
  plan: Plan;
  rounds: Round[];
  bonus: number;
  edge: EdgeState | null;
  edgeRecord: boolean;
  onAgain(): void;
  onExit(): void;
}) {
  const xp = rounds.reduce((s, r) => s + r.outcome.xpGained, 0) + bonus;
  return (
    <div className="result">
      <div className="result-hero">
        {plan.kind === 'edge' ? (
          <>
            <div className="hero-num">{edge?.best ? `${edge.best}` : '—'}<small> BPM</small></div>
            <div className="result-title">{edge?.best ? (edgeRecord ? 'New record' : 'Your clean top tempo this run') : 'No clean round this time'}</div>
          </>
        ) : (
          <div className="result-title">{rounds.length === 3 ? 'Warm-up done' : 'Warm-up stopped'}</div>
        )}
        <div className="result-chips">
          <span className="chip-xp">+{xp} XP</span>
          {bonus > 0 && <span className="chip-xp">Daily bonus</span>}
        </div>
      </div>
      {rounds.map((r, i) => (
        <RoundCard key={i} round={r} />
      ))}
      {rounds.map((r, i) => (
        <Outcome key={`o${i}`} outcome={r.outcome} />
      ))}
      <div className="btn-row">
        <button type="button" className="wide-btn secondary" onClick={onAgain}>Again</button>
        <button type="button" className="wide-btn" onClick={onExit}>Done</button>
      </div>
    </div>
  );
}
