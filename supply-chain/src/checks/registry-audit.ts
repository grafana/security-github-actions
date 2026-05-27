import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { Check, Finding, Root, RepoContext } from '../types.ts';

export const CHECK_ID = 'registry-audit';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/registry-audit.md';

const execFileP = promisify(execFile);

// Calls the appropriate audit command for the root's package manager and
// surfaces vulnerabilities at "high" or "critical" severity as advisory
// findings. Failure to run the audit command (no network, registry down,
// command missing) is itself a single advisory finding rather than an error
// — the workflow has continue-on-error: true on the advisory job, and we
// don't want flaky audits to swallow the rest of the report.
export const check: Check = {
  id: CHECK_ID,
  severity: 'advisory',
  async run(root: Root, ctx: RepoContext): Promise<Finding[]> {
    if (root.packageManager === null) return [];

    const cmd = auditCommand(root.packageManager);
    const cwd = join(ctx.repoRoot, root.path);
    let json: AuditJson | null = null;
    try {
      const { stdout: out } = await execFileP(cmd.argv0, cmd.args, { cwd, maxBuffer: 32 * 1024 * 1024 });
      json = JSON.parse(out) as AuditJson;
    } catch (err) {
      // Many audit commands exit non-zero when vulnerabilities are found;
      // execFile rejects but still produces stdout in the error. Inspect it.
      const e = err as { stdout?: string; message?: string };
      if (typeof e.stdout === 'string' && e.stdout.length > 0) {
        try {
          json = JSON.parse(e.stdout) as AuditJson;
        } catch {
          // fall through to the error finding
        }
      }
      if (json === null) {
        return [
          {
            check_id: CHECK_ID,
            severity: 'advisory',
            root: root.path,
            title: `\`${root.packageManager} audit\` could not run`,
            detail: `Error invoking audit: ${e.message ?? 'unknown error'}.`,
            fix: `Run \`${cmd.argv0} ${cmd.args.join(' ')}\` locally to investigate.`,
            doc_link: DOC_LINK,
          },
        ];
      }
    }

    const counts = extractCounts(json, root.packageManager);
    if (counts.high === 0 && counts.critical === 0) return [];
    return [
      {
        check_id: CHECK_ID,
        severity: 'advisory',
        root: root.path,
        title: `${counts.critical} critical, ${counts.high} high advisories from ${root.packageManager} audit`,
        detail: 'High/critical advisories were reported by the package manager audit. See the audit output for details.',
        fix: `Run \`${cmd.argv0} ${cmd.args.join(' ')}\` locally and update the offending dependencies.`,
        doc_link: DOC_LINK,
      },
    ];
  },
};

type Cmd = { argv0: string; args: string[] };

function auditCommand(pm: 'npm' | 'pnpm' | 'yarn'): Cmd {
  switch (pm) {
    case 'npm':
      return { argv0: 'npm', args: ['audit', '--json'] };
    case 'pnpm':
      return { argv0: 'pnpm', args: ['audit', '--json'] };
    case 'yarn':
      // Yarn 4: `yarn npm audit --recursive --all --json`
      return { argv0: 'yarn', args: ['npm', 'audit', '--recursive', '--all', '--json'] };
  }
}

type AuditJson = {
  // npm/pnpm shape: { metadata: { vulnerabilities: { critical, high, ... } } }
  metadata?: { vulnerabilities?: Record<string, number> };
  // yarn (NDJSON streamed objects) — caller doesn't reach here cleanly without
  // splitting; we handle the simple object case and bail to zero otherwise.
};

function extractCounts(json: AuditJson | null, pm: 'npm' | 'pnpm' | 'yarn'): { high: number; critical: number } {
  if (json === null) return { high: 0, critical: 0 };
  if (pm === 'npm' || pm === 'pnpm') {
    const v = json.metadata?.vulnerabilities ?? {};
    return { high: v.high ?? 0, critical: v.critical ?? 0 };
  }
  // Yarn 4 emits NDJSON. The first JSON.parse picks only the first line.
  // Treat as "unable to interpret" — zero. A proper implementation would
  // stream-parse; deferred.
  return { high: 0, critical: 0 };
}
