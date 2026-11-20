import type { LiveAccuracy } from '../state/useAccuracy';

const RANGE = 50;

/** Tiny live readout under the BPM: last hit position on a ±50 ms track. */
export function HitMeter({ live, listening }: { live: LiveAccuracy; listening: boolean }) {
  const last = live.last;
  const pos = last === null ? null : 50 + (Math.max(-RANGE, Math.min(RANGE, last)) / RANGE) * 50;
  const text =
    live.n === 0
      ? listening
        ? 'Listening…'
        : 'Starting mic…'
      : last === null
        ? 'off the grid'
        : `${last > 0 ? '+' : last < 0 ? '−' : '±'}${Math.abs(last).toFixed(0)} ms ${Math.abs(last) < 3 ? '' : last < 0 ? 'early' : 'late'}`;
  return (
    <div className="hitmeter" aria-live="off">
      <div className="hm-track" aria-hidden="true">
        <span className="hm-center" />
        {pos !== null && (
          <span key={live.n} className={`hm-dot ${Math.abs(last!) <= 10 ? 'good' : ''}`} style={{ left: `${pos}%` }} />
        )}
      </div>
      <div className="hm-text">
        {text}
        {live.matched >= 4 && <span className="hm-sd"> · ±{live.sdMs.toFixed(0)}</span>}
      </div>
    </div>
  );
}
