# PostHog Engineering Impact Dashboard

An interactive, single-page dashboard that identifies the **top 5 most impactful engineers**
at PostHog over the last 90 days, using real data from the
[`PostHog/posthog`](https://github.com/PostHog/posthog) GitHub repository.

**Live dashboard:** https://posthog-impact-dashboard-pi.vercel.app

---

## What "impact" means here

Lines of code, commit counts, and PR counts are easy to game and don't reflect real
engineering impact. A 2,000-line auto-generated migration is not 10x a tight 200-line bug
fix, and the engineer who unblocks five teammates through reviews often matters more than
the one with the biggest diff.

So impact is modeled as **five complementary dimensions**, each capturing a different kind
of value an engineer creates:

| Dimension | Default weight | Raw signal | Why it matters |
|---|---|---|---|
| **Shipping** | 25% | Log-dampened code volume across merged PRs | Throughput of completed work, with a log scale so large mechanical diffs don't dominate |
| **Collaboration** | 25% | Reviews given on *other people's* PRs | Unblocking and mentoring teammates — a force multiplier raw stats miss |
| **Breadth** | 15% | Distinct subsystems (top-level dirs) touched | Cross-cutting reach vs. siloed work |
| **Quality** | 15% | Count of bug-fix / test PRs | Keeping the codebase healthy, not just adding features |
| **Influence** | 20% | Distinct repo "hotspot" (high-churn) files touched | Working on the central, high-traffic code others depend on |

### How the score is computed

1. For each engineer we compute the **raw value** of each dimension.
2. Each raw value is converted to a **percentile rank (0–100)** against all *qualified*
   contributors (those with ≥3 merged PRs in the window, bots excluded). Percentiles make
   dimensions comparable and resistant to outliers.
3. The final **impact score (0–100)** is the weighted blend of the five percentiles.

Every number on the dashboard is explained and traceable: each engineer card shows the raw
inputs (PRs, reviews given, subsystems, bug-fix %, hotspot files) **and** the normalized
component scores, plus links to their most-reviewed PRs so a leader can validate the ranking.
The **weight sliders** let you re-weight the dimensions live and pressure-test who rises to
the top.

## Architecture

```
scripts/fetch.mjs    -> pulls 90 days of merged PRs from the GitHub GraphQL API
                        (via the authenticated gh CLI), writing data/raw-prs.json.
                        Adaptively splits any date window that exceeds GitHub's
                        1000-result search cap so no PRs are dropped.
scripts/compute.mjs  -> aggregates per author, computes the 5 dimensions,
                        percentile-normalizes, weights, and writes public/impact.json.
src/                 -> Vite + React + Recharts dashboard that reads the static JSON.
```

Data is **pre-computed into a static JSON** and baked into the build, so the dashboard makes
zero API calls at load time and renders in well under a second.

## Reproduce

```bash
npm install
npm run fetch          # node scripts/fetch.mjs  (needs an authenticated `gh` CLI)
node scripts/compute.mjs
npm run dev            # or: npm run build && npm run preview
```

## Tech stack

Vite, React, Recharts. Data pipeline in Node using the GitHub GraphQL API. Hosted on Vercel.

## Time spent

**~27 minutes** (timer: started 23:27, finished 23:54).

## Approach (short)

1. Confirmed scope and data volume: PostHog merged ~9,000 PRs in 90 days, so the pipeline
   uses the GitHub GraphQL API (100 PRs/request with diff stats, files, reviews, labels) and
   slices the window into chunks that adaptively split when they exceed the 1,000-result cap —
   guaranteeing complete data (9,066 PRs captured).
2. Defined impact as five complementary, percentile-normalized dimensions (shipping,
   collaboration, breadth, quality, influence) so no single gameable metric dominates.
3. Pre-computed everything into a static JSON for instant loads, and built a transparent
   single-page dashboard where every score traces back to raw, linkable evidence and the
   weights are adjustable live.
