// Reads data/raw-prs.json and computes the multi-dimensional impact model,
// writing public/impact.json (consumed by the dashboard).
//
// Impact is intentionally NOT raw lines/commits. Five dimensions, each reduced
// to a single transparent raw metric, then percentile-ranked across qualified
// contributors and combined with weights:
//
//   Shipping      (25%) - log-dampened code volume across merged PRs
//   Collaboration (25%) - reviews given on OTHER people's PRs
//   Breadth       (15%) - distinct subsystems (top-level dirs) touched
//   Quality       (15%) - count of bug-fix / test PRs
//   Influence     (20%) - distinct repo "hotspot" (high-churn) files touched
//
// Every raw input is kept in the output so the dashboard can show its work.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MIN_PRS = 3; // a contributor must have >=3 merged PRs to be ranked
const NWEEKS = 13; // ~90 days of weekly activity buckets (Workweave-style trend)
const DEFAULT_WEIGHTS = {
  shipping: 0.25,
  collaboration: 0.25,
  breadth: 0.15,
  quality: 0.15,
  influence: 0.2,
};

const BOT_RE = /(\[bot\]$|^dependabot|^github-actions|bot$|^posthog-bot|^renovate|^snyk|^sentry-io|^codecov|^greenkeeper)/i;
const isBot = (login, type) =>
  !login || type === "Bot" || BOT_RE.test(login);

function topDir(path) {
  if (!path) return "(root)";
  const parts = path.split("/");
  return parts.length > 1 ? parts[0] : "(root)";
}

function isBugfixPR(pr) {
  if (pr.labels.some((l) => /bug|hotfix|regression/i.test(l))) return true;
  return /^\s*(fix|bugfix|hotfix)(\(|:|\s)/i.test(pr.title) || /\bfix(es|ed)?\b/i.test(pr.title);
}

function isTestPR(pr) {
  if (/^\s*(test|tests|ci|chore\(test)/i.test(pr.title)) return true;
  return pr.files.some((f) =>
    /(^|\/)(tests?|__tests__|e2e|cypress)\//i.test(f) ||
    /(\.test\.|\.spec\.|_test\.|test_)/i.test(f)
  );
}

// The seven work types we bucket every PR into (display order).
const WORK_TYPES = [
  "Feature",
  "Bug Fix",
  "Infrastructure",
  "Refactor",
  "Tests",
  "Docs",
  "Maintenance",
];

const isTestFile = (f) =>
  /(^|\/)(tests?|__tests__|e2e|cypress)\//i.test(f) || /(\.test\.|\.spec\.|_test\.|test_)/i.test(f);
const isDocFile = (f) => /\.mdx?$/i.test(f) || /(^|\/)docs?\//i.test(f) || /readme|changelog/i.test(f);
const isInfraFile = (f) =>
  /(^|\/)\.github\//i.test(f) ||
  /(dockerfile|docker-compose)/i.test(f) ||
  /\.(ya?ml|tf|toml|sh)$/i.test(f) ||
  /(^|\/)(requirements[^/]*\.txt|package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|pyproject\.toml|Makefile)$/i.test(f);

// Rule-based work-type classifier. Each PR is assigned ONE type so the per-engineer
// mix sums to 100%. Priority: conventional-commit prefix -> labels -> title keywords
// -> changed-file majority -> sensible default. Intentionally lightweight.
function classifyWorkType(pr) {
  const t = (pr.title || "").toLowerCase().trim();
  const labels = pr.labels.map((l) => l.toLowerCase());
  const files = pr.files || [];

  const depsLike =
    /\(deps(-dev)?\)|\bbump\b|\bdependabot\b|upgrade .+ to |update .+ (dependency|dependencies)|\bdeps\b/.test(t) ||
    labels.some((l) => /dependen/.test(l));

  // 1) conventional-commit prefix, e.g. "feat(scope):", "fix:", "chore!:"
  const m = t.match(/^(\w+)(\([^)]*\))?!?:/);
  const prefix = m ? m[1] : null;
  if (prefix) {
    if (prefix === "feat" || prefix === "feature") return "Feature";
    if (prefix === "fix" || prefix === "bugfix" || prefix === "hotfix") return "Bug Fix";
    if (prefix === "docs" || prefix === "doc") return "Docs";
    if (prefix === "test" || prefix === "tests") return "Tests";
    if (prefix === "refactor" || prefix === "perf" || prefix === "style") return "Refactor";
    if (prefix === "ci" || prefix === "build" || prefix === "infra" || prefix === "deploy")
      return "Infrastructure";
    if (prefix === "chore") return depsLike ? "Infrastructure" : "Maintenance";
  }

  // 2) labels
  if (labels.some((l) => /\bbug\b|regression|hotfix/.test(l))) return "Bug Fix";
  if (labels.some((l) => /feature|enhancement/.test(l))) return "Feature";
  if (labels.some((l) => /documentation|\bdocs\b/.test(l))) return "Docs";
  if (depsLike) return "Infrastructure";

  // 3) title keywords
  if (/\bfix(es|ed)?\b|\bbug\b|\bregression\b/.test(t)) return "Bug Fix";
  if (/\brefactor|clean ?up|\brename\b|simplif|\btidy\b|dedupe|deduplicat|\bmove\b/.test(t)) return "Refactor";
  if (/\bdocs?\b|readme|changelog/.test(t)) return "Docs";

  // 4) changed-file majority
  if (files.length) {
    const ratio = (pred) => files.filter(pred).length / files.length;
    if (ratio(isTestFile) >= 0.6) return "Tests";
    if (ratio(isDocFile) >= 0.6) return "Docs";
    if (ratio(isInfraFile) >= 0.6) return "Infrastructure";
  }

  // 5) defaults
  if (/\badd\b|\bsupport\b|\bintroduce\b|\bimplement\b|\benable\b|\bnew\b/.test(t)) return "Feature";
  return "Maintenance";
}

// --- Impact-style classification (rule-based "Impact Lens") ---
const FRONTEND_DIRS = new Set(["frontend"]);
const BACKEND_DIRS = new Set([
  "posthog", "ee", "rust", "plugin-server", "dags", "bin", "hogvm", "livestream", "common",
]);
const SECURITY_RE = /(auth|security|permission|login|oauth|crypto|secret|saml|sso|token|password|rbac)/i;
const PIPELINE_DIRS = new Set(["dags", "clickhouse", "kafka", "plugin-server"]);

const TAKEAWAY = {
  "Product Shipper": "Strong direct shipper with broad product ownership.",
  "Technical Multiplier": "High collaboration leverage through review and discussion.",
  "Systems Owner": "Core systems contributor with meaningful backend scope.",
  "Full-Stack Owner": "Ships across both frontend and backend surfaces.",
  "Quality Improver": "Keeps the codebase healthy via fixes, tests, and refactors.",
  "Area Specialist": "Deep, concentrated ownership of one area of the codebase.",
  "Balanced Contributor": "Balanced contributor across shipping, review, and ownership.",
};

function computeLens(a, components, workMix) {
  const subEntries = [...a.subsystems.entries()];
  const subTotal = subEntries.reduce((s, [, c]) => s + c, 0) || 1;
  const shareOf = (pred) =>
    subEntries.filter(([d]) => pred(d)).reduce((s, [, c]) => s + c, 0) / subTotal;
  const frontendShare = shareOf((d) => FRONTEND_DIRS.has(d));
  const backendShare = shareOf((d) => BACKEND_DIRS.has(d));
  const topShare = subEntries.length ? Math.max(...subEntries.map(([, c]) => c)) / subTotal : 0;

  const wt = Object.fromEntries(workMix.map((w) => [w.type, w.pct]));
  const featurePct = wt["Feature"] || 0;
  const qualityPct = (wt["Bug Fix"] || 0) + (wt["Tests"] || 0) + (wt["Refactor"] || 0);
  const col = components.collaboration.percentile;
  const shp = components.shipping.percentile;
  const brd = components.breadth.percentile;

  let style;
  if (col >= 75 && a.reviewsGiven >= a.prCount * 0.8) style = "Technical Multiplier";
  else if (featurePct >= 40 && shp >= 65) style = "Product Shipper";
  else if (frontendShare >= 0.25 && backendShare >= 0.25) style = "Full-Stack Owner";
  else if (backendShare >= 0.55) style = "Systems Owner";
  else if (qualityPct >= 50) style = "Quality Improver";
  else if (topShare >= 0.55 && brd < 50) style = "Area Specialist";
  else style = "Balanced Contributor";

  let confidence;
  if (a.prCount >= 20 && a.reviewsGiven >= 10 && a.prs.length >= 3) confidence = "High";
  else if (a.prCount >= 8) confidence = "Medium";
  else confidence = "Low";

  return { impactStyle: style, takeaway: TAKEAWAY[style], confidence };
}

// --- AI-readiness proxy (NOT real AI attribution; directional only) ---
function classifyAutomation(pr) {
  const loc = pr.additions + pr.deletions;
  const cf = pr.changedFiles;
  const wtype = classifyWorkType(pr);

  // Likely needs deeper human judgment
  if (loc >= 800 || cf >= 25) return "human";
  if (SECURITY_RE.test(pr.title) || pr.files.some((f) => SECURITY_RE.test(f))) return "human";
  if (wtype === "Feature" && loc >= 300) return "human";
  if (pr.files.some((f) => PIPELINE_DIRS.has(topDir(f))) && loc >= 200) return "human";

  // Potentially AI-assistable (repetitive / well-scoped)
  if (wtype === "Docs" || wtype === "Tests" || wtype === "Maintenance") return "assistable";
  if (wtype === "Refactor" && loc <= 150) return "assistable";
  if (wtype === "Bug Fix" && loc <= 80 && cf <= 3) return "assistable";

  return "standard";
}

// percentile rank (0-100) using average rank, robust to ties.
function percentiles(values) {
  const n = values.length;
  if (n <= 1) return values.map(() => (n === 1 ? 100 : 0));
  const sorted = [...values].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const pct = new Array(n);
  let k = 0;
  while (k < n) {
    let j = k;
    while (j + 1 < n && sorted[j + 1].v === sorted[k].v) j++;
    // average rank position for the tie group
    const avgRank = (k + j) / 2;
    const p = (avgRank / (n - 1)) * 100;
    for (let t = k; t <= j; t++) pct[sorted[t].i] = p;
    k = j + 1;
  }
  return pct;
}

async function main() {
  const raw = JSON.parse(await readFile(join(ROOT, "data", "raw-prs.json"), "utf8"));
  const { meta, prs } = raw;

  const fromMs = new Date(meta.from + "T00:00:00Z").getTime();
  const weekOf = (iso) =>
    Math.min(NWEEKS - 1, Math.max(0, Math.floor((new Date(iso).getTime() - fromMs) / (7 * 86400000))));

  // --- Global file churn -> hotspot set (top decile of touched files) ---
  const fileChurn = new Map();
  const codeAreas = new Set();
  for (const pr of prs) {
    for (const f of pr.files) {
      fileChurn.set(f, (fileChurn.get(f) ?? 0) + 1);
      codeAreas.add(topDir(f));
    }
  }
  const churnValues = [...fileChurn.values()].sort((a, b) => a - b);
  // hotspot = files in the top 10% by churn (and touched by >1 PR)
  const decileIdx = Math.floor(churnValues.length * 0.9);
  const hotspotThreshold = Math.max(2, churnValues[decileIdx] ?? 2);
  const hotspots = new Set(
    [...fileChurn.entries()].filter(([, c]) => c >= hotspotThreshold).map(([f]) => f)
  );

  // --- Per-author aggregation ---
  let teamReviews = 0;
  const A = new Map();
  const ensure = (login) => {
    if (!A.has(login)) {
      A.set(login, {
        login,
        prCount: 0,
        additions: 0,
        deletions: 0,
        volume: 0, // sum of log10(1+add+del)
        subsystems: new Map(), // dir -> pr count
        bugfixCount: 0,
        testCount: 0,
        qualityCount: 0,
        reviewsGiven: 0,
        reviewsReceived: 0,
        commentsReceived: 0,
        hotspotFiles: new Set(),
        workTypes: Object.fromEntries(WORK_TYPES.map((w) => [w, 0])),
        weekly: new Array(NWEEKS).fill(0),
        prs: [],
      });
    }
    return A.get(login);
  };

  for (const pr of prs) {
    // credit reviews given (dedupe reviewers per PR; exclude bots & self)
    const reviewers = [...new Set(pr.reviewers)].filter(
      (r) => !isBot(r) && r !== pr.author
    );
    for (const r of reviewers) ensure(r).reviewsGiven += 1;
    teamReviews += reviewers.length;

    if (isBot(pr.author, pr.authorType)) continue;
    const a = ensure(pr.author);
    a.prCount += 1;
    a.additions += pr.additions;
    a.deletions += pr.deletions;
    a.volume += Math.log10(1 + pr.additions + pr.deletions);
    a.reviewsReceived += reviewers.length;
    a.commentsReceived += pr.comments;

    for (const f of pr.files) {
      a.subsystems.set(topDir(f), (a.subsystems.get(topDir(f)) ?? 0) + 1);
      if (hotspots.has(f)) a.hotspotFiles.add(f);
    }

    const bug = isBugfixPR(pr);
    const test = isTestPR(pr);
    if (bug) a.bugfixCount += 1;
    if (test) a.testCount += 1;
    if (bug || test) a.qualityCount += 1;

    a.workTypes[classifyWorkType(pr)] += 1;
    if (pr.mergedAt) a.weekly[weekOf(pr.mergedAt)] += 1;

    a.prs.push({
      number: pr.number,
      title: pr.title,
      loc: pr.additions + pr.deletions,
      reviewers: reviewers.length,
      url: `https://github.com/${meta.repo}/pull/${pr.number}`,
    });
  }

  // --- Qualified pool ---
  const pool = [...A.values()].filter((a) => a.prCount >= MIN_PRS);

  const rawVecs = {
    shipping: pool.map((a) => a.volume),
    collaboration: pool.map((a) => a.reviewsGiven),
    breadth: pool.map((a) => a.subsystems.size),
    quality: pool.map((a) => a.qualityCount),
    influence: pool.map((a) => a.hotspotFiles.size),
  };
  const pct = Object.fromEntries(
    Object.entries(rawVecs).map(([k, v]) => [k, percentiles(v)])
  );

  const engineers = pool.map((a, i) => {
    const components = {
      shipping: { percentile: round(pct.shipping[i]), raw: round(a.volume, 1) },
      collaboration: { percentile: round(pct.collaboration[i]), raw: a.reviewsGiven },
      breadth: { percentile: round(pct.breadth[i]), raw: a.subsystems.size },
      quality: { percentile: round(pct.quality[i]), raw: a.qualityCount },
      influence: { percentile: round(pct.influence[i]), raw: a.hotspotFiles.size },
    };
    const score = round(
      Object.entries(DEFAULT_WEIGHTS).reduce(
        (s, [k, w]) => s + w * components[k].percentile,
        0
      )
    );
    const topSubsystems = [...a.subsystems.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 6)
      .map(([dir, count]) => ({ dir, count }));
    const topPRs = a.prs
      .sort((x, y) => y.reviewers - x.reviewers || y.loc - x.loc)
      .slice(0, 5);
    const workMix = WORK_TYPES.map((type) => ({
      type,
      count: a.workTypes[type],
      pct: round((a.workTypes[type] / a.prCount) * 100),
    }))
      .filter((w) => w.count > 0)
      .sort((x, y) => y.count - x.count);
    const lens = computeLens(a, components, workMix);
    return {
      login: a.login,
      avatar: `https://github.com/${a.login}.png?size=80`,
      profile: `https://github.com/${a.login}`,
      score,
      components,
      stats: {
        prCount: a.prCount,
        additions: a.additions,
        deletions: a.deletions,
        totalLoc: a.additions + a.deletions,
        reviewsGiven: a.reviewsGiven,
        reviewsReceived: a.reviewsReceived,
        commentsReceived: a.commentsReceived,
        subsystemCount: a.subsystems.size,
        bugfixCount: a.bugfixCount,
        testCount: a.testCount,
        qualityCount: a.qualityCount,
        qualityShare: round((a.qualityCount / a.prCount) * 100),
        hotspotFiles: a.hotspotFiles.size,
        perWeek: round(a.prCount / (meta.days / 7), 1),
      },
      weekly: a.weekly,
      topSubsystems,
      topPRs,
      workMix,
      ...lens,
    };
  });

  engineers.sort((x, y) => y.score - x.score);
  // benchmark framing: where each engineer sits among ranked contributors
  engineers.forEach((e, i) => {
    e.rank = i + 1;
    e.topPercent = Math.max(1, Math.round(((i + 1) / engineers.length) * 100));
  });

  // --- Team-wide work mix + AI-readiness proxy (across every human-authored PR) ---
  const teamCounts = Object.fromEntries(WORK_TYPES.map((w) => [w, 0]));
  const auto = { assistable: 0, human: 0, standard: 0 };
  let teamTotal = 0;
  for (const pr of prs) {
    if (isBot(pr.author, pr.authorType)) continue;
    teamCounts[classifyWorkType(pr)] += 1;
    auto[classifyAutomation(pr)] += 1;
    teamTotal += 1;
  }
  const teamWorkMix = WORK_TYPES.map((type) => ({
    type,
    count: teamCounts[type],
    pct: round((teamCounts[type] / teamTotal) * 100),
  })).sort((x, y) => y.count - x.count);
  const automation = {
    total: teamTotal,
    assistable: auto.assistable,
    human: auto.human,
    standard: auto.standard,
    assistablePct: round((auto.assistable / teamTotal) * 100),
    humanPct: round((auto.human / teamTotal) * 100),
    standardPct: round((auto.standard / teamTotal) * 100),
  };

  const out = {
    meta: {
      ...meta,
      contributorsAnalyzed: A.size,
      qualifiedContributors: pool.length,
      minPRs: MIN_PRS,
      hotspotFiles: hotspots.size,
      hotspotThreshold,
      teamWorkMix,
      automation,
      reviewsAnalyzed: teamReviews,
      codeAreas: codeAreas.size,
    },
    defaultWeights: DEFAULT_WEIGHTS,
    workTypes: WORK_TYPES,
    dimensions: {
      shipping: "Shipping — log-dampened code volume across merged PRs (visible shipped work, not raw LOC).",
      collaboration: "Review Leverage — reviews given on other engineers' PRs (multiplying the output of others).",
      breadth: "Area Ownership — distinct code areas (top-level directories) touched (cross-cutting reach).",
      quality: "Delivery Signal — share of bug-fix / test PRs (keeping delivery healthy, not just adding features).",
      influence: "Scope Handled — distinct high-churn core files touched (work on central, high-traffic code).",
    },
    engineers,
  };

  await mkdir(join(ROOT, "public"), { recursive: true });
  await writeFile(join(ROOT, "public", "impact.json"), JSON.stringify(out));
  console.log(
    `Wrote public/impact.json: ${engineers.length} qualified engineers ` +
      `(of ${A.size} contributors), ${hotspots.size} hotspot files.`
  );
  console.log("Top 5:");
  for (const e of engineers.slice(0, 5)) {
    console.log(
      `  ${e.score}  ${e.login}  (PRs ${e.stats.prCount}, reviews ${e.stats.reviewsGiven}, subsys ${e.stats.subsystemCount}, quality ${e.stats.qualityCount}, hotspot ${e.stats.hotspotFiles})`
    );
  }
}

function round(x, d = 0) {
  const f = 10 ** d;
  return Math.round((x + Number.EPSILON) * f) / f;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
