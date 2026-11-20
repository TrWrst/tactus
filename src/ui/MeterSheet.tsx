import { useEffect, useState } from 'react';
import { MAX_WIRED_LATENCY_MS, type CalibrationResult } from '../engine/accuracy';
import { AccuracyMeter } from '../engine/accuracyMeter';
import type { Accuracy } from '../state/useAccuracy';
import type { Metronome } from '../state/useMetronome';
import { BottomSheet, Segmented } from './BottomSheet';
import { NumberStepper } from './PracticeSheet';

/** Setup for the accuracy meter: wired-headphone check, mic, sensitivity, calibration. */
export function MeterSheet({ m, acc, open, onClose }: { m: Metronome; acc: Accuracy; open: boolean; onClose(): void }) {
  const cfg = m.settings.meter;
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [btSuspect, setBtSuspect] = useState(false);
  const [cal, setCal] = useState<CalibrationResult | null>(null);
  const [calibrating, setCalibrating] = useState(false);

  // While the sheet is open with the mic on: show the input level and count hits.
  useEffect(() => {
    if (!open || acc.mic !== 'on') return;
    const off = acc.watchInput();
    void AccuracyMeter.inputs().then(setDevices);
    void AccuracyMeter.bluetoothSuspected(acc.meter.inputLabel).then(setBtSuspect);
    return off;
  }, [open, acc.mic, acc]);

  useEffect(() => {
    if (open) setCal(null);
  }, [open]);

  const runCalibration = async () => {
    setCalibrating(true);
    try {
      setCal(await acc.calibrate());
    } catch (e) {
      setCal({ ok: false, latencyMs: 0, spreadMs: 0, detected: 0, expected: 10, reason: 'not-enough' });
      console.error(e);
    } finally {
      setCalibrating(false);
    }
  };

  const speaker = cfg.output === 'speaker';
  const levelPct = Math.min(100, Math.round(Math.sqrt(acc.level) * 100));
  const levelDb = acc.level > 0 ? Math.round(20 * Math.log10(acc.level)) : null;
  const [diag, setDiag] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!open || acc.mic !== 'on') return;
    const read = () => setDiag(acc.meter.diagnostics());
    read();
    const id = window.setInterval(read, 1000);
    return () => window.clearInterval(id);
  }, [open, acc.mic, acc.meter]);

  return (
    <BottomSheet title="Accuracy meter setup" open={open} onClose={onClose}>
      <Segmented
        label="How do you hear the click?"
        value={cfg.output}
        options={[
          { value: 'speaker', label: 'Speaker' },
          { value: 'headphones', label: 'Wired headphones' },
        ]}
        onChange={(v) => {
          setCal(null);
          m.updateMeter({ output: v, latencyMs: null }); // a different sound path needs a new calibration
        }}
      />
      {speaker ? (
        <div className="callout">
          <strong>Speaker mode.</strong> While the meter is on, the click becomes a high tone and Tactus only listens to the
          low and middle frequencies of your hits, so the click isn’t counted. Use the device’s own speaker at moderate
          volume (no Bluetooth speakers). Your normal click sound returns when the meter is off.
        </div>
      ) : (
        <div className="callout">
          <strong>Wired headphones only.</strong> Plug in wired earbuds or headphones (USB-C / Lightning on iPhone). Bluetooth
          (AirPods etc.) adds 150–300 ms of changing delay and can switch the mic into low-quality call mode, so timing
          can’t be measured reliably.
        </div>
      )}

      <div className="field">
        <div className="field-label">1 · Microphone</div>
        {acc.mic !== 'on' ? (
          <>
            <button type="button" className="wide-btn" onClick={() => void acc.openMic()} disabled={acc.mic === 'opening'}>
              {acc.mic === 'opening' ? 'Starting…' : 'Allow microphone'}
            </button>
            {acc.micError && <p className="hint error" role="alert">{acc.micError}</p>}
            <p className="hint">Sound is analysed on this device as you play. Nothing is recorded or uploaded.</p>
          </>
        ) : (
          <>
            {btSuspect && (
              <p className="hint error" role="alert">
                A Bluetooth device seems to be connected ({acc.meter.inputLabel || 'default device'}). Disconnect it and use{' '}
                {speaker ? 'the built-in speaker and microphone' : 'wired headphones'}.
              </p>
            )}
            {devices.length > 1 && (
              <label className="select-row">
                <span>Input</span>
                <select value={cfg.deviceId ?? ''} onChange={(e) => void acc.switchDevice(e.target.value || null)}>
                  <option value="">System default</option>
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || 'Microphone'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="level-row">
            <div className="level" aria-label={`Input level ${levelPct}%`} role="meter" aria-valuenow={levelPct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${levelPct}%` }} />
            </div>
            <span className="level-db">{levelDb === null ? '—' : `${levelDb} dB`}</span>
            </div>
            <p className="hint" aria-live="polite">
              Hit your pad a few times: <strong>{acc.probeHits}</strong> hits detected. Each hit should count once.
            </p>
            <label className="field-label" htmlFor="sens">
              Sensitivity <span className="value">{cfg.sensitivity}</span>
            </label>
            <input id="sens" type="range" min={1} max={10} value={cfg.sensitivity} onChange={(e) => m.updateMeter({ sensitivity: Number(e.target.value) })} />
            <p className="hint">Raise it for a pillow or soft pad, lower it if room noise or ghost notes count as hits.</p>
          </>
        )}
      </div>

      <div className="field">
        <div className="field-label">2 · Calibrate latency</div>
        {speaker ? (
          <p className="hint">
            Set the volume where you’ll practise (about half), put the device where it will be while you play, and stay
            silent. Tactus plays 10 ticks to time the speaker → mic delay, then 7 tone clicks to check none of them is
            mistaken for a hit.
          </p>
        ) : (
          <p className="hint">
            Hold one earbud right against the microphone (on iPhone: the bottom edge; with an in-line mic, the remote) and keep
            quiet. Tactus plays 10 clicks and measures how long they take to come back.
          </p>
        )}
        <button type="button" className="wide-btn" onClick={() => void runCalibration()} disabled={acc.mic !== 'on' || calibrating}>
          {calibrating ? 'Listening…' : 'Calibrate'}
        </button>
        {cal && (
          <p className={`hint ${cal.ok ? 'ok' : 'error'}`} role="status">
            {cal.ok
              ? `✓ Latency ${cal.latencyMs.toFixed(1)} ms (spread ${cal.spreadMs.toFixed(1)} ms, ${cal.detected}/${cal.expected} clicks).`
              : cal.reason === 'bluetooth'
                ? `Measured ${Math.round(cal.latencyMs)} ms — that’s Bluetooth territory (over ${MAX_WIRED_LATENCY_MS} ms). ${speaker ? 'Use the built-in speaker.' : 'Use wired headphones.'}`
                : cal.reason === 'noisy'
                  ? `Measurements were scattered (±${cal.spreadMs.toFixed(1)} ms). ${speaker ? 'Keep the room quiet and the device still' : 'Hold the earbud steady against the mic'} and retry.`
                  : notEnoughMessage(cal, speaker)}
          </p>
        )}
        {cal?.ok && cal.leakTested !== undefined && (
          <p className={`hint ${cal.leaked ? 'error' : 'ok'}`} role="status">
            {cal.leaked
              ? `${cal.leaked} of ${cal.leakTested} tone clicks were heard as hits. Turn the volume down a little (or lower sensitivity) and calibrate again.`
              : `✓ Click check: 0 of ${cal.leakTested} tone clicks were mistaken for hits.`}
          </p>
        )}
        <NumberStepper
          label="Latency"
          value={cfg.latencyMs ?? 0}
          min={-250}
          max={MAX_WIRED_LATENCY_MS}
          format={(v) => (cfg.latencyMs === null ? 'not set' : `${v.toFixed(1)} ms`)}
          onChange={(v) => m.updateMeter({ latencyMs: Math.round(v * 10) / 10 })}
        />
        <p className="hint">
          Recalibrate whenever you change {speaker ? 'volume a lot, device position,' : 'headphones'} or microphone. Fine-tune
          with − / + if needed.
        </p>
      </div>

      {diag && (
        <details className="diag">
          <summary>Diagnostics</summary>
          <dl>
            {Object.entries(diag).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            {cal && (
              <div>
                <dt>Last calibration</dt>
                <dd>
                  {cal.detected}/{cal.expected} clicks matched, {cal.heard ?? 0} sounds heard, peak {fmtDb(cal.peakDb)}
                  {cal.detected ? `, offset ${cal.latencyMs.toFixed(1)} ms ±${cal.spreadMs.toFixed(1)}` : ''}
                  {cal.leakTested !== undefined ? `, click leak ${cal.leaked}/${cal.leakTested}` : ''}
                </dd>
              </div>
            )}
          </dl>
        </details>
      )}

      <div className="field">
        <div className="field-label">3 · Play</div>
        <p className="hint">
          Turn on <strong>Listen while I play</strong> in Practice, press Start and play along. A count-in helps. Results open
          when you stop.
        </p>
        <label className="toggle-row">
          <span>Listen while I play</span>
          <input type="checkbox" role="switch" checked={cfg.enabled} onChange={(e) => m.updateMeter({ enabled: e.target.checked })} />
        </label>
      </div>
    </BottomSheet>
  );
}

const fmtDb = (db?: number) => (db === undefined || !Number.isFinite(db) ? 'silence' : `${Math.round(db)} dB`);

/** Explain a calibration that heard too few clicks, using what the mic did pick up. */
function notEnoughMessage(cal: CalibrationResult, speaker: boolean): string {
  const heard = cal.heard ?? 0;
  const quiet = cal.peakDb === undefined || cal.peakDb < -45;
  if (heard === 0 && quiet)
    return speaker
      ? `The microphone heard almost nothing (loudest ${fmtDb(cal.peakDb)}). Check that sound comes from this device’s speaker (not headphones or Bluetooth), raise the volume, check the input above, and retry.`
      : `The microphone heard almost nothing (loudest ${fmtDb(cal.peakDb)}). Check the input above, press the earbud right onto the mic, raise the volume, and retry.`;
  if (heard === 0)
    return `Sound reached the mic (loudest ${fmtDb(cal.peakDb)}) but no clicks were detected. Raise sensitivity and retry; if it still fails, open Diagnostics and send me what it says.`;
  return `Heard ${heard} sounds, but only ${cal.detected} of ${cal.expected} lined up with the clicks. Keep the room quiet${speaker ? '' : ', hold the earbud still on the mic,'} and retry.`;
}
