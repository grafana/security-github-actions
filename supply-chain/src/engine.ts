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

// Lifecycle events emitted while runChecks is in flight. Used by the CLI
// to render progress feedback (single in-place line on a TTY, static log
// lines in CI). Optional: callers that don't pass `onProgress` get no
// overhead.
export type ProgressEvent =
  | { kind: 'discovery-start' }
  | { kind: 'discovery-end'; jsRoots: number; goRoots: number; durationMs: number }
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

  // Both walkers run unconditionally; each one self-skips when its
  // discovery signal (`package.json` / `go.mod`) is absent.
  onProgress?.({ kind: 'discovery-start' });
  const discoveryStart = Date.now();
  const nodeRoots = await discoverJsRoots(repoRoot);
  const goRoots = await discoverGoRoots(repoRoot);
  const roots: Root[] = [...nodeRoots, ...goRoots];
  onProgress?.({
    kind: 'discovery-end',
    jsRoots: nodeRoots.length,
    goRoots: goRoots.length,
    durationMs: Date.now() - discoveryStart,
  });

  if (roots.length === 0) {
    onProgress?.({ kind: 'done', durationMs: Date.now() - overallStart });
    return { ran: checks.map((c) => c.id), active: [], suppressed: [], rootCount: 0 };
  }

  // Pre-compute the total number of (root, check) pairs that will actually
  // execute, so progress events can include `index / total`. We need this
  // upfront because checks filter themselves by ecosystem and we want the
  // progress bar to be honest about what's coming.
  const total = roots.reduce(
    (acc, root) => acc + checks.filter((c) => c.ecosystem === root.ecosystem).length,
    0,
  );

  const rawFindings: Finding[] = [];
  let index = 0;
  for (const root of roots) {
    for (const c of checks) {
      if (c.ecosystem !== root.ecosystem) continue;
      index += 1;
      onProgress?.({ kind: 'check-start', checkId: c.id, root: root.path, index, total });
      const checkStart = Date.now();
      let found: Finding[] = [];
      if (c.ecosystem === 'js' && root.ecosystem === 'js') {
        found = await c.run(root, ctx);
      } else if (c.ecosystem === 'go' && root.ecosystem === 'go') {
        found = await c.run(root, ctx);
      }
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
      severity: 'blocking',
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
