import { STAGES, lessonById } from './curriculum';
import { BADGES, EDGE_PATTERNS, MAX_STARS, levelOf, totalStars } from './progress';
import type { ProgressApi } from './useProgress';

/** Long-term view: level, streak, spread over time, skills, records and badges. */
export function ProgressTab({ prog }: { prog: ProgressApi }) {
  const p = prog.progress;
  const lvl = levelOf(p.xp);
  const recent = p.history.slice(-30);
  const done = Object.values(p.lessons).filter((l) => l.bestStars > 0).length;

  return (
    <div className="tab-page">
      <div className="tiles">
        <div className="tile"><b>Level {lvl.level}</b><span>{p.xp} XP · {lvl.need - lvl.into} to next</span></div>
        <div className="tile"><b>{p.streak.count} day{p.streak.count === 1 ? '' : 's'}</b><span>practice streak</span></div>
        <div className="tile"><b>{totalStars(p)} / {MAX_STARS}</b><span>stars</span></div>
        <div className="tile"><b>{done}</b><span>lessons passed</span></div>
      </div>

      <SpreadChart points={recent.map((h) => ({ sd: h.sdMs, label: `${lessonById(h.lessonId)?.title ?? h.lessonId} · ${new Date(h.at).toLocaleDateString()}` }))} />

      <section aria-labelledby="skills-h">
        <h3 id="skills-h">By skill</h3>
        <div className="bybeat">
          {STAGES.map((st) => {
            const xs = p.history.filter((h) => h.skill === st.skill).slice(-10).map((h) => h.sdMs);
            const avg = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
            const w = avg === null ? 0 : Math.min(100, (avg / 40) * 100);
            return (
              <div key={st.n} className="skill-row" title={avg === null ? 'No results yet' : `Average spread of the last ${xs.length}`}>
                <span className="bybeat-label">{st.title}</span>
                <span className="skill-track"><span className="skill-bar" style={{ width: `${w}%` }} /></span>
                <span className="bybeat-val">{avg === null ? '—' : `±${avg.toFixed(1)}`}</span>
              </div>
            );
          })}
        </div>
        <p className="hint">Average spread of your last 10 results per skill. Shorter is tighter.</p>
      </section>

      <section aria-labelledby="edge-h2">
        <h3 id="edge-h2">Top clean tempos</h3>
        <div className="edge-grid">
          {EDGE_PATTERNS.map((e) => (
            <div key={e.id} className="edge-btn static">
              <span>{e.title}</span>
              <b>{p.edge[e.id] ? `${p.edge[e.id]} BPM` : '—'}</b>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="badges-h">
        <h3 id="badges-h">Badges · {Object.keys(p.badges).length}/{BADGES.length}</h3>
        <ul className="badge-grid">
          {BADGES.map((b) => {
            const at = p.badges[b.id];
            return (
              <li key={b.id} className={`badge ${at ? 'earned' : ''}`}>
                <span className="badge-icon" aria-hidden="true">{at ? '★' : '☆'}</span>
                <div>
                  <b>{b.title}</b>
                  <div className="hint">{at ? `Earned ${new Date(at).toLocaleDateString()}` : b.how}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <button
        type="button"
        className="wide-btn secondary"
        onClick={() => {
          if (window.confirm('Reset all training progress? Stars, XP, streak, badges and history will be deleted. This can’t be undone.')) prog.reset();
        }}
      >
        Reset progress
      </button>
    </div>
  );
}

function SpreadChart({ points }: { points: { sd: number; label: string }[] }) {
  if (points.length < 2) {
    return <p className="hint">Your spread over time appears here after a few lessons.</p>;
  }
  const W = 320;
  const H = 130;
  const pad = { l: 30, r: 8, t: 8, b: 16 };
  const max = Math.max(20, Math.ceil(Math.max(...points.map((p) => p.sd)) / 10) * 10);
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - Math.min(v, max) / max) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.sd).toFixed(1)}`).join(' ');
  return (
    <figure className="chart">
      <figcaption>Spread, last {points.length} results (lower is tighter)</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spread of recent results over time">
        <rect x={pad.l} y={y(8)} width={W - pad.l - pad.r} height={y(0) - y(8)} className="band" />
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" className="axis">{v}</text>
          </g>
        ))}
        <path d={path} className="line" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.sd)} r={4} className="pt">
            <title>{`${p.label}: ±${p.sd.toFixed(1)} ms`}</title>
          </circle>
        ))}
        <text x={pad.l} y={H - 3} className="axis">older</text>
        <text x={W - pad.r} y={H - 3} textAnchor="end" className="axis">latest</text>
      </svg>
      <div className="chart-legend"><span><i className="sw band" /> ±8 ms (3-star zone)</span></div>
    </figure>
  );
}
