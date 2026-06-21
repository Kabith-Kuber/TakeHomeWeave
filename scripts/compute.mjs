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

  // --- Global file churn -> hotspot set (top decile of touched files) ---
  const fileChurn = new Map();
  for (const pr of prs) {
    for (const f of pr.files) fileChurn.set(f, (fileChurn.get(f) ?? 0) + 1);
  }
  const churnValues = [...fileChurn.values()].sort((a, b) => a - b);
  // hotspot = files in the top 10% by churn (and touched by >1 PR)
  const decileIdx = Math.floor(churnValues.length * 0.9);
  const hotspotThreshold = Math.max(2, churnValues[decileIdx] ?? 2);
  const hotspots = new Set(
    [...fileChurn.entries()].filter(([, c]) => c >= hotspotThreshold).map(([f]) => f)
  );

  // --- Per-author aggregation ---
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
      },
      topSubsystems,
      topPRs,
    };
  });

  engineers.sort((x, y) => y.score - x.score);

  const out = {
    meta: {
      ...meta,
      contributorsAnalyzed: A.size,
      qualifiedContributors: pool.length,
      minPRs: MIN_PRS,
      hotspotFiles: hotspots.size,
      hotspotThreshold,
    },
    defaultWeights: DEFAULT_WEIGHTS,
    dimensions: {
      shipping: "Log-dampened code volume across merged PRs (rewards shipping meaningful units, not raw LOC).",
      collaboration: "Reviews given on other engineers' PRs (unblocking & mentoring teammates).",
      breadth: "Distinct subsystems (top-level repo directories) touched (cross-cutting reach).",
      quality: "Number of bug-fix / test PRs (keeping the codebase healthy).",
      influence: "Distinct repo hotspot files touched (work on high-churn, central code).",
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
