import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NodeCheck, Finding, NodeRoot, RepoContext } from '../types.ts';

export const CHECK_ID = 'packagemanager-pinned';

// Minimum versions required by the org hardening guide. These are the versions
// that introduce the security controls we depend on (e.g. yarn's
// `approvedGitRepositories`, npm's `min-release-age`).
const MIN_VERSIONS = {
  npm: { major: 11, minor: 10, patch: 0 },
  pnpm: { major: 11, minor: 0, patch: 0 },
  yarn: { major: 4, minor: 14, patch: 0 },
} as const;

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/js/packagemanager-pinned.md';

export const check: NodeCheck = {
  ecosystem: 'js',
  id: CHECK_ID,
  severity: 'blocking',
  async run(root: NodeRoot, ctx: RepoContext): Promise<Finding[]> {
    const manifestPath = root.path === '.' ? 'package.json' : `${root.path}/package.json`;
    const text = await readFile(join(ctx.repoRoot, manifestPath), 'utf8');
    let parsed: { packageManager?: unknown };
    try {
      parsed = JSON.parse(text);
    } catch {
      return [
        {
          check_id: CHECK_ID,
          severity: 'blocking',
          root: root.path,
          title: 'Could not parse package.json',
          detail: `${manifestPath} is not valid JSON.`,
          fix: 'Fix the JSON syntax.',
          doc_link: DOC_LINK,
        },
      ];
    }

    const pm = parsed.packageManager;
    if (typeof pm !== 'string' || pm.length === 0) {
      return [
        {
          check_id: CHECK_ID,
          severity: 'blocking',
          root: root.path,
          title: 'Missing `packageManager` field in package.json',
          detail: `${manifestPath} does not declare a packageManager. Without it, we cannot determine which manager rules to apply.`,
          fix: 'Add `"packageManager": "<name>@<version>"` (e.g. `"pnpm@11.0.0"`) to package.json.',
          doc_link: DOC_LINK,
        },
      ];
    }

    const parsedPm = parsePackageManagerField(pm);
    if (parsedPm === null) {
      return [
        {
          check_id: CHECK_ID,
          severity: 'blocking',
          root: root.path,
          title: 'Unrecognised `packageManager` value',
          detail: `${manifestPath} has packageManager="${pm}", which we cannot interpret. Expected one of: npm, pnpm, yarn.`,
          fix: 'Set packageManager to "npm@<v>", "pnpm@<v>", or "yarn@<v>".',
          doc_link: DOC_LINK,
        },
      ];
    }

    const min = MIN_VERSIONS[parsedPm.name];
    if (compareVersions(parsedPm.version, min) < 0) {
      return [
        {
          check_id: CHECK_ID,
          severity: 'blocking',
          root: root.path,
          title: `${parsedPm.name} pinned below minimum (${formatVersion(parsedPm.version)} < ${formatVersion(min)})`,
          detail: `Required security controls (e.g. release-age gates, git-dep blocking) are only available in ${parsedPm.name} ${formatVersion(min)}+.`,
          fix: `Set packageManager to "${parsedPm.name}@${formatVersion(min)}" or newer.`,
          doc_link: DOC_LINK,
        },
      ];
    }

    return [];
  },
};

type ParsedVersion = { major: number; minor: number; patch: number };
type ParsedPackageManager = { name: 'npm' | 'pnpm' | 'yarn'; version: ParsedVersion };

function parsePackageManagerField(value: string): ParsedPackageManager | null {
  // Strip the optional `+<sha>` integrity suffix used by Corepack.
  const noHash = value.split('+')[0]!;
  const m = /^(npm|pnpm|yarn)@(\d+)\.(\d+)\.(\d+)/.exec(noHash);
  if (!m) return null;
  return {
    name: m[1] as 'npm' | 'pnpm' | 'yarn',
    version: { major: Number(m[2]), minor: Number(m[3]), patch: Number(m[4]) },
  };
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function formatVersion(v: ParsedVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

export const __test = { parsePackageManagerField, compareVersions };
