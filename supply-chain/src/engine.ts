// Shared engine: discover roots, run a given list of checks, apply
// suppressions, return findings. Used by both the static and audit CLIs.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from 'node:process';
import { discoverJsRoots } from './js/walk.ts';
import { discoverGoRoots } from './go/walk.ts';
import { loadSuppressions, partitionBySuppression } from './suppressions.ts';
import type { Check, Finding, RepoContext, CheckId, Root } from './types.ts';

const execFileP = promisify(execFile);

export type EngineResult = {
  ran: CheckId[];
  active: Finding[];
  suppressed: Finding[];
  // Number of roots that contributed to the result. 0 means the activation
  // gate matched no package.json — callers should treat this as "skipped".
  rootCount: number;
};

export async function runChecks(
  repoRoot: string,
  checks: Check[],
): Promise<EngineResult> {
  const ctx: RepoContext = {
    repoRoot,
    trackedFiles: await loadTrackedFiles(repoRoot),
  };

  // Both walkers run unconditionally; each one self-skips when its
  // discovery signal (`package.json` / `go.mod`) is absent.
  const nodeRoots = await discoverJsRoots(repoRoot);
  const goRoots = await discoverGoRoots(repoRoot);
  const roots: Root[] = [...nodeRoots, ...goRoots];

  if (roots.length === 0) {
    return { ran: checks.map((c) => c.id), active: [], suppressed: [], rootCount: 0 };
  }

  const rawFindings: Finding[] = [];
  for (const root of roots) {
    for (const c of checks) {
      // Dispatch by ecosystem — a JS check never runs against a Go root and
      // vice versa. The narrowed run() signatures are type-safe in each arm.
      if (c.ecosystem !== root.ecosystem) continue;
      if (c.ecosystem === 'js' && root.ecosystem === 'js') {
        rawFindings.push(...(await c.run(root, ctx)));
      } else if (c.ecosystem === 'go' && root.ecosystem === 'go') {
        rawFindings.push(...(await c.run(root, ctx)));
      }
    }
  }

  const { entries, errors } = await loadSuppressions(repoRoot);
  const { active, suppressed } = partitionBySuppression(rawFindings, entries);

  for (const err of errors) {
    active.push({
      check_id: 'suppression-file-invalid',
      severity: 'blocking',
      root: '.',
      title: `Invalid suppression file: ${err.file}${err.line ? ` (line ${err.line})` : ''}`,
      detail: err.message,
      fix: 'Fix the suppression entry or remove the file.',
      doc_link: 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/README.md#suppressions',
    });
  }

  return {
    ran: checks.map((c) => c.id),
    active,
    suppressed,
    rootCount: roots.length,
  };
}

async function loadTrackedFiles(repoRoot: string): Promise<Set<string> | null> {
  try {
    const { stdout: out } = await execFileP('git', ['ls-files'], { cwd: repoRoot });
    return new Set(out.split('\n').filter(Boolean));
  } catch {
    return null;
  }
}

// Returns the workflow-run URL when invoked from a real GitHub Actions run,
// or `null` when invoked locally / outside CI. The renderers omit the
// "Run: <url>" footer when this is null — a bare `https://github.com` link
// would be noise in a terminal report.
export function buildRunUrl(): string | null {
  const repo = env.GITHUB_REPOSITORY ?? '';
  const runId = env.GITHUB_RUN_ID ?? '';
  if (!repo || !runId) return null;
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
  return `${server}/${repo}/actions/runs/${runId}`;
}
