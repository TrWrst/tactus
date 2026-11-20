import { consistencyLabel, type AccuracySummary } from '../engine/accuracy';
import { formatDuration } from '../engine/practice';
import { BottomSheet } from './BottomSheet';

const ms = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(Math.abs(x) < 10 ? 1 : 0)} ms`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const tendency = (meanMs: number) =>
  Math.abs(meanMs) < 3 ? 'right on the click' : meanMs < 0 ? 'ahead of the click (rushing)' : 'behind the click (dragging)';

/** Symmetric y-range that fits ~all hits, in steps of 10 ms. */
const rangeFor = (s: AccuracySummary) => {
  const abs = s.points.map((p) => Math.abs(p.offsetMs)).sort((a, b) => a - b);
  const p95 = abs[Math.floor(abs.length * 0.95)] ?? 0;
  return Math.min(150, Math.max(30, Math.ceil(p95 / 10) * 10));
};

function Timeline({ s, range }: { s: AccuracySummary; range: number }) {
  const W = 320;
  const H = 150;
  const pad = { l: 34, r: 8, t: 8, b: 18 };
  const x = (t: number) => pad.l + (t / Math.max(1, s.durationSec)) * (W - pad.l - pad.r);
  const y = (o: number) => pad.t + ((range - Math.max(-range, Math.min(range, o))) / (2 * range)) * (H - pad.t - pad.b);
  return (
    <figure className="chart">
      <figcaption>Every hit over time</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Timing of ${s.matched} hits over ${formatDuration(s.durationSec)}. Above the line is late, below is early.`}>
        <rect x={pad.l} y={y(10)} width={W - pad.l - pad.r} height={y(-10) - y(10)} className="band" />
        {[range, 0, -range].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'zero' : 'grid'} />
            <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" className="axis">
              {v === 0 ? '0' : v > 0 ? `+${v}` : `−${-v}`}
            </text>
          </g>
        ))}
        <text x={pad.l} y={H - 4} className="axis">0:00</text>
        <text x={W - pad.r} y={H - 4} textAnchor="end" className="axis">{formatDuration(s.durationSec)}</text>
        {s.points.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.offsetMs)} r={4} className={p.audible ? 'pt' : 'pt hollow'}>
            <title>{`${formatDuration(p.t)} · beat ${p.beat + 1}${p.sub ? `.${p.sub + 1}` : ''} · ${ms(p.offsetMs)}${p.audible ? '' : ' (no click)'}`}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-legend">
        <span><i className="sw" /> with click</span>
        {s.silent.n > 0 && <span><i className="sw hollow" /> silent beat</span>}
        <span><i className="sw band" /> ±10 ms</span>
        <span>above = late</span>
      </div>
    </figure>
  );
}

function Histogram({ s, range }: { s: AccuracySummary; range: number }) {
  const bin = range <= 40 ? 4 : range <= 80 ? 5 : 10;
  const nb = Math.round((2 * range) / bin);
  const counts = Array(nb).fill(0) as number[];
  s.points.forEach((p) => {
    const i = Math.floor((Math.max(-range, Math.min(range - 1e-9, p.offsetMs)) + range) / bin);
    counts[i]++;
  });
  const max = Math.max(1, ...counts);
  const W = 320;
  const H = 110;
  const pad = { l: 8, r: 8, t: 6, b: 18 };
  const bw = (W - pad.l - pad.r) / nb;
  const zeroX = pad.l + (range / (2 * range)) * (W - pad.l - pad.r);
  return (
    <figure className="chart">
      <figcaption>How your hits spread</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Histogram of hit offsets">
        {counts.map((c, i) => {
          const h = (c / max) * (H - pad.t - pad.b);
          const lo = -range + i * bin;
          return (
            <rect key={i} x={pad.l + i * bw + 1} y={H - pad.b - h} width={Math.max(1, bw - 2)} height={h} rx={2} className="bar">
              <title>{`${lo} to ${lo + bin} ms: ${c} hit${c === 1 ? '' : 's'}`}</title>
            </rect>
          );
        })}
        <line x1={zeroX} x2={zeroX} y1={pad.t} y2={H - pad.b} className="zero" />
        <text x={pad.l} y={H - 4} className="axis">early −{range}</text>
        <text x={zeroX} y={H - 4} textAnchor="middle" className="axis">0</text>
        <text x={W - pad.r} y={H - 4} textAnchor="end" className="axis">late +{range}</text>
      </svg>
    </figure>
  );
}

function ByBeat({ s }: { s: AccuracySummary }) {
  if (s.byBeat.length < 2) return null;
  const lim = Math.max(10, ...s.byBeat.map((b) => Math.abs(b.meanMs)));
  return (
    <figure className="chart">
      <figcaption>Average per beat</figcaption>
      <div className="bybeat">
        {s.byBeat.map((b) => {
          const w = (Math.abs(b.meanMs) / lim) * 50;
          return (
            <div key={b.beat} className="bybeat-row" title={`Beat ${b.beat + 1}: ${ms(b.meanMs)} over ${b.n} hits`}>
              <span className="bybeat-label">Beat {b.beat + 1}</span>
              <span className="bybeat-track">
                <span className="bybeat-bar" style={{ left: b.meanMs < 0 ? `${50 - w}%` : '50%', width: `${w}%` }} />
              </span>
              <span className="bybeat-val">{ms(b.meanMs)}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

export function ResultsSheet({
  result,
  calibrated,
  open,
  onClose,
}: {
  result: AccuracySummary | null;
  calibrated: boolean;
  open: boolean;
  onClose(): void;
}) {
  return (
    <BottomSheet title="Your timing" open={open} onClose={onClose}>
      {!result ? (
        <p className="hint">No results yet. Turn on the accuracy meter in Practice, press Start and play along.</p>
      ) : (
        <Results s={result} calibrated={calibrated} />
      )}
    </BottomSheet>
  );
}

function Results({ s, calibrated }: { s: AccuracySummary; calibrated: boolean }) {
  const range = rangeFor(s);
  return (
    <>
      <div className="hero">
        <div className="hero-num">±{s.sdMs.toFixed(1)} <small>ms</small></div>
        <div className="hero-label">
          {consistencyLabel(s.sdMs)} · consistency (standard deviation)
        </div>
      </div>
      <div className="tiles">
        <div className="tile">
          <b>{calibrated ? ms(s.meanMs) : '—'}</b>
          <span>{calibrated ? tendency(s.meanMs) : 'average (calibrate to see)'}</span>
        </div>
        <div className="tile">
          <b>{pct(s.within10)}</b>
          <span>within ±10 ms</span>
        </div>
        <div className="tile">
          <b>{pct(s.within25)}</b>
          <span>within ±25 ms</span>
        </div>
        <div className="tile">
          <b>{s.matched}</b>
          <span>hits{s.extras ? ` · ${s.extras} extra` : ''}</span>
        </div>
      </div>
      {!calibrated && (
        <p className="hint error">Not calibrated: offsets include your device’s latency, so early/late is not meaningful yet. Consistency is still accurate.</p>
      )}
      <Timeline s={s} range={range} />
      <Histogram s={s} range={range} />
      <ByBeat s={s} />
      <ul className="insights">
        {s.durationSec >= 30 && s.matched >= 10 && (
          <li>
            Drift: <b>{ms(s.driftMsPerMin)}</b> per minute{' '}
            {Math.abs(s.driftMsPerMin) < 3 ? '(steady)' : s.driftMsPerMin > 0 ? '(gradually falling behind)' : '(gradually pushing ahead)'}
          </li>
        )}
        {s.silent.n >= 4 && (
          <li>
            Silent beats: <b>±{s.silent.meanAbsMs.toFixed(1)} ms</b> average error vs <b>±{s.audible.meanAbsMs.toFixed(1)} ms</b> with
            the click.
          </li>
        )}
      </ul>
      <details className="table-view">
        <summary>All hits ({s.points.length})</summary>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Note</th>
              <th>Offset</th>
            </tr>
          </thead>
          <tbody>
            {s.points.map((p, i) => (
              <tr key={i}>
                <td>{formatDuration(p.t)}</td>
                <td>
                  {p.beat + 1}
                  {p.sub ? `.${p.sub + 1}` : ''}
                  {p.audible ? '' : ' (silent)'}
                </td>
                <td>{ms(p.offsetMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
