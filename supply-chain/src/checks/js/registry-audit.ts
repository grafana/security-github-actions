import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { NodeCheck, Finding, NodeRoot, RepoContext, PackageManager } from '../../types.ts';
import { parseAuditOutput } from './_audit-parse.ts';
import type { Advisory } from './_audit-parse.ts';

export const CHECK_ID = 'registry-audit';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/registry-audit.md';

// Cap on advisories rendered per root. Above this, we emit one summary
// finding pointing the user at a local run for the full list. Stops the
// "200 transitive moderate-severity advisories" wallpaper case from
// drowning out blocking findings in the same comment.
const MAX_ADVISORIES_PER_ROOT = 20;

const execFileP = promisify(execFile);

export const check: NodeCheck = {
  ecosystem: 'js',
  id: CHECK_ID,
  severity: 'advisory',
  async run(root: NodeRoot, ctx: RepoContext): Promise<Finding[]> {
    if (root.packageManager === null) return [];

    const cmd = auditCommand(root.packageManager);
    const cwd = join(ctx.repoRoot, root.path);

    let rawOutput: string | null = null;
    let invocationError: string | null = null;
    try {
      const { stdout } = await execFileP(cmd.argv0, cmd.args, { cwd, maxBuffer: 64 * 1024 * 1024 });
      rawOutput = stdout;
    } catch (err) {
      // Audit commands exit non-zero when vulnerabilities are found; execFile
      // rejects but the JSON is still on stdout in the error object.
      const e = err as { stdout?: string; message?: string };
      if (typeof e.stdout === 'string' && e.stdout.length > 0) {
        rawOutput = e.stdout;
      } else {
        invocationError = e.message ?? 'unknown error';
      }
    }

    if (rawOutput === null) {
      return [
        {
          check_id: CHECK_ID,
          severity: 'advisory',
          root: root.path,
          title: `\`${root.packageManager} audit\` could not run`,
          detail: `Error invoking audit: ${invocationError ?? 'unknown'}.`,
          fix: `Run \`${cmd.argv0} ${cmd.args.join(' ')}\` locally to investigate.`,
          doc_link: DOC_LINK,
        },
      ];
    }

    const allAdvisories = parseAuditOutput(rawOutput);
    const relevant = allAdvisories.filter(
      (a) => a.severity === 'high' || a.severity === 'critical',
    );
    if (relevant.length === 0) return [];

    // Deterministic ordering for predictable reports: critical first, then
    // by package name. Same input => same finding order.
    relevant.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return a.package.localeCompare(b.package);
    });

    const visible = relevant.slice(0, MAX_ADVISORIES_PER_ROOT);
    const remainder = relevant.length - visible.length;

    const findings: Finding[] = visible.map((a) => toFinding(a, root.path, root.packageManager!));

    if (remainder > 0) {
      findings.push({
        check_id: CHECK_ID,
        severity: 'advisory',
        root: root.path,
        title: `+ ${remainder} more high/critical advisories (capped at ${MAX_ADVISORIES_PER_ROOT})`,
        detail: `${MAX_ADVISORIES_PER_ROOT} most-critical advisories shown above; ${remainder} more exist.`,
        fix: `Run \`${cmd.argv0} ${cmd.args.join(' ')}\` locally for the full list.`,
        doc_link: DOC_LINK,
      });
    }

    return findings;
  },
};

function toFinding(a: Advisory, root: string, pm: PackageManager): Finding {
  return {
    check_id: CHECK_ID,
    severity: 'advisory',
    root,
    title: `${a.package} (${a.severity}): ${truncate(a.title, 100)}`,
    detail: composeDetail(a),
    fix: composeFix(a, pm),
    // Prefer the advisory's own URL (GHSA / CVE landing page) over our
    // generic check doc — the GHSA page has the real fix guidance.
    doc_link: a.url ?? DOC_LINK,
  };
}

function composeDetail(a: Advisory): string {
  const parts: string[] = [];
  if (a.vulnerableRange) parts.push(`Vulnerable: \`${a.vulnerableRange}\``);
  if (a.patchedRange) parts.push(`Patched: \`${a.patchedRange}\``);
  if (parts.length === 0) parts.push(a.title);
  return parts.join(' · ');
}

function composeFix(a: Advisory, pm: PackageManager): string {
  if (a.patchedRange) {
    return `Update \`${a.package}\` to satisfy \`${a.patchedRange}\`.`;
  }
  if (typeof a.fixAvailable === 'object' && a.fixAvailable) {
    const maj = a.fixAvailable.isSemVerMajor ? ' (semver-major)' : '';
    return `Run \`${pm} audit fix\`${maj}, or pin \`${a.fixAvailable.name}@${a.fixAvailable.version}\`.`;
  }
  if (a.fixAvailable === true) {
    return `Run \`${pm} audit fix\`.`;
  }
  return `No fix published yet for \`${a.package}\`. Consider a manifest override (npm \`overrides\`, pnpm \`pnpm.overrides\`, yarn \`resolutions\`) or pin a workaround.`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

type Cmd = { argv0: string; args: string[] };

function auditCommand(pm: PackageManager): Cmd {
  switch (pm) {
    case 'npm':
      return { argv0: 'npm', args: ['audit', '--json'] };
    case 'pnpm':
      return { argv0: 'pnpm', args: ['audit', '--json'] };
    case 'yarn':
      return { argv0: 'yarn', args: ['npm', 'audit', '--recursive', '--all', '--json'] };
  }
}
