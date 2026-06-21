import { useEffect, useMemo, useState } from "react";

const DIMS = [
  { key: "shipping", label: "Shipping", color: "#34e0a1" },
  { key: "collaboration", label: "Review Leverage", color: "#58a6ff" },
  { key: "breadth", label: "Area Ownership", color: "#22d3ee" },
  { key: "quality", label: "Delivery Signal", color: "#fbbf24" },
  { key: "influence", label: "Scope Handled", color: "#a78bfa" },
];

const ANNOT = {
  shipping: (e) => `${e.stats.prCount} merged PRs`,
  collaboration: (e) => `${e.stats.reviewsGiven} reviews on others' PRs`,
  breadth: (e) => `${e.stats.subsystemCount} code areas`,
  quality: (e) => `${e.stats.qualityCount} fix / test PRs (${e.stats.qualityShare}%)`,
  influence: (e) => `${e.stats.hotspotFiles} core files`,
};

const WT_COLOR = {
  Feature: "#34e0a1",
  "Bug Fix": "#f87171",
  Infrastructure: "#58a6ff",
  Refactor: "#a78bfa",
  Tests: "#2dd4bf",
  Docs: "#fbbf24",
  Maintenance: "#6b7280",
};

const STYLE_COLOR = {
  "Product Shipper": "#34e0a1",
  "Technical Multiplier": "#58a6ff",
  "Systems Owner": "#a78bfa",
  "Full-Stack Owner": "#22d3ee",
  "Quality Improver": "#fbbf24",
  "Area Specialist": "#f59e0b",
  "Balanced Contributor": "#94a3b8",
};

function scoreFor(eng, weights) {
  const total = DIMS.reduce((s, d) => s + (weights[d.key] || 0), 0) || 1;
  return DIMS.reduce(
    (s, d) => s + ((weights[d.key] || 0) / total) * eng.components[d.key].percentile,
    0
  );
}

function whyText(eng) {
  const top = [...DIMS]
    .sort((a, b) => eng.components[b.key].percentile - eng.components[a.key].percentile)
    .slice(0, 2);
  return `Stands out for ${top.map((d) => d.label.toLowerCase()).join(" and ")} — ${ANNOT[top[0].key](eng)} and ${ANNOT[top[1].key](eng)}.`;
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [weights, setWeights] = useState(null);
  const [selected, setSelected] = useState(null);
  const [showMethod, setShowMethod] = useState(false);
  const [showTuner, setShowTuner] = useState(false);

  useEffect(() => {
    fetch("impact.json")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load data");
        return r.json();
      })
      .then((d) => {
        setData(d);
        setWeights({ ...d.defaultWeights });
      })
      .catch((e) => setError(e.message));
  }, []);

  const ranked = useMemo(() => {
    if (!data || !weights) return [];
    return [...data.engineers]
      .map((e) => ({ ...e, liveScore: scoreFor(e, weights) }))
      .sort((a, b) => b.liveScore - a.liveScore);
  }, [data, weights]);

  const top5 = ranked.slice(0, 5);
  const runnersUp = ranked.slice(5, 10);

  useEffect(() => {
    if (top5.length && (!selected || !top5.find((e) => e.login === selected))) {
      setSelected(top5[0].login);
    }
  }, [top5, selected]);

  if (error) return <div className="loading">Couldn’t load data: {error}</div>;
  if (!data || !weights) return <div className="loading">Loading…</div>;

  const sel = ranked.find((e) => e.login === selected) || top5[0];
  const selRank = ranked.findIndex((e) => e.login === sel.login) + 1;
  const selTopPct = Math.max(1, Math.round((selRank / ranked.length) * 100));
  const m = data.meta;

  return (
    <div className="page">
      <header className="head">
        <div className="head-left">
          <div className="brand">
            <span className="mark" /> Engineering Impact
            <span className="weave">· Weave-inspired</span>
          </div>
          <p className="tagline">
            Who had the most visible engineering impact at PostHog in the last {m.days} days — and
            what kind of impact it was.
          </p>
          <div className="badges">
            <span className="badge">Open-source GitHub signal analysis</span>
            <span className="badge ghost">Last 90 days</span>
          </div>
        </div>
        <button className="link-btn" onClick={() => setShowMethod(true)}>
          How impact is scored
        </button>
      </header>

      <div className="stats">
        <StatCard value={m.totalMergedPRs.toLocaleString()} label="PRs analyzed" />
        <StatCard value={m.contributorsAnalyzed.toLocaleString()} label="Engineers analyzed" />
        <StatCard value={m.reviewsAnalyzed.toLocaleString()} label="Reviews analyzed" />
        <StatCard value={m.codeAreas.toLocaleString()} label="Code areas detected" />
      </div>

      <TeamMix mix={m.teamWorkMix} />

      <main className="layout">
        <section className="list-col">
          <div className="col-head">Top 5 by Visible Impact Score</div>
          <ol className="top-list">
            {top5.map((e, i) => (
              <li
                key={e.login}
                className={`top-row ${e.login === selected ? "sel" : ""}`}
                onClick={() => setSelected(e.login)}
              >
                <span className="row-rank">{i + 1}</span>
                <img className="row-av" src={e.avatar} alt="" loading="lazy" />
                <div className="row-body">
                  <div className="row-line">
                    <span className="row-name">{e.login}</span>
                    <span className="row-score">{Math.round(e.liveScore)}</span>
                  </div>
                  <div className="row-track">
                    <div className="row-fill" style={{ width: `${e.liveScore}%` }} />
                  </div>
                  <div className="row-lens">
                    <span className="style-chip" style={{ color: STYLE_COLOR[e.impactStyle], borderColor: STYLE_COLOR[e.impactStyle] }}>
                      {e.impactStyle}
                    </span>
                    <Confidence level={e.confidence} />
                  </div>
                  <div className="row-take">{e.takeaway}</div>
                </div>
              </li>
            ))}
          </ol>

          {runnersUp.length > 0 && (
            <div className="also">
              <span className="also-label">Also strong</span>
              <ul className="also-list">
                {runnersUp.map((e, i) => (
                  <li
                    key={e.login}
                    className={e.login === selected ? "sel" : ""}
                    onClick={() => setSelected(e.login)}
                  >
                    <span className="also-rank">{i + 6}</span>
                    <span className="also-name">{e.login}</span>
                    <span className="also-style">{e.impactStyle}</span>
                    <span className="also-score">{Math.round(e.liveScore)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button className="tuner-toggle" onClick={() => setShowTuner((v) => !v)}>
            {showTuner ? "Hide weighting" : "Adjust what counts"}
          </button>
          {showTuner && (
            <div className="tuner">
              <div className="tuner-head">
                <span>Weighting</span>
                <button onClick={() => setWeights({ ...data.defaultWeights })}>reset</button>
              </div>
              {DIMS.map((d) => (
                <div className="tuner-row" key={d.key}>
                  <span className="dot" style={{ background: d.color }} />
                  <label>{d.label}</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(weights[d.key] * 100)}
                    onChange={(e) =>
                      setWeights({ ...weights, [d.key]: Number(e.target.value) / 100 })
                    }
                  />
                  <span className="tuner-val">{Math.round(weights[d.key] * 100)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="detail-col card">
          <div className="detail-top">
            <img className="detail-av" src={sel.avatar} alt="" />
            <div className="detail-id">
              <a className="detail-name" href={sel.profile} target="_blank" rel="noreferrer">
                {sel.login}
              </a>
              <div className="detail-sub">
                Rank #{selRank} · <span className="bench">Top {selTopPct}%</span> · Visible Impact
                Score {Math.round(sel.liveScore)} / 100
              </div>
              <div className="detail-quick">
                {sel.stats.prCount} PRs · {sel.stats.reviewsGiven} reviews given ·{" "}
                {sel.stats.reviewsReceived} received · {sel.stats.subsystemCount} code areas
              </div>
            </div>
            <div className="trend">
              <div className="trend-top">
                <span className="trend-num">{sel.stats.perWeek}</span>
                <span className="trend-unit">PRs / wk</span>
              </div>
              <Sparkline data={sel.weekly} />
              <div className="trend-cap">activity · last 13 weeks</div>
            </div>
          </div>

          <div className="lens-banner">
            <span className="style-chip lg" style={{ color: STYLE_COLOR[sel.impactStyle], borderColor: STYLE_COLOR[sel.impactStyle] }}>
              {sel.impactStyle}
            </span>
            <span className="lens-take">{sel.takeaway}</span>
            <Confidence level={sel.confidence} />
          </div>

          <p className="why">{whyText(sel)}</p>

          <div className="two">
            <div className="block">
              <h3>Impact Breakdown</h3>
              {DIMS.map((d) => (
                <div className="bd-row" key={d.key}>
                  <span className="bd-label">{d.label}</span>
                  <div className="bd-track">
                    <div
                      className="bd-fill"
                      style={{
                        width: `${sel.components[d.key].percentile}%`,
                        background: d.color,
                      }}
                    />
                    <span className="tick" style={{ left: "50%" }} />
                    <span className="tick" style={{ left: "90%" }} />
                  </div>
                  <span className="bd-annot">{ANNOT[d.key](sel)}</span>
                </div>
              ))}
              <p className="note">
                Bars = percentile vs. {m.qualifiedContributors} ranked contributors. Ticks mark the
                team <b>median</b> and <b>top 10%</b>.
              </p>
            </div>

            <div className="block">
              <h3>What kind of work</h3>
              <div className="mix">
                <Donut segments={sel.workMix} />
                <div className="mix-legend">
                  <div className="mix-summary">
                    Mostly <b>{sel.workMix[0]?.type}</b>
                    {sel.workMix[1] ? <> &amp; <b>{sel.workMix[1].type}</b></> : null}
                  </div>
                  {sel.workMix.slice(0, 5).map((w) => (
                    <div className="lg-row" key={w.type}>
                      <span className="dot" style={{ background: WT_COLOR[w.type] }} />
                      <span className="lg-name">{w.type}</span>
                      <span className="lg-pct">{w.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="two bottom">
            <div className="block">
              <h3>Where they worked</h3>
              <div className="tags">
                {sel.topSubsystems.map((s) => (
                  <span className="tag" key={s.dir}>
                    {s.dir} <b>{s.count}</b>
                  </span>
                ))}
              </div>
            </div>
            <div className="block">
              <h3>Evidence — notable PRs</h3>
              <ul className="prs">
                {sel.topPRs.map((p) => (
                  <li key={p.number}>
                    <a href={p.url} target="_blank" rel="noreferrer" title={p.title}>
                      {trim(p.title, 52)}
                    </a>
                    <span className="pr-meta">{p.reviewers} reviews</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <Insights data={data} top5={top5} />

      {showMethod && <Methodology data={data} onClose={() => setShowMethod(false)} />}
    </div>
  );
}

function StatCard({ value, label }) {
  return (
    <div className="stat-card card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Confidence({ level }) {
  return <span className={`conf conf-${level}`}>{level} confidence</span>;
}

function Insights({ data, top5 }) {
  const auto = data.meta.automation;
  // dominant work type across top 5
  const agg = {};
  top5.forEach((e) => e.workMix.forEach((w) => (agg[w.type] = (agg[w.type] || 0) + w.count)));
  const topType = Object.entries(agg).sort((a, b) => b[1] - a[1])[0]?.[0];
  // review-leverage leaders (independent of weights)
  const leverage = [...data.engineers]
    .sort((a, b) => b.stats.reviewsGiven - a.stats.reviewsGiven)
    .slice(0, 5);
  const maxRev = leverage[0]?.stats.reviewsGiven || 1;

  return (
    <section className="insights">
      <div className="insights-head">
        <h2>Weave-Style Leadership Insights</h2>
        <p>Not just who ranked highest — what is actually happening inside the team.</p>
      </div>
      <div className="insight-grid">
        <div className="card insight">
          <h3>Work Type Mix · Top 5</h3>
          <p className="ins-note">
            Across the top 5, the dominant work is <b>{topType}</b>. This distinguishes raw output
            from the <i>kind</i> of engineering work being shipped.
          </p>
          <div className="wtm-list">
            {top5.map((e) => (
              <div className="wtm-row" key={e.login}>
                <span className="wtm-name">{e.login}</span>
                <div className="wtm-badges">
                  {e.workMix.slice(0, 2).map((w) => (
                    <span key={w.type} className="wtm-badge" style={{ borderColor: WT_COLOR[w.type] }}>
                      <span className="dot sm" style={{ background: WT_COLOR[w.type] }} />
                      {w.type} {w.pct}%
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card insight">
          <h3>Review Leverage</h3>
          <p className="ins-note">
            Impact is not only what someone ships directly. Review leverage captures engineers who
            multiply the output of others.
          </p>
          <div className="lev-list">
            {leverage.map((e) => (
              <div className="lev-row" key={e.login}>
                <span className="lev-name">{e.login}</span>
                <div className="lev-track">
                  <div className="lev-fill" style={{ width: `${(e.stats.reviewsGiven / maxRev) * 100}%` }} />
                </div>
                <span className="lev-val">{e.stats.reviewsGiven}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card insight">
          <h3>AI-Readiness Proxy</h3>
          <div className="ai-nums">
            <div>
              <div className="ai-big" style={{ color: "#34e0a1" }}>{auto.assistablePct}%</div>
              <div className="ai-cap">potentially AI-assistable</div>
            </div>
            <div>
              <div className="ai-big" style={{ color: "#f87171" }}>{auto.humanPct}%</div>
              <div className="ai-cap">likely human-judgment-heavy</div>
            </div>
          </div>
          <div className="ai-bar">
            <div className="ai-seg" style={{ width: `${auto.assistablePct}%`, background: "#34e0a1" }} />
            <div className="ai-seg" style={{ width: `${auto.standardPct}%`, background: "#6b7280" }} />
            <div className="ai-seg" style={{ width: `${auto.humanPct}%`, background: "#f87171" }} />
          </div>
          <p className="disclaimer">
            Not actual AI attribution. A directional proxy based on public PR metadata (work type,
            size, files touched).
          </p>
        </div>

        <div className="card insight">
          <h3>Questions this helps answer</h3>
          <ul className="q-list">
            <li>Who is shipping visible product and platform work?</li>
            <li>Who is creating leverage through reviews?</li>
            <li>Which engineers show broad ownership across code areas?</li>
            <li>What type of work is dominating the last 90 days?</li>
            <li>Where might AI assistance help with repetitive work?</li>
          </ul>
        </div>
      </div>

      <div className="card limits">
        <b>Methodology &amp; limitations.</b> A Weave-inspired approach: instead of treating impact
        as raw activity, it normalizes visible GitHub signals into a leadership-friendly view of
        shipped work, scope handled, review leverage, ownership, and delivery signal. This is{" "}
        <b>not a performance review</b> — it is a directional view based only on public GitHub
        activity, and cannot capture private mentoring, planning, Slack help, design work,
        incidents, or internal product judgment.
      </div>
    </section>
  );
}

function TeamMix({ mix }) {
  const shown = mix.filter((w) => w.pct >= 1);
  return (
    <div className="teammix card">
      <span className="teammix-label">What the team shipped</span>
      <div className="teammix-bar">
        {shown.map((w) => (
          <div
            key={w.type}
            className="tm-seg"
            style={{ width: `${w.pct}%`, background: WT_COLOR[w.type] }}
            title={`${w.type}: ${w.pct}%`}
          />
        ))}
      </div>
      <div className="teammix-legend">
        {shown.map((w) => (
          <span key={w.type} className="tm-lg">
            <span className="dot sm" style={{ background: WT_COLOR[w.type] }} />
            {w.type} {w.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

function Sparkline({ data, w = 150, h = 38 }) {
  const max = Math.max(...data, 1);
  const n = data.length;
  const step = n > 1 ? w / (n - 1) : w;
  const pad = 3;
  const y = (v) => h - pad - (v / max) * (h - pad * 2);
  const pts = data.map((v, i) => [i * step, y(v)]);
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polygon points={area} className="spark-area" />
      <polyline points={line} className="spark-line" fill="none" />
      {last && <circle cx={last[0]} cy={last[1]} r="2.4" className="spark-dot" />}
    </svg>
  );
}

function Donut({ segments, size = 116, stroke = 20 }) {
  const total = segments.reduce((s, w) => s + w.count, 0) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const top = segments[0];
  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        {segments.map((w) => {
          const frac = w.count / total;
          const el = (
            <circle
              key={w.type}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={WT_COLOR[w.type]}
              strokeWidth={stroke}
              strokeDasharray={`${frac * c} ${c}`}
              strokeDashoffset={-acc * c}
            />
          );
          acc += frac;
          return el;
        })}
      </g>
      <text x="50%" y="46%" className="donut-num">{top?.pct}%</text>
      <text x="50%" y="62%" className="donut-cap">{top?.type}</text>
    </svg>
  );
}

function Methodology({ data, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>How impact is scored</h2>
          <button className="close" onClick={onClose}>×</button>
        </div>
        <p className="modal-p">
          This dashboard uses a <b>Weave-inspired approach</b>: instead of treating engineering
          impact as raw activity, it normalizes visible GitHub signals into a leadership-friendly
          view of shipped work, scope handled, review leverage, ownership, and delivery signal.
          Each signal is turned into a percentile (0–100) versus the{" "}
          {data.meta.qualifiedContributors} contributors with at least {data.meta.minPRs} merged
          PRs, then blended into one Visible Impact Score.
        </p>
        <ul className="modal-list">
          {DIMS.map((d) => (
            <li key={d.key}>
              <span className="dot" style={{ background: d.color }} />
              <div>
                <b>{d.label}</b>{" "}
                <span className="muted">({Math.round(data.defaultWeights[d.key] * 100)}%)</span>
                <div className="muted">{data.dimensions[d.key]}</div>
              </div>
            </li>
          ))}
        </ul>
        <p className="modal-p muted small">
          <b>This is not a performance review.</b> It is a directional view based only on public
          GitHub activity. It cannot capture private mentoring, planning, Slack help, design work,
          incidents, or internal product judgment. Bots are excluded; reviews are counted only on
          other people’s PRs.
        </p>
      </div>
    </div>
  );
}

const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
