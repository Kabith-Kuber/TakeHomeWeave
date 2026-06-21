// Fetches ~90 days of merged PRs from PostHog/posthog via the GitHub GraphQL API
// (using the already-authenticated `gh` CLI). Writes raw PR records to data/raw-prs.json.
//
// GitHub's search API caps any single query at 1000 results, so we slice the
// 90-day window into 7-day chunks (each well under the cap) and paginate inside
// each chunk. PRs are de-duplicated by number.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const REPO = "PostHog/posthog";
const DAYS = 90;
const WINDOW_DAYS = 7;

const QUERY = `
query($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 100, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        title
        mergedAt
        additions
        deletions
        changedFiles
        author { login __typename }
        labels(first: 20) { nodes { name } }
        reviews(first: 50) { nodes { author { login } state } }
        comments { totalCount }
        files(first: 50) { nodes { path } }
      }
    }
  }
}`;

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

// Build non-overlapping [start, end] date windows covering the last DAYS days.
function buildWindows() {
  const windows = [];
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - DAYS);

  let cursor = new Date(start);
  while (cursor <= end) {
    const wEnd = new Date(cursor);
    wEnd.setUTCDate(wEnd.getUTCDate() + WINDOW_DAYS - 1);
    windows.push([ymd(cursor), ymd(wEnd > end ? end : wEnd)]);
    cursor = new Date(wEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return windows;
}

async function ghGraphql(q, cursor) {
  const args = ["api", "graphql", "-f", `query=${QUERY}`, "-f", `q=${q}`];
  if (cursor) args.push("-f", `cursor=${cursor}`);
  const { stdout } = await execFileAsync("gh", args, {
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  return JSON.parse(stdout);
}

async function withRetry(fn, label, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = 1500 * (i + 1);
      console.warn(`  retry ${i + 1}/${tries} for ${label}: ${err.message?.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

function midDate(from, to) {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return ymd(new Date((a + b) / 2));
}

// Fetch a window, recursively splitting it if it exceeds GitHub's 1000-result
// search cap so that no PRs are silently dropped.
async function fetchWindow([from, to]) {
  const q = `repo:${REPO} is:pr is:merged merged:${from}..${to}`;
  const out = [];
  let cursor = null;
  let pages = 0;
  while (true) {
    const data = await withRetry(() => ghGraphql(q, cursor), `${from}..${to} p${pages}`);
    const search = data?.data?.search;
    if (!search) throw new Error("no search in response: " + JSON.stringify(data).slice(0, 200));

    // If too many results and the window is still splittable, split and recurse.
    if (pages === 0 && search.issueCount > 1000 && from !== to) {
      const mid = midDate(from, to);
      const nextStart = ymd(new Date(new Date(mid + "T00:00:00Z").getTime() + 86400000));
      console.log(`  splitting ${from}..${to} (${search.issueCount}) -> ${from}..${mid} + ${nextStart}..${to}`);
      const left = await fetchWindow([from, mid]);
      const right = await fetchWindow([nextStart, to]);
      return [...left, ...right];
    }

    for (const n of search.nodes) {
      if (!n || !n.number) continue;
      out.push(n);
    }
    pages++;
    if (!search.pageInfo.hasNextPage) break;
    cursor = search.pageInfo.endCursor;
  }
  return out;
}

async function main() {
  const windows = buildWindows();
  console.log(`Fetching ${REPO} merged PRs over ${DAYS} days in ${windows.length} windows...`);

  const byNumber = new Map();
  for (const w of windows) {
    const prs = await fetchWindow(w);
    for (const pr of prs) byNumber.set(pr.number, pr);
    console.log(`  ${w[0]}..${w[1]}: ${prs.length} PRs (total unique: ${byNumber.size})`);
  }

  const prs = [...byNumber.values()].map((pr) => ({
    number: pr.number,
    title: pr.title,
    mergedAt: pr.mergedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    author: pr.author?.login ?? null,
    authorType: pr.author?.__typename ?? null,
    labels: (pr.labels?.nodes ?? []).map((l) => l.name),
    reviewers: (pr.reviews?.nodes ?? [])
      .map((r) => r.author?.login)
      .filter(Boolean),
    comments: pr.comments?.totalCount ?? 0,
    files: (pr.files?.nodes ?? []).map((f) => f.path),
  }));

  const meta = {
    repo: REPO,
    days: DAYS,
    from: windows[0][0],
    to: windows[windows.length - 1][1],
    totalMergedPRs: prs.length,
    generatedAt: new Date().toISOString(),
  };

  await mkdir(join(ROOT, "data"), { recursive: true });
  await writeFile(
    join(ROOT, "data", "raw-prs.json"),
    JSON.stringify({ meta, prs }, null, 0)
  );
  console.log(`\nWrote data/raw-prs.json: ${prs.length} PRs (${meta.from}..${meta.to})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
