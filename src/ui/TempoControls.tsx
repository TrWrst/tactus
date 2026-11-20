import { useRef, useState, type ReactNode } from 'react';
import { MinusIcon, PlusIcon } from './icons';

/** Button that repeats while held (pointer or keyboard). */
function RepeatButton({ onStep, label, children }: { onStep(): void; label: string; children: ReactNode }) {
  const timer = useRef<number>();
  const stop = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const start = () => {
    onStep();
    const repeat = (delay: number) => {
      timer.current = window.setTimeout(() => {
        onStep();
        repeat(Math.max(40, delay * 0.85));
      }, delay);
    };
    timer.current = window.setTimeout(() => repeat(110), 380);
  };
  return (
    <button
      type="button"
      className="round-btn"
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          onStep();
        }
      }}
    >
      {children}
    </button>
  );
}

export function TempoControls({ onNudge, onTap }: { onNudge(d: number): void; onTap(): number | null }) {
  const [flash, setFlash] = useState(0);
  return (
    <div className="tempo-controls">
      <RepeatButton onStep={() => onNudge(-1)} label="Decrease tempo">
        <MinusIcon />
      </RepeatButton>
      <button
        type="button"
        className="tap-btn"
        onPointerDown={() => {
          onTap();
          setFlash((f) => f + 1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onTap();
            setFlash((f) => f + 1);
          }
        }}
        aria-label="Tap tempo. Tap repeatedly in time."
      >
        {flash > 0 && <span key={flash} className="tap-glow" aria-hidden="true" />}
        Tap
      </button>
      <RepeatButton onStep={() => onNudge(1)} label="Increase tempo">
        <PlusIcon />
      </RepeatButton>
    </div>
  );
}
