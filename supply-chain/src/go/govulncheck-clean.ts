import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { GoCheck, Finding, GoRoot, RepoContext } from '../types.ts';
import { parseGovulncheckOutput } from './_govulncheck-parse.ts';
import type { GovulnAdvisory } from './_govulncheck-parse.ts';

export const CHECK_ID = 'govulncheck-clean';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/go/govulncheck-clean.md';

// Cap on advisories rendered per module. Govulncheck's reachability filter
// already keeps the signal high (only call-reachable vulns), so the cap is
// generous — but a single repo with a deeply-shared dep can still produce
// dozens. See the audit check's identical limit for npm.
const MAX_ADVISORIES_PER_ROOT = 20;

const execFileP = promisify(execFile);

export const check: GoCheck = {
  ecosystem: 'go',
  id: CHECK_ID,
  severity: 'advisory',
  async run(root: GoRoot, ctx: RepoContext): Promise<Finding[]> {
    const cwd = join(ctx.repoRoot, root.path);

    let raw: string | null = null;
    let invocationError: string | null = null;
    try {
      const { stdout } = await execFileP('govulncheck', ['-json', './...'], {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
      });
      raw = stdout;
    } catch (err) {
      // govulncheck exits non-zero when findings are present; stdout still
      // carries the JSON stream.
      const e = err as { stdout?: string; message?: string; code?: string };
      if (typeof e.stdout === 'string' && e.stdout.length > 0) {
        raw = e.stdout;
      } else if (e.code === 'ENOENT') {
        invocationError = 'govulncheck not installed on PATH';
      } else {
        invocationError = e.message ?? 'unknown error';
      }
    }

    if (raw === null) {
      return [
        {
          check_id: CHECK_ID,
          severity: 'advisory',
          root: root.path,
          title: '`govulncheck` could not run',
          detail: `Error invoking govulncheck: ${invocationError ?? 'unknown'}.`,
          fix: 'Install govulncheck (`go install golang.org/x/vuln/cmd/govulncheck@latest`) and re-run.',
          doc_link: DOC_LINK,
        },
      ];
    }

    const advisories = parseGovulncheckOutput(raw);
    if (advisories.length === 0) return [];

    advisories.sort((a, b) => a.osv.localeCompare(b.osv));
    const visible = advisories.slice(0, MAX_ADVISORIES_PER_ROOT);
    const remainder = advisories.length - visible.length;

    const findings: Finding[] = visible.map((a) => toFinding(a, root.path));
    if (remainder > 0) {
      findings.push({
        check_id: CHECK_ID,
        severity: 'advisory',
        root: root.path,
        title: `+ ${remainder} more govulncheck findings (capped at ${MAX_ADVISORIES_PER_ROOT})`,
        detail: `${MAX_ADVISORIES_PER_ROOT} advisories shown above; ${remainder} more exist.`,
        fix: 'Run `govulncheck ./...` locally for the full list.',
        doc_link: DOC_LINK,
      });
    }
    return findings;
  },
};

function toFinding(a: GovulnAdvisory, root: string): Finding {
  return {
    check_id: CHECK_ID,
    severity: 'advisory',
    root,
    title: `${a.module}: ${a.osv} — ${truncate(a.summary, 100)}`,
    detail: composeDetail(a),
    fix: composeFix(a),
    doc_link: a.url ?? DOC_LINK,
  };
}

function composeDetail(a: GovulnAdvisory): string {
  const parts: string[] = [];
  if (a.symbol) parts.push(`Reaches \`${a.symbol}\``);
  if (a.vulnerableVersion) parts.push(`Installed: \`${a.vulnerableVersion}\``);
  if (a.fixedVersion) parts.push(`Fixed in: \`${a.fixedVersion}\``);
  return parts.length === 0 ? a.summary : parts.join(' · ');
}

function composeFix(a: GovulnAdvisory): string {
  if (a.fixedVersion) {
    return `Update \`${a.module}\` to \`${a.fixedVersion}\` or newer (\`go get ${a.module}@${a.fixedVersion}\`).`;
  }
  return `No fix published yet for \`${a.module}\`. Consider a workaround that avoids \`${a.symbol ?? '(unknown symbol)'}\`.`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
