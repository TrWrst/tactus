import { useEffect, useState } from 'react';
import { isPracticeActive } from './engine/practice';
import { SOUNDS } from './engine/sounds';
import { SUBDIVISIONS } from './engine/rhythm';
import { meterLabel } from './state/settings';
import { useMetronome } from './state/useMetronome';
import { useAccuracy } from './state/useAccuracy';
import { HitMeter } from './ui/HitMeter';
import { MeterSheet } from './ui/MeterSheet';
import { ResultsSheet } from './ui/ResultsSheet';
import { BeatDots } from './ui/BeatDots';
import { ChartIcon, MetronomeIcon, PlayIcon, SlidersIcon, StopIcon, SubdivGlyph, TargetIcon, WaveIcon } from './ui/icons';
import { LessonScreen, type Plan } from './train/LessonScreen';
import { ProgressTab } from './train/ProgressTab';
import { TrainTab } from './train/TrainTab';
import { useProgress } from './train/useProgress';
import { PracticeSheet } from './ui/PracticeSheet';
import { Stopwatch } from './ui/Stopwatch';
import { OptionsSheet, RhythmSheet, SoundSheet } from './ui/sheets';
import { StatsPanel } from './ui/StatsPanel';
import { TempoControls } from './ui/TempoControls';
import { TempoDial } from './ui/TempoDial';

type Sheet = 'rhythm' | 'sound' | 'options' | 'practice' | 'meter' | 'results' | null;
type Tab = 'metronome' | 'train' | 'progress';

const TAB_KEY = 'tactus.tab';
const readTab = (): Tab => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === 'train' || t === 'progress' ? t : 'metronome';
  } catch {
    return 'metronome';
  }
};

function useTheme(theme: 'system' | 'dark' | 'light') {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const t = theme === 'system' ? (mq.matches ? 'light' : 'dark') : theme;
      document.documentElement.dataset.theme = t;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f6f1e8' : '#15120f');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

export default function App() {
  const m = useMetronome();
  const { settings: s, running, finished, beat } = m;
  const p = s.practice;
  const acc = useAccuracy(m);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [showStats, setShowStats] = useState(() => new URLSearchParams(location.search).has('debug'));
  const [tab, setTab] = useState<Tab>(readTab);
  const [plan, setPlan] = useState<Plan | null>(null);
  const prog = useProgress();
  useTheme(s.theme);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* per-viewer convenience only */
    }
  }, [tab]);
  // Free-play scoring belongs to the Metronome tab; lessons score themselves.
  useEffect(() => acc.setFreePlay(tab === 'metronome' && !plan), [acc, tab, plan]);

  // ?debug exposes internals for the in-browser self-test (no effect otherwise).
  useEffect(() => {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, unknown>).__tactus = { m, acc, prog, setPlan, setTab };
  });

  // A finished listening session opens its results.
  useEffect(() => {
    if (acc.resultSeq > 0) setSheet('results');
  }, [acc.resultSeq]);

  // Global keyboard shortcuts (ignored while typing or inside a sheet).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (sheet || plan || tab !== 'metronome' || e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [role="slider"]')) return;
      if (e.key === ' ' && !t.closest('button')) {
        e.preventDefault();
        m.toggle();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        m.nudgeBpm((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
      } else if (e.key === 't' || e.key === 'T') m.tap();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [m, sheet, plan, tab]);

  const ev = beat.ev;
  const activeBeat = running && ev ? ev.beat : null;
  // During a tempo ramp the dial shows the live tempo; otherwise your set tempo.
  const liveBpm = running && ev && !ev.isCountIn ? ev.bpm : s.bpm;
  let status: string | undefined;
  if (!running) status = finished ? 'Finished ✓' : undefined;
  else if (ev?.isCountIn) status = `Count-in · ${ev.beat + 1}`;
  else if (ev) {
    status = `Bar ${ev.bar + 1}${p.stopMode === 'bars' ? ` / ${p.stopBars}` : ''}`;
    if (ev.trainerMuted && p.muteMode === 'bars') status += ' · silent';
    if (p.rampOn) status += ` · → ${p.rampTarget}`;
  }
  const practiceOn = isPracticeActive(p) || s.meter.enabled;
  const subName = SUBDIVISIONS.find((d) => d.value === s.subdivision)!;
  const toneForced = s.meter.enabled && s.meter.output === 'speaker';
  const soundName = toneForced ? 'Tone (meter)' : (SOUNDS.find((x) => x.id === s.sound)?.name ?? '');
  const pulseLevel = ev?.isCountIn ? 'count' : ev?.level;

  return (
    <div className={`app visual-${s.visual} ${running ? 'running' : ''}`}>
      {s.visual === 'flash' && running && ev && ev.voice && (
        <div key={beat.n} className={`flash lvl-${pulseLevel}`} aria-hidden="true" />
      )}

      <header className="topbar">
        <h1 className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Tactus
        </h1>
        <Stopwatch engine={m.engine} running={running} />
        <button type="button" className="icon-btn" aria-label="Options" onClick={() => setSheet('options')}>
          <SlidersIcon />
        </button>
      </header>

      {tab === 'metronome' && (
      <>
      <BeatDots
        accents={s.accents}
        activeBeat={activeBeat}
        beatKey={beat.n}
        countIn={!!ev?.isCountIn}
        silent={!!ev?.trainerMuted}
        onCycle={m.cycleBeat}
      />

      <main className="dial-wrap">
        <TempoDial
          bpm={liveBpm}
          onChange={m.setBpm}
          status={status}
          footer={running && s.meter.enabled ? <HitMeter live={acc.live} listening={acc.mic === 'on'} /> : undefined}
        >
          {s.visual === 'pulse' && running && ev && ev.voice && (
            <span key={beat.n} className={`pulse lvl-${pulseLevel}`} aria-hidden="true" />
          )}
        </TempoDial>
      </main>

      {showStats && <StatsPanel engine={m.engine} />}

      <TempoControls onNudge={m.nudgeBpm} onTap={m.tap} />

      <nav className="quickbar" aria-label="Rhythm and sound">
        <button type="button" className="quick" onClick={() => setSheet('rhythm')} aria-label={`Rhythm: ${meterLabel(s)}, ${subName.name}. Change`}>
          <strong>{meterLabel(s)}</strong>
          <SubdivGlyph n={s.subdivision} />
        </button>
        <button type="button" className="quick" onClick={() => setSheet('sound')} aria-label={`Sound: ${soundName}. Change`}>
          <WaveIcon />
          <span>{soundName}</span>
        </button>
        <button
          type="button"
          className={`quick ${practiceOn ? 'active' : ''}`}
          onClick={() => setSheet('practice')}
          aria-label={`Practice trainers${practiceOn ? ' (on)' : ''}. Change`}
        >
          <TargetIcon />
          <span>Practice</span>
        </button>
      </nav>

      <div className="play-row">
        <button
          type="button"
          className={`play-btn ${running ? 'on' : ''}`}
          onClick={m.toggle}
          aria-label={running ? 'Stop' : 'Start'}
          aria-pressed={running}
        >
          {running ? <StopIcon width={34} height={34} /> : <PlayIcon width={36} height={36} />}
        </button>
      </div>
      </>
      )}

      {tab === 'train' && (
        <TrainTab prog={prog} calibrated={s.meter.latencyMs !== null} onPlan={setPlan} onOpenSetup={() => setSheet('meter')} />
      )}
      {tab === 'progress' && <ProgressTab prog={prog} />}

      <nav className="tabbar" aria-label="Sections">
        {(
          [
            ['metronome', 'Metronome', <MetronomeIcon key="m" />],
            ['train', 'Train', <TargetIcon key="t" />],
            ['progress', 'Progress', <ChartIcon key="p" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} type="button" className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {plan && (
        <LessonScreen
          key={plan.kind === 'lesson' ? plan.lesson.id : plan.kind === 'edge' ? `edge-${plan.pattern}` : 'warmup'}
          plan={plan}
          m={m}
          acc={acc}
          prog={prog}
          onExit={() => setPlan(null)}
          onOpenSetup={() => setSheet('meter')}
          onPlan={setPlan}
        />
      )}

      <RhythmSheet m={m} open={sheet === 'rhythm'} onClose={() => setSheet(null)} />
      <PracticeSheet
        m={m}
        open={sheet === 'practice'}
        onClose={() => setSheet(null)}
        onOpenMeter={() => setSheet('meter')}
        onOpenResults={() => setSheet('results')}
        hasResult={!!acc.result}
      />
      <MeterSheet
        m={m}
        acc={acc}
        open={sheet === 'meter'}
        onClose={() => {
          setSheet(null);
          if (!s.meter.enabled) acc.closeMic(); // setup opened the mic; release it if not listening
        }}
      />
      <ResultsSheet result={acc.result} calibrated={s.meter.latencyMs !== null} open={sheet === 'results'} onClose={() => setSheet(null)} />
      <SoundSheet m={m} open={sheet === 'sound'} onClose={() => setSheet(null)} />
      <OptionsSheet
        m={m}
        open={sheet === 'options'}
        onClose={() => setSheet(null)}
        showStats={showStats}
        setShowStats={setShowStats}
      />
    </div>
  );
}
