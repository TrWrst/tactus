import { BEAT_UNITS, MAX_BEATS_PER_BAR, METER_PRESETS, SUBDIVISIONS, isSwingable } from '../engine/rhythm';
import { SOUNDS, } from '../engine/sounds';
import { canVibrate } from '../engine/platform';
import type { Metronome } from '../state/useMetronome';
import { BottomSheet, Segmented } from './BottomSheet';
import { MinusIcon, PlusIcon, SubdivGlyph } from './icons';

interface SheetProps {
  m: Metronome;
  open: boolean;
  onClose(): void;
}

export function RhythmSheet({ m, open, onClose }: SheetProps) {
  const s = m.settings;
  const isPreset = METER_PRESETS.some((p) => p.beatsPerBar === s.beatsPerBar && p.beatUnit === s.beatUnit);
  const swingPct = Math.round(s.swing * 100);
  return (
    <BottomSheet title="Rhythm" open={open} onClose={onClose}>
      <div className="field">
        <div className="field-label" id="meter-label">Time signature</div>
        <div className="chip-grid" role="radiogroup" aria-labelledby="meter-label">
          {METER_PRESETS.map((p) => {
            const on = p.beatsPerBar === s.beatsPerBar && p.beatUnit === s.beatUnit;
            return (
              <button
                key={p.label}
                type="button"
                role="radio"
                aria-checked={on}
                className={`chip meter ${on ? 'on' : ''}`}
                onClick={() => m.setMeter(p.beatsPerBar, p.beatUnit)}
              >
                {p.label}
              </button>
            );
          })}
          <span className={`chip meter custom-tag ${!isPreset ? 'on' : ''}`} aria-hidden={isPreset}>
            {!isPreset ? `${s.beatsPerBar}/${s.beatUnit}` : 'Custom ↓'}
          </span>
        </div>
        <div className="custom-meter" aria-label="Custom time signature">
          <div className="stepper">
            <button
              type="button"
              className="round-btn small"
              aria-label="Fewer beats per bar"
              disabled={s.beatsPerBar <= 1}
              onClick={() => m.setMeter(s.beatsPerBar - 1, s.beatUnit, true)}
            >
              <MinusIcon />
            </button>
            <output aria-label="Beats per bar">{s.beatsPerBar}</output>
            <button
              type="button"
              className="round-btn small"
              aria-label="More beats per bar"
              disabled={s.beatsPerBar >= MAX_BEATS_PER_BAR}
              onClick={() => m.setMeter(s.beatsPerBar + 1, s.beatUnit, true)}
            >
              <PlusIcon />
            </button>
          </div>
          <span className="slash" aria-hidden="true">/</span>
          <div className="segmented compact" role="radiogroup" aria-label="Beat unit">
            {BEAT_UNITS.map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={u === s.beatUnit}
                className={u === s.beatUnit ? 'on' : ''}
                onClick={() => m.setMeter(s.beatsPerBar, u, true)}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
        <p className="hint">BPM counts the bottom note ({s.beatUnit === 8 ? 'eighth' : s.beatUnit === 2 ? 'half' : s.beatUnit === 16 ? 'sixteenth' : 'quarter'} notes). Tap beats on the main screen to set accents. <button type="button" className="link-btn" onClick={m.resetAccents}>Reset accents</button></p>
      </div>

      <div className="field">
        <div className="field-label" id="subdiv-label">Subdivision</div>
        <div className="subdiv-grid" role="radiogroup" aria-labelledby="subdiv-label">
          {SUBDIVISIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              role="radio"
              aria-checked={s.subdivision === d.value}
              className={`subdiv ${s.subdivision === d.value ? 'on' : ''}`}
              onClick={() => m.update({ subdivision: d.value })}
            >
              <SubdivGlyph n={d.value} />
              <span>{d.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="swing">
          Swing <span className="value">{swingPct <= 50 ? 'Straight' : `${swingPct}%`}{swingPct === 67 ? ' · triplet feel' : ''}</span>
        </label>
        <input
          id="swing"
          type="range"
          min={50}
          max={75}
          step={1}
          value={swingPct}
          disabled={!isSwingable(s.subdivision)}
          onChange={(e) => m.update({ swing: Number(e.target.value) / 100 })}
          aria-valuetext={swingPct <= 50 ? 'Straight' : `${swingPct} percent`}
        />
        {!isSwingable(s.subdivision) && <p className="hint">Swing works with eighths, sixteenths and sextuplets.</p>}
      </div>
    </BottomSheet>
  );
}

export function SoundSheet({ m, open, onClose }: SheetProps) {
  const s = m.settings;
  return (
    <BottomSheet title="Sound" open={open} onClose={onClose}>
      <div className="field">
        <div className="field-label" id="sound-label">Click sound</div>
        <div className="sound-grid" role="radiogroup" aria-labelledby="sound-label">
          {SOUNDS.map((snd) => (
            <button
              key={snd.id}
              type="button"
              role="radio"
              aria-checked={s.sound === snd.id}
              className={`sound ${s.sound === snd.id ? 'on' : ''}`}
              onClick={() => {
                m.update({ sound: snd.id });
                m.preview(snd.id);
              }}
            >
              {snd.name}
            </button>
          ))}
        </div>
        <p className="hint">Selecting a sound plays a preview.</p>
        {s.meter.enabled && s.meter.output === 'speaker' && (
          <p className="hint">While the accuracy meter is on in speaker mode, the click plays as <strong>Tone</strong> so the microphone can tell it apart from your hits.</p>
        )}
      </div>
      <div className="field">
        <label className="field-label" htmlFor="volume">
          Volume <span className="value">{Math.round(s.volume * 100)}%</span>
        </label>
        <input
          id="volume"
          type="range"
          min={0}
          max={100}
          value={Math.round(s.volume * 100)}
          onChange={(e) => m.update({ volume: Number(e.target.value) / 100 })}
        />
      </div>
    </BottomSheet>
  );
}

export function OptionsSheet({
  m,
  open,
  onClose,
  showStats,
  setShowStats,
}: SheetProps & { showStats: boolean; setShowStats(v: boolean): void }) {
  const s = m.settings;
  const vibrateOk = canVibrate();
  return (
    <BottomSheet title="Options" open={open} onClose={onClose}>
      <Segmented
        label="Count-in"
        value={s.countInBars}
        options={[
          { value: 0, label: 'Off' },
          { value: 1, label: '1 bar' },
          { value: 2, label: '2 bars' },
        ]}
        onChange={(v) => m.update({ countInBars: v })}
      />
      <Segmented
        label="Beat display"
        value={s.visual}
        options={[
          { value: 'pulse', label: 'Pulse' },
          { value: 'dots', label: 'Dots only' },
          { value: 'flash', label: 'Flash' },
        ]}
        onChange={(v) => m.update({ visual: v })}
      />
      <Segmented
        label="Theme"
        value={s.theme}
        options={[
          { value: 'system', label: 'Auto' },
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
        onChange={(v) => m.update({ theme: v })}
      />
      <label className="toggle-row">
        <span>
          Vibrate on each beat
          {!vibrateOk && <span className="hint block">Not supported by this browser (e.g. iPhone Safari).</span>}
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={s.haptics && vibrateOk}
          disabled={!vibrateOk}
          onChange={(e) => m.update({ haptics: e.target.checked })}
        />
      </label>
      <label className="toggle-row">
        <span>Show timing stats</span>
        <input type="checkbox" role="switch" checked={showStats} onChange={(e) => setShowStats(e.target.checked)} />
      </label>
      <p className="hint">Keyboard: Space start/stop · ↑↓ tempo (Shift ×10) · T tap.</p>
    </BottomSheet>
  );
}
