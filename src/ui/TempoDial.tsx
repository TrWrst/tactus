import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { MAX_BPM, MIN_BPM } from '../engine/types';
import { tempoMarking } from '../engine/rhythm';

interface Props {
  bpm: number;
  onChange(bpm: number): void;
  /** Rendered behind the number (pulse animation, count-in text, …). */
  children?: React.ReactNode;
  status?: string;
  /** Extra content under the status line (e.g. the live hit meter). */
  footer?: React.ReactNode;
}

const DEG_PER_BPM = 4; // one full turn ≈ 90 BPM
const ARC_START = -135; // 7:30 o’clock, measured clockwise from 12; the arc spans 270° to 4:30
const ARC_SPAN = 270;

const polar = (deg: number, r: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
};
const arcPath = (from: number, to: number, r: number) => {
  const [x1, y1] = polar(from, r);
  const [x2, y2] = polar(to, r);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
};

/** Circular tempo dial: drag around the ring, scroll, or use arrow keys. Tap the number to type. */
export function TempoDial({ bpm, onChange, children, status, footer }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ angle: number; acc: number; bpm: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const angleAt = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.bpm-readout')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { angle: angleAt(e), acc: 0, bpm };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const a = angleAt(e);
    let delta = a - d.angle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    d.angle = a;
    d.acc += delta;
    const next = Math.round(d.bpm + d.acc / DEG_PER_BPM);
    onChange(Math.min(MAX_BPM, Math.max(MIN_BPM, next)));
  };
  const endDrag = () => (drag.current = null);

  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const map: Record<string, number> = {
      ArrowUp: step,
      ArrowRight: step,
      ArrowDown: -step,
      ArrowLeft: -step,
      PageUp: 10,
      PageDown: -10,
    };
    if (e.key in map) {
      e.preventDefault();
      e.stopPropagation();
      onChange(bpm + map[e.key]);
    } else if (e.key === 'Home') onChange(MIN_BPM);
    else if (e.key === 'End') onChange(MAX_BPM);
  };

  const commit = () => {
    const v = parseInt(draft, 10);
    if (Number.isFinite(v)) onChange(v);
    setEditing(false);
  };

  const frac = (bpm - MIN_BPM) / (MAX_BPM - MIN_BPM);
  const knob = polar(ARC_START + frac * ARC_SPAN, 44);

  return (
    <div
      ref={ref}
      className="dial"
      role="slider"
      tabIndex={0}
      aria-label="Tempo"
      aria-valuemin={MIN_BPM}
      aria-valuemax={MAX_BPM}
      aria-valuenow={bpm}
      aria-valuetext={`${bpm} beats per minute, ${tempoMarking(bpm)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKey}
      onWheel={(e) => onChange(bpm + (e.deltaY < 0 ? 1 : -1))}
    >
      <svg className="dial-ring" viewBox="0 0 100 100" aria-hidden="true">
        <path d={arcPath(ARC_START, ARC_START + ARC_SPAN, 44)} className="dial-track" />
        {frac > 0.002 && <path d={arcPath(ARC_START, ARC_START + frac * ARC_SPAN, 44)} className="dial-fill" />}
        {Array.from({ length: 29 }, (_, i) => {
          const deg = ARC_START + (i / 28) * ARC_SPAN;
          const [x1, y1] = polar(deg, 37.5);
          const [x2, y2] = polar(deg, i % 7 === 0 ? 34.5 : 36);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="dial-tick" />;
        })}
        <circle cx={knob[0]} cy={knob[1]} r="3.6" className="dial-knob" />
      </svg>
      <div className="dial-center">
        {children}
        {editing ? (
          <input
            className="bpm-input bpm-readout"
            autoFocus
            type="number"
            inputMode="numeric"
            min={MIN_BPM}
            max={MAX_BPM}
            value={draft}
            aria-label={`Type a tempo between ${MIN_BPM} and ${MAX_BPM}`}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="bpm-readout"
            aria-label={`${bpm} BPM. Tap to type a tempo`}
            onClick={() => {
              setDraft(String(bpm));
              setEditing(true);
            }}
          >
            {bpm}
          </button>
        )}
        <div className="bpm-unit">BPM · {tempoMarking(bpm)}</div>
        {status && <div className="dial-status" aria-live="polite">{status}</div>}
        {footer}
      </div>
    </div>
  );
}
