// Sticky-comment poster. Reads a markdown body from a file, finds an existing
// comment on the PR by the report's marker, and either updates it (PATCH) or
// creates a new one (POST).
//
// Invoked from .github/workflows/supply-chain.yaml after the main CLI run.
// Authentication is the workflow's GITHUB_TOKEN via `pull-requests: write`.
//
// We deliberately don't depend on @octokit/* — keeping the runtime zero-dep
// posture established in ADR-0007. The GitHub REST API is small enough to
// hit directly.

import { readFile } from 'node:fs/promises';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { STICKY_MARKER } from './report.ts';

type Comment = { id: number; body: string };

async function main(): Promise<void> {
  const bodyFile = argv[2];
  if (!bodyFile) {
    stderr.write('post-comment: usage: node post-comment.ts <body-file>\n');
    exit(2);
  }

  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  const prNumber = env.PR_NUMBER;
  if (!token || !repo || !prNumber) {
    stderr.write('post-comment: missing GITHUB_TOKEN / GITHUB_REPOSITORY / PR_NUMBER; skipping.\n');
    return;
  }

  const body = await readFile(bodyFile, 'utf8');
  if (!body.includes(STICKY_MARKER)) {
    stderr.write('post-comment: body does not include the sticky marker; refusing to post.\n');
    exit(2);
  }

  const apiBase = env.GITHUB_API_URL ?? 'https://api.github.com';
  const headers: Record<string, string> = {
    'authorization': `Bearer ${token}`,
    'accept': 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'grafana-supply-chain',
    'content-type': 'application/json',
  };

  const existing = await findStickyComment(apiBase, repo, prNumber, headers);
  if (existing) {
    const res = await fetch(`${apiBase}/repos/${repo}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`PATCH failed: ${res.status} ${await res.text()}`);
    stdout.write(`post-comment: updated comment ${existing.id}\n`);
  } else {
    const res = await fetch(`${apiBase}/repos/${repo}/issues/${prNumber}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error(`POST failed: ${res.status} ${await res.text()}`);
    stdout.write('post-comment: created sticky comment\n');
  }
}

async function findStickyComment(
  apiBase: string,
  repo: string,
  prNumber: string,
  headers: Record<string, string>,
): Promise<Comment | null> {
  // Paginate. PRs with hundreds of comments are rare but possible; we still
  // want to find the marker reliably.
  let page = 1;
  for (;;) {
    const url = `${apiBase}/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GET comments failed: ${res.status} ${await res.text()}`);
    const batch = (await res.json()) as Comment[];
    for (const c of batch) {
      if (typeof c.body === 'string' && c.body.includes(STICKY_MARKER)) return c;
    }
    if (batch.length < 100) return null;
    page += 1;
    if (page > 50) return null; // hard ceiling: 5000 comments is enough for anyone
  }
}

main().catch((err) => {
  stderr.write(`post-comment: ${(err as Error).stack ?? err}\n`);
  exit(1);
});
