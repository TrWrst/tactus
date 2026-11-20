import type { Judgment, LessonResult } from './scorer';

export const fmtMs = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(Math.abs(x) < 10 ? 1 : 0)} ms`;

export const JUDGMENT_LABEL: Record<Judgment, string> = {
  perfect: 'Perfect',
  great: 'Great',
  good: 'Good',
  off: 'Off',
  miss: 'Miss',
  extra: 'Extra',
};

export function Stars({ n, size = 'md', label }: { n: number; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  return (
    <span className={`stars stars-${size}`} role="img" aria-label={label ?? `${n} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className={i < n ? 'star on' : 'star'} aria-hidden="true">
          <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2 6.3 20.3l1.2-6.4L2.8 9.5l6.4-.8z" />
        </svg>
      ))}
    </span>
  );
}

/** What it takes to earn the next star, in plain words. */
export function nextStarHint(r: LessonResult): string | null {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (r.stars === 0) return `1 star: get 70% of notes within ±35 ms (you had ${pct(r.within35)}).`;
  if (r.stars === 1) return `2 stars: tighten your spread to ±15 ms (you had ±${r.sdMs.toFixed(1)}).`;
  if (r.stars === 2)
    return `3 stars: spread under ±8 ms and 90% within ±20 ms (you had ±${r.sdMs.toFixed(1)}, ${pct(r.within20)}).`;
  return null;
}

/** Small offset-over-time chart for a result. */
export function MiniTimeline({ r }: { r: LessonResult }) {
  if (r.points.length < 2) return null;
  const W = 320;
  const H = 120;
  const pad = { l: 30, r: 6, t: 6, b: 14 };
  const range = Math.min(80, Math.max(30, Math.ceil(Math.max(...r.points.map((p) => Math.abs(p.ms))) / 10) * 10));
  const dur = Math.max(1, r.durationSec);
  const x = (t: number) => pad.l + (t / dur) * (W - pad.l - pad.r);
  const y = (ms: number) => pad.t + ((range - Math.max(-range, Math.min(range, ms))) / (2 * range)) * (H - pad.t - pad.b);
  return (
    <figure className="chart">
      <figcaption>Every note over time</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Offsets of ${r.points.length} notes. Above the line is late.`}>
        <rect x={pad.l} y={y(20)} width={W - pad.l - pad.r} height={y(-20) - y(20)} className="band" />
        {[range, 0, -range].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'zero' : 'grid'} />
            <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" className="axis">
              {v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0'}
            </text>
          </g>
        ))}
        {r.points.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.ms)} r={3} className={p.audible ? 'pt' : 'pt hollow'}>
            <title>{fmtMs(p.ms)}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-legend">
        <span><i className="sw band" /> ±20 ms</span>
        {r.silentMeanAbsMs !== null && <span><i className="sw hollow" /> no click</span>}
        <span>above = late</span>
      </div>
    </figure>
  );
}
