import { useEffect, useMemo, useState } from "react";

const DIMS = [
  { key: "shipping", label: "Shipping", color: "#f54e00" },
  { key: "collaboration", label: "Collaboration", color: "#2563eb" },
  { key: "breadth", label: "Breadth", color: "#0d9488" },
  { key: "quality", label: "Quality", color: "#d97706" },
  { key: "influence", label: "Influence", color: "#7c3aed" },
];

const ANNOT = {
  shipping: (e) => `${e.stats.prCount} merged PRs`,
  collaboration: (e) => `${e.stats.reviewsGiven} reviews given`,
  breadth: (e) => `${e.stats.subsystemCount} subsystems`,
  quality: (e) => `${e.stats.qualityCount} bug-fix / test PRs (${e.stats.qualityShare}%)`,
  influence: (e) => `${e.stats.hotspotFiles} high-churn files`,
};

const WT_COLOR = {
  Feature: "#f54e00",
  "Bug Fix": "#d4334a",
  Infrastructure: "#2563eb",
  Refactor: "#7c3aed",
  Tests: "#0d9488",
  Docs: "#c98a00",
  Maintenance: "#8a8780",
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

function mixText(eng) {
  const top = eng.workMix.slice(0, 2);
  return top.map((w) => `${w.type} ${w.pct}%`).join(", ");
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
  const m = data.meta;

  return (
    <div className="page">
      <header className="head">
        <div>
          <div className="brand">
            <span className="mark" /> Engineering Impact
          </div>
          <p className="tagline">
            The 5 most impactful engineers at PostHog over the last {m.days} days.
          </p>
        </div>
        <div className="head-meta">
          <span>{m.totalMergedPRs.toLocaleString()} merged PRs</span>
          <span>{m.contributorsAnalyzed} contributors</span>
          <span>{fmt(m.from)} – {fmt(m.to)}</span>
          <button className="link-btn" onClick={() => setShowMethod(true)}>
            How is this measured?
          </button>
        </div>
      </header>

      <TeamMix mix={m.teamWorkMix} />

      <main className="layout">
        <section className="list-col">
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
                  <div className="row-types">
                    {e.workMix.slice(0, 2).map((w) => (
                      <span key={w.type} className="rt">
                        <span className="dot sm" style={{ background: WT_COLOR[w.type] }} />
                        {w.type}
                      </span>
                    ))}
                  </div>
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

        <section className="detail-col">
          <div className="detail-top">
            <img className="detail-av" src={sel.avatar} alt="" />
            <div className="detail-id">
              <a className="detail-name" href={sel.profile} target="_blank" rel="noreferrer">
                {sel.login}
              </a>
              <div className="detail-sub">
                Rank #{selRank} · Impact score {Math.round(sel.liveScore)} / 100
              </div>
              <div className="detail-quick">
                {sel.stats.prCount} PRs · {sel.stats.reviewsGiven} reviews given ·{" "}
                {sel.stats.reviewsReceived} received · {sel.stats.subsystemCount} subsystems
              </div>
            </div>
          </div>

          <p className="why">{whyText(sel)}</p>

          <div className="two">
            <div className="block">
              <h3>Why — impact breakdown</h3>
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
                  </div>
                  <span className="bd-annot">{ANNOT[d.key](sel)}</span>
                </div>
              ))}
              <p className="note">
                Bars = percentile vs. the {m.qualifiedContributors} ranked contributors.
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
              <h3>Notable PRs</h3>
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

      {showMethod && <Methodology data={data} onClose={() => setShowMethod(false)} />}
    </div>
  );
}

function TeamMix({ mix }) {
  const shown = mix.filter((w) => w.pct >= 1);
  return (
    <div className="teammix">
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

function Donut({ segments, size = 116, stroke = 20 }) {
  const total = segments.reduce((s, w) => s + w.count, 0) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const top = segments[0];
  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#efece6" strokeWidth={stroke} />
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
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>How we measure impact</h2>
          <button className="close" onClick={onClose}>×</button>
        </div>
        <p className="modal-p">
          Lines of code and commit counts don’t capture real impact, so we score five
          complementary signals from {data.meta.totalMergedPRs.toLocaleString()} merged PRs over
          the last {data.meta.days} days. For each engineer, every signal is turned into a
          percentile (0–100) versus the {data.meta.qualifiedContributors} contributors with at
          least {data.meta.minPRs} merged PRs, then blended into one score.
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
          <b>Work type</b> classifies each PR into one of {data.workTypes.length} buckets
          (Feature, Bug Fix, Infrastructure, Refactor, Tests, Docs, Maintenance) from its
          conventional-commit prefix, labels, and changed files — so you see not just who had
          impact, but what kind. Bots are excluded; reviews are only counted on other people’s
          PRs. Use “Adjust what counts” to re-weight the signals yourself.
        </p>
      </div>
    </div>
  );
}

const fmt = (s) =>
  new Date(s + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
