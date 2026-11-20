import { useEffect, useRef, useState } from 'react';
import type { MetronomeEngine } from '../engine/audioEngine';
import type { JitterReport } from '../engine/stats';

const f = (x: number) => x.toFixed(2);

/**
 * Live scheduler-timing readout. "Stress UI" blocks the main thread for 60 ms
 * every 120 ms to show that clicks stay on time while the UI is busy.
 */
export function StatsPanel({ engine }: { engine: MetronomeEngine }) {
  const [r, setR] = useState<JitterReport>(engine.jitterReport());
  const [stress, setStress] = useState(false);
  const stressId = useRef<number>();

  useEffect(() => {
    const id = window.setInterval(() => setR(engine.jitterReport()), 500);
    return () => window.clearInterval(id);
  }, [engine]);

  useEffect(() => {
    if (!stress) return;
    stressId.current = window.setInterval(() => {
      const end = performance.now() + 60;
      while (performance.now() < end) {
        /* busy wait: simulate heavy UI work */
      }
    }, 120);
    return () => window.clearInterval(stressId.current);
  }, [stress]);

  return (
    <section className="stats" aria-label="Timing statistics">
      <div>
        timer {f(r.tickMean)}±{f(r.tickStd)} ms · p99 {f(r.tickP99)} · max {f(r.tickMax)} ({r.ticks})
      </div>
      <div>
        lead min {f(r.marginMin)} ms · mean {f(r.marginMean)} · late {r.late}/{r.scheduled} · dropped {r.dropped}
      </div>
      <div className="stats-actions">
        <button type="button" className={stress ? 'on' : ''} onClick={() => setStress(!stress)} aria-pressed={stress}>
          Stress UI
        </button>
        <button type="button" onClick={() => engine.resetStats()}>
          Reset
        </button>
      </div>
    </section>
  );
}
