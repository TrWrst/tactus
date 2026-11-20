import { useEffect, useState } from 'react';
import type { MetronomeEngine } from '../engine/audioEngine';
import { formatDuration } from '../engine/practice';

/** Session stopwatch: time since Start. Freezes on stop, resets on the next Start. */
export function Stopwatch({ engine, running }: { engine: MetronomeEngine; running: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const read = () => {
      const start = engine.sessionStart;
      if (start !== null) setElapsed((performance.now() - start) / 1000);
    };
    read();
    if (!running) return;
    const id = window.setInterval(read, 250);
    return () => window.clearInterval(id);
  }, [engine, running]);

  if (!running && engine.sessionStart === null) return <span className="stopwatch idle" aria-hidden="true" />;
  return (
    <span className={`stopwatch ${running ? 'on' : ''}`} role="timer" aria-label={`Session time ${formatDuration(elapsed)}`}>
      {formatDuration(elapsed)}
    </span>
  );
}
