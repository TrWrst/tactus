import { MAX_BPM, MIN_BPM } from '../engine/types';
import { formatDuration } from '../engine/practice';
import type { Metronome } from '../state/useMetronome';
import { BottomSheet, Segmented } from './BottomSheet';
import { MinusIcon, PlusIcon } from './icons';

/** Compact −/value/+ control. */
export function NumberStepper({
  label,
  value,
  min,
  max,
  step = 1,
  format = String,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange(v: number): void;
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return (
    <div className="num-stepper">
      <span className="num-label">{label}</span>
      <div className="stepper">
        <button type="button" className="round-btn small" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => set(value - step)}>
          <MinusIcon />
        </button>
        <output aria-live="polite" aria-label={label}>
          {format(value)}
        </output>
        <button type="button" className="round-btn small" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => set(value + step)}>
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function PracticeSheet({
  m,
  open,
  onClose,
  onOpenMeter,
  onOpenResults,
  hasResult,
}: {
  m: Metronome;
  open: boolean;
  onClose(): void;
  onOpenMeter(): void;
  onOpenResults(): void;
  hasResult: boolean;
}) {
  const p = m.settings.practice;
  const u = m.updatePractice;
  const secStep = (v: number) => (v < 60 ? 5 : v < 600 ? 30 : 60);

  return (
    <BottomSheet title="Practice" open={open} onClose={onClose}>
      <section className="practice-section" aria-labelledby="pr-mute">
        <h3 id="pr-mute">Muted beats</h3>
        <Segmented
          label="Mute mode"
          value={p.muteMode}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'bars', label: 'Bars' },
            { value: 'random', label: 'Random' },
          ]}
          onChange={(v) => u({ muteMode: v })}
        />
        {p.muteMode === 'bars' && (
          <>
            <NumberStepper label="Play bars" value={p.playBars} min={1} max={64} onChange={(v) => u({ playBars: v })} />
            <NumberStepper label="Mute bars" value={p.muteBars} min={1} max={64} onChange={(v) => u({ muteBars: v })} />
            <p className="hint">
              Plays {plural(p.playBars, 'bar')}, then stays silent for {plural(p.muteBars, 'bar')}. Keep counting!
            </p>
          </>
        )}
        {p.muteMode === 'random' && (
          <div className="field">
            <label className="field-label" htmlFor="rand-pct">
              Chance a beat is muted <span className="value">{p.randomPct}%</span>
            </label>
            <input id="rand-pct" type="range" min={5} max={95} step={5} value={p.randomPct} onChange={(e) => u({ randomPct: Number(e.target.value) })} />
          </div>
        )}
      </section>

      <section className="practice-section" aria-labelledby="pr-ramp">
        <h3 id="pr-ramp" className="row-between">
          Tempo ramp
          <input type="checkbox" role="switch" aria-label="Tempo ramp" checked={p.rampOn} onChange={(e) => u({ rampOn: e.target.checked })} />
        </h3>
        {p.rampOn && (
          <>
            <NumberStepper label="Change by" value={p.rampStep} min={1} max={50} format={(v) => `${v} BPM`} onChange={(v) => u({ rampStep: v })} />
            <NumberStepper
              label="Every"
              value={p.rampEvery}
              min={1}
              max={p.rampUnit === 'bars' ? 64 : 600}
              step={p.rampUnit === 'bars' ? 1 : secStep(p.rampEvery)}
              format={(v) => (p.rampUnit === 'bars' ? plural(v, 'bar') : `${v} s`)}
              onChange={(v) => u({ rampEvery: v })}
            />
            <Segmented
              label="Step unit"
              value={p.rampUnit}
              options={[
                { value: 'bars', label: 'Bars' },
                { value: 'seconds', label: 'Seconds' },
              ]}
              onChange={(v) => u({ rampUnit: v, rampEvery: v === 'bars' ? 4 : 30 })}
            />
            <NumberStepper label="Target" value={p.rampTarget} min={MIN_BPM} max={MAX_BPM} format={(v) => `${v} BPM`} onChange={(v) => u({ rampTarget: v })} />
            <Segmented
              label="At target"
              value={p.rampEnd}
              options={[
                { value: 'hold', label: 'Hold' },
                { value: 'reverse', label: 'Reverse' },
                { value: 'restart', label: 'Restart' },
              ]}
              onChange={(v) => u({ rampEnd: v })}
            />
            <p className="hint">
              Starts at your tempo ({m.settings.bpm} BPM) and {p.rampTarget >= m.settings.bpm ? 'speeds up' : 'slows down'} to {p.rampTarget}.
              Your tempo setting is unchanged when you stop.
            </p>
          </>
        )}
      </section>

      <section className="practice-section" aria-labelledby="pr-stop">
        <h3 id="pr-stop">Stop automatically</h3>
        <Segmented
          label="Stop after"
          value={p.stopMode}
          options={[
            { value: 'off', label: 'Never' },
            { value: 'bars', label: 'Bars' },
            { value: 'time', label: 'Time' },
          ]}
          onChange={(v) => u({ stopMode: v })}
        />
        {p.stopMode === 'bars' && (
          <NumberStepper label="Bars" value={p.stopBars} min={1} max={999} onChange={(v) => u({ stopBars: v })} />
        )}
        {p.stopMode === 'time' && (
          <NumberStepper
            label="Duration"
            value={p.stopSeconds}
            min={5}
            max={7200}
            step={secStep(p.stopSeconds)}
            format={formatDuration}
            onChange={(v) => u({ stopSeconds: v })}
          />
        )}
        {p.stopMode !== 'off' && <p className="hint">Counted after the count-in.</p>}
      </section>

      <section className="practice-section" aria-labelledby="pr-meter">
        <h3 id="pr-meter" className="row-between">
          Accuracy meter
          <input
            type="checkbox"
            role="switch"
            aria-label="Listen while I play"
            checked={m.settings.meter.enabled}
            onChange={(e) => m.updateMeter({ enabled: e.target.checked })}
          />
        </h3>
        <p className="hint">
          Listens through the microphone and scores how early or late each hit is ({m.settings.meter.output === 'speaker' ? 'speaker mode' : 'wired headphones'}).
          {m.settings.meter.latencyMs === null ? ' Not calibrated yet.' : ` Calibrated: ${m.settings.meter.latencyMs.toFixed(1)} ms.`}
        </p>
        <div className="btn-row">
          <button type="button" className="wide-btn" onClick={onOpenMeter}>
            Set up &amp; calibrate
          </button>
          <button type="button" className="wide-btn secondary" onClick={onOpenResults} disabled={!hasResult}>
            Last results
          </button>
        </div>
      </section>
    </BottomSheet>
  );
}
