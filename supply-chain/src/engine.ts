// Shared engine: discover roots, run a given list of checks, apply
// suppressions, return findings. Used by both the static and audit CLIs.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from 'node:process';
import { discoverJsRoots } from './js/walk.ts';
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

// Lifecycle events emitted while runChecks is in flight. Used by the CLI
// to render progress feedback (single in-place line on a TTY, static log
// lines in CI). Optional: callers that don't pass `onProgress` get no
// overhead.
export type ProgressEvent =
  | { kind: 'discovery-start' }
  | { kind: 'discovery-end'; jsRoots: number; durationMs: number }
  | { kind: 'check-start'; checkId: CheckId; root: string; index: number; total: number }
  | { kind: 'check-end'; checkId: CheckId; root: string; durationMs: number; findingCount: number }
  | { kind: 'done'; durationMs: number };

export type ProgressCallback = (event: ProgressEvent) => void;

export async function runChecks(
  repoRoot: string,
  checks: Check[],
  onProgress?: ProgressCallback,
): Promise<EngineResult> {
  const overallStart = Date.now();
  const ctx: RepoContext = {
    repoRoot,
    trackedFiles: await loadTrackedFiles(repoRoot),
  };

  // The JS walker self-skips when there's no `package.json` in the tree.
  // PR1 covers only the JS ecosystem; a future PR adds a Go walker here.
  onProgress?.({ kind: 'discovery-start' });
  const discoveryStart = Date.now();
  const roots: Root[] = await discoverJsRoots(repoRoot);
  onProgress?.({
    kind: 'discovery-end',
    jsRoots: roots.length,
    durationMs: Date.now() - discoveryStart,
  });

  if (roots.length === 0) {
    onProgress?.({ kind: 'done', durationMs: Date.now() - overallStart });
    return { ran: checks.map((c) => c.id), active: [], suppressed: [], rootCount: 0 };
  }

  // PR1: only JS checks exist, only JS roots are discovered, so every
  // (root, check) pair runs. The check loop still goes through the
  // ecosystem-matching gate so a future PR can drop a Go check into
  // `checks` without engine changes.
  const total = roots.length * checks.filter((c) => c.ecosystem === 'js').length;

  const rawFindings: Finding[] = [];
  let index = 0;
  for (const root of roots) {
    for (const c of checks) {
      if (c.ecosystem !== root.ecosystem) continue;
      index += 1;
      onProgress?.({ kind: 'check-start', checkId: c.id, root: root.path, index, total });
      const checkStart = Date.now();
      const found = await c.run(root, ctx);
      rawFindings.push(...found);
      onProgress?.({
        kind: 'check-end',
        checkId: c.id,
        root: root.path,
        durationMs: Date.now() - checkStart,
        findingCount: found.length,
      });
    }
  }

  const { entries, errors } = await loadSuppressions(repoRoot);
  const { active, suppressed } = partitionBySuppression(rawFindings, entries);

  for (const err of errors) {
    active.push({
      check_id: 'suppression-file-invalid',
      severity: 'critical',
      root: '.',
      title: `Invalid suppression file: ${err.file}${err.line ? ` (line ${err.line})` : ''}`,
      detail: err.message,
      fix: 'Fix the suppression entry or remove the file.',
      doc_link: 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/README.md#suppressions',
    });
  }

  onProgress?.({ kind: 'done', durationMs: Date.now() - overallStart });

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
