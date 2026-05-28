import type { NodeCheck, Finding, NodeRoot, RepoContext } from '../../types.ts';
import { listScannedFiles } from '../../scanner.ts';

export const CHECK_ID = 'install-not-ci';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/install-not-ci.md';

// Heuristic — repo-wide; only emitted once per workflow run at the repo root.
//
// Flags any `npm install` / `yarn install` / `pnpm install` call site that
// isn't the lockfile-strict variant. The lockfile-strict variants are:
//   npm ci
//   yarn install --immutable[ --immutable-cache]
//   pnpm install --frozen-lockfile
//
// False positives we accept:
//   - shell comments with the offending string (rare; we strip leading `#` comments)
//   - `.md` files mentioning the command as docs (scanner doesn't include .md)
const PATTERN = /\b(npm|yarn|pnpm)\s+install\b([^\n]*)/;

export const check: NodeCheck = {
  ecosystem: 'js',
  id: CHECK_ID,
  severity: 'advisory',
  async run(root: NodeRoot, ctx: RepoContext): Promise<Finding[]> {
    if (root.path !== '.') return []; // repo-wide check, runs once at repo root

    const files = await listScannedFiles(ctx.repoRoot);
    const findings: Finding[] = [];
    for (const file of files) {
      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i]!;
        const stripped = stripLineComment(line);
        const m = PATTERN.exec(stripped);
        if (!m) continue;
        const manager = m[1]!;
        const rest = m[2] ?? '';
        if (isLockfileStrict(manager, rest)) continue;
        findings.push({
          check_id: CHECK_ID,
          severity: 'advisory',
          root: '.',
          title: `${manager} install (non-lockfile-strict) found in ${file.path}:${i + 1}`,
          detail: `\`${line.trim()}\` does not use the lockfile-strict variant. CI installs without --frozen-lockfile / --immutable / npm ci can drift from the committed lockfile.`,
          fix: lockfileStrictFor(manager),
          doc_link: DOC_LINK,
        });
      }
    }
    return findings;
  },
};

function isLockfileStrict(manager: string, rest: string): boolean {
  if (manager === 'npm') return false; // any `npm install` form is non-strict — use `npm ci`
  if (manager === 'yarn') return /--immutable\b/.test(rest);
  if (manager === 'pnpm') return /--frozen-lockfile\b/.test(rest);
  return false;
}

function lockfileStrictFor(manager: string): string {
  switch (manager) {
    case 'npm':
      return 'Use `npm ci` instead of `npm install` in CI / build scripts.';
    case 'yarn':
      return 'Use `yarn install --immutable [--immutable-cache]` in CI / build scripts.';
    case 'pnpm':
      return 'Use `pnpm install --frozen-lockfile` in CI / build scripts.';
    default:
      return 'Use the lockfile-strict variant for your package manager.';
  }
}

// Removes a trailing `#` comment from a shell-ish line, but only if the `#`
// appears at the start of a token (not inside a quoted string or URL).
function stripLineComment(line: string): string {
  // Conservative: drop only the simplest leading-comment pattern.
  const trimmed = line.replace(/^\s+/, '');
  if (trimmed.startsWith('#')) return '';
  return line;
}
