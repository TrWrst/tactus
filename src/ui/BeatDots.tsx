import { ACCENT_LABELS } from '../engine/accents';
import type { AccentLevel } from '../engine/types';

interface Props {
  accents: AccentLevel[];
  activeBeat: number | null;
  beatKey: number;
  countIn: boolean;
  /** The active beat is silenced by the muting trainer. */
  silent?: boolean;
  onCycle(i: number): void;
}

/** Beat indicator + accent editor: tap a beat to cycle Accent / Normal / Soft / Muted. */
export function BeatDots({ accents, activeBeat, beatKey, countIn, silent, onCycle }: Props) {
  return (
    <div
      className={`beat-dots ${accents.length > 8 ? 'dense' : ''}`}
      role="group"
      aria-label="Beat accents. Tap a beat to change its accent."
    >
      {accents.map((level, i) => {
        const active = activeBeat === i;
        return (
          <button
            key={i}
            type="button"
            className={`beat-dot lvl-${level} ${active ? 'active' : ''} ${active && countIn ? 'count-in' : ''} ${active && silent ? 'silent' : ''}`}
            onClick={() => onCycle(i)}
            aria-label={`Beat ${i + 1}: ${ACCENT_LABELS[level]}`}
          >
            <span className="dot-shape" key={active ? beatKey : undefined} />
          </button>
        );
      })}
    </div>
  );
}
