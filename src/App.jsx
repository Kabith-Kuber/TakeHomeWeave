import { useEffect, useMemo, useState } from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";

const DIMS = [
  { key: "shipping", label: "Shipping", color: "#f54e00" },
  { key: "collaboration", label: "Collaboration", color: "#2f80ed" },
  { key: "breadth", label: "Breadth", color: "#1dbf8e" },
  { key: "quality", label: "Quality", color: "#f5a623" },
  { key: "influence", label: "Influence", color: "#a259ff" },
];

function scoreFor(eng, weights) {
  const total = DIMS.reduce((s, d) => s + (weights[d.key] || 0), 0) || 1;
  return DIMS.reduce(
    (s, d) => s + ((weights[d.key] || 0) / total) * eng.components[d.key].percentile,
    0
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [weights, setWeights] = useState(null);
  const [selected, setSelected] = useState(null);
  const [showMethod, setShowMethod] = useState(false);

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

  if (error) return <div className="loading">Error: {error}</div>;
  if (!data || !weights) return <div className="loading">Loading impact data…</div>;

  const sel = ranked.find((e) => e.login === selected) || top5[0];

  return (
    <div className="app">
      <Header data={data} onMethod={() => setShowMethod(true)} />

      <div className="grid">
        <section className="panel leaderboard">
          <div className="panel-head">
            <h2>Top 5 most impactful engineers</h2>
            <span className="muted">last {data.meta.days} days</span>
          </div>
          <ol className="cards">
            {top5.map((e, i) => (
              <LeaderCard
                key={e.login}
                eng={e}
                rank={i + 1}
                active={e.login === selected}
                onClick={() => setSelected(e.login)}
              />
            ))}
          </ol>

          {runnersUp.length > 0 && (
            <div className="runners">
              <h3>Runners-up</h3>
              <ol start={6} className="runner-list">
                {runnersUp.map((e, i) => (
                  <li
                    key={e.login}
                    className={`runner ${e.login === selected ? "active" : ""}`}
                    onClick={() => setSelected(e.login)}
                  >
                    <span className="runner-rank">{i + 6}</span>
                    <img className="runner-av" src={e.avatar} alt="" loading="lazy" />
                    <span className="runner-name">{e.login}</span>
                    <span className="runner-score">{Math.round(e.liveScore)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <Weights weights={weights} setWeights={setWeights} defaults={data.defaultWeights} />
        </section>

        <section className="panel detail">
          {sel && <Detail eng={sel} rank={ranked.findIndex((e) => e.login === sel.login) + 1} />}
        </section>
      </div>

      {showMethod && <Methodology data={data} onClose={() => setShowMethod(false)} />}
    </div>
  );
}

function Header({ data, onMethod }) {
  const m = data.meta;
  return (
    <header className="header">
      <div className="title">
        <h1>
          <span className="dot" /> PostHog Engineering Impact
        </h1>
        <p className="sub">
          {fmt(m.from)} → {fmt(m.to)} · {m.totalMergedPRs.toLocaleString()} merged PRs ·{" "}
          {m.contributorsAnalyzed.toLocaleString()} contributors ·{" "}
          {m.qualifiedContributors} ranked (≥{m.minPRs} PRs)
        </p>
      </div>
      <button className="method-btn" onClick={onMethod}>
        How is impact scored?
      </button>
    </header>
  );
}

function LeaderCard({ eng, rank, active, onClick }) {
  return (
    <li className={`card ${active ? "active" : ""}`} onClick={onClick}>
      <div className="rank">{rank}</div>
      <img className="avatar" src={eng.avatar} alt="" loading="lazy" />
      <div className="card-main">
        <div className="card-top">
          <span className="name">{eng.login}</span>
          <span className="score">{Math.round(eng.liveScore)}</span>
        </div>
        <SegmentBar eng={eng} />
      </div>
    </li>
  );
}

function SegmentBar({ eng }) {
  return (
    <div className="segbar" title="contribution by dimension">
      {DIMS.map((d) => {
        const v = eng.components[d.key].percentile;
        return (
          <div
            key={d.key}
            className="seg"
            style={{ flexGrow: Math.max(v, 1), background: d.color }}
          />
        );
      })}
    </div>
  );
}

function Detail({ eng, rank }) {
  const radarData = DIMS.map((d) => ({
    dim: d.label,
    value: eng.components[d.key].percentile,
  }));
  return (
    <div className="detail-inner">
      <div className="detail-head">
        <img className="avatar lg" src={eng.avatar} alt="" />
        <div>
          <a className="name lg" href={eng.profile} target="_blank" rel="noreferrer">
            {eng.login}
          </a>
          <div className="muted">
            Rank #{rank} · Impact score {Math.round(eng.liveScore)}/100
          </div>
        </div>
      </div>

      <p className="why">{whyText(eng)}</p>

      <div className="detail-body">
        <div className="radar-wrap">
          <ResponsiveContainer width="100%" height={210}>
            <RadarChart data={radarData} outerRadius={78}>
              <PolarGrid stroke="#2a2a36" />
              <PolarAngleAxis dataKey="dim" tick={{ fill: "#b9b9c6", fontSize: 11 }} />
              <Radar dataKey="value" stroke="#f54e00" fill="#f54e00" fillOpacity={0.35} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="dim-list">
          {DIMS.map((d) => (
            <div className="dim-row" key={d.key}>
              <span className="dim-dot" style={{ background: d.color }} />
              <span className="dim-name">{d.label}</span>
              <div className="dim-track">
                <div
                  className="dim-fill"
                  style={{
                    width: `${eng.components[d.key].percentile}%`,
                    background: d.color,
                  }}
                />
              </div>
              <span className="dim-pct">{Math.round(eng.components[d.key].percentile)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="evidence">
        <div className="stat-grid">
          <Stat label="Merged PRs" value={eng.stats.prCount} />
          <Stat label="Reviews given" value={eng.stats.reviewsGiven} />
          <Stat label="Subsystems" value={eng.stats.subsystemCount} />
          <Stat label="Bug-fix / test PRs" value={`${eng.stats.qualityCount} (${eng.stats.qualityShare}%)`} />
          <Stat label="Hotspot files" value={eng.stats.hotspotFiles} />
          <Stat label="Reviews received" value={eng.stats.reviewsReceived} />
        </div>

        <div className="evidence-cols">
          <div className="ev-col">
            <h4>Where they worked</h4>
            <div className="chips">
              {eng.topSubsystems.map((s) => (
                <span className="chip" key={s.dir}>
                  {s.dir} <b>{s.count}</b>
                </span>
              ))}
            </div>
          </div>
          <div className="ev-col">
            <h4>Notable PRs (most reviewed)</h4>
            <ul className="pr-list">
              {eng.topPRs.map((p) => (
                <li key={p.number}>
                  <a href={p.url} target="_blank" rel="noreferrer" title={p.title}>
                    #{p.number} {trim(p.title, 52)}
                  </a>
                  <span className="pr-meta">{p.reviewers} rev · {p.loc.toLocaleString()} loc</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="stat-val">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Weights({ weights, setWeights, defaults }) {
  return (
    <div className="weights">
      <div className="weights-head">
        <h3>Adjust the model</h3>
        <button className="reset" onClick={() => setWeights({ ...defaults })}>
          reset
        </button>
      </div>
      {DIMS.map((d) => (
        <div className="wrow" key={d.key}>
          <span className="dim-dot" style={{ background: d.color }} />
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
          <span className="wval">{Math.round(weights[d.key] * 100)}</span>
        </div>
      ))}
    </div>
  );
}

function Methodology({ data, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>How impact is scored</h2>
          <button className="close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted">
          Counting lines or commits doesn't capture impact. We measure five
          complementary dimensions from {data.meta.totalMergedPRs.toLocaleString()} merged
          PRs over the last {data.meta.days} days. Each engineer's raw value per dimension
          is converted to a <b>percentile rank</b> versus the {data.meta.qualifiedContributors}{" "}
          ranked contributors (those with ≥{data.meta.minPRs} merged PRs). The weighted blend
          of percentiles is the 0–100 impact score. Adjust the weights to pressure-test the ranking.
        </p>
        <ul className="method-list">
          {DIMS.map((d) => (
            <li key={d.key}>
              <span className="dim-dot" style={{ background: d.color }} />
              <div>
                <b>
                  {d.label}{" "}
                  <span className="muted">({Math.round(data.defaultWeights[d.key] * 100)}% default)</span>
                </b>
                <div className="muted">{data.dimensions[d.key]}</div>
              </div>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Hotspots = files in the top 10% by churn across the window (≥{data.meta.hotspotThreshold} PRs),
          {" "}{data.meta.hotspotFiles.toLocaleString()} files total. Bots are excluded. Reviews are credited
          only on other engineers' PRs.
        </p>
      </div>
    </div>
  );
}

const WHY = {
  shipping: (e) => `shipped ${e.stats.prCount} merged PRs`,
  collaboration: (e) => `gave ${e.stats.reviewsGiven} code reviews to teammates`,
  breadth: (e) => `worked across ${e.stats.subsystemCount} subsystems`,
  quality: (e) => `landed ${e.stats.qualityCount} bug-fix/test PRs (${e.stats.qualityShare}%)`,
  influence: (e) => `touched ${e.stats.hotspotFiles} high-churn core files`,
};

function whyText(eng) {
  const top = [...DIMS]
    .sort((a, b) => eng.components[b.key].percentile - eng.components[a.key].percentile)
    .slice(0, 3);
  const parts = top.map((d) => WHY[d.key](eng));
  return `Strongest in ${top.map((d) => d.label.toLowerCase()).slice(0, 2).join(" & ")}: ${parts.join(", ")}.`;
}

const fmt = (s) =>
  new Date(s + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
