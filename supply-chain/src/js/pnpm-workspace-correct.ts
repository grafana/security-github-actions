import { join } from 'node:path';
import type { NodeCheck, Finding, NodeRoot, RepoContext } from '../types.ts';
import { readConfigIfPresent } from './_config-helpers.ts';

export const CHECK_ID = 'pnpm-workspace-correct';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/js/pnpm-workspace-correct.md';

// PR1 scope: only `strictDepBuilds: true` is enforced. This is pnpm's analog
// of npm's `ignore-scripts=true` / yarn's `enableScripts: false` — it upgrades
// pnpm's default "warn on unknown postinstall builder" to a hard install
// failure. `minimumReleaseAge` and `blockExoticSubdeps` ship in a follow-up
// PR. `allowBuilds` and `trustPolicy` remain optional / team-specific.
const REQUIRED_KEY = 'strictDepBuilds';
const REQUIRED_VALUE = 'true';

export const check: NodeCheck = {
  ecosystem: 'js',
  id: CHECK_ID,
  severity: 'critical',
  async run(root: NodeRoot, ctx: RepoContext): Promise<Finding[]> {
    if (root.packageManager !== 'pnpm') return [];

    const relPath = root.path === '.' ? 'pnpm-workspace.yaml' : `${root.path}/pnpm-workspace.yaml`;
    const text = await readConfigIfPresent(join(ctx.repoRoot, relPath));

    if (text === null) {
      return [missing(root.path, relPath, `pnpm-workspace.yaml is missing at ${relPath}.`)];
    }

    const top = parseTopLevelYamlScalars(text);
    const actual = top.get(REQUIRED_KEY);
    if (actual === undefined) {
      return [missing(root.path, relPath, `${relPath} does not set ${REQUIRED_KEY}.`)];
    }
    if (actual !== REQUIRED_VALUE) {
      return [
        {
          check_id: CHECK_ID,
          severity: 'critical',
          root: root.path,
          title: `\`${REQUIRED_KEY}\` has wrong value in ${relPath} (got ${actual}, want ${REQUIRED_VALUE})`,
          detail: `Expected \`${REQUIRED_KEY}: ${REQUIRED_VALUE}\`, found \`${REQUIRED_KEY}: ${actual}\` in ${relPath}. Without this, pnpm only warns (not fails) when a package wants to run a postinstall builder script — making it easy to miss in CI.`,
          fix: `Set \`${REQUIRED_KEY}: ${REQUIRED_VALUE}\` in ${relPath}.`,
          doc_link: DOC_LINK,
        },
      ];
    }
    return [];
  },
};

function missing(root: string, relPath: string, detail: string): Finding {
  return {
    check_id: CHECK_ID,
    severity: 'critical',
    root,
    title: `\`${REQUIRED_KEY}\` not set in ${relPath}`,
    detail: `${detail} Without this, pnpm only warns (not fails) when a package wants to run a postinstall builder script — making it easy to miss in CI.`,
    fix: `Add \`${REQUIRED_KEY}: ${REQUIRED_VALUE}\` to ${relPath}.`,
    doc_link: DOC_LINK,
  };
}

// Extracts top-level `key: value` pairs where the value is a scalar (not a
// list or nested mapping). Sufficient for the keys we check here. Lines that
// start a list (`key:` followed by `- item` lines) are skipped — they are not
// scalars and not the values we examine.
export function parseTopLevelYamlScalars(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').replace(/\s+$/, '');
    if (line.length === 0) continue;
    if (/^\s/.test(line)) continue; // not a top-level line
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.trim();
    if (value.length === 0) continue; // begins a block scalar / list; not a value we read
    out.set(key, stripQuotes(value));
  }
  return out;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
