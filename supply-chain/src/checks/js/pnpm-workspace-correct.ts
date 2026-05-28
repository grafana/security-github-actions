import { join } from 'node:path';
import type { NodeCheck, Finding, NodeRoot, RepoContext } from '../../types.ts';
import { readConfigIfPresent, valueMeetsRequirement } from './_config-helpers.ts';
import type { CompareMode } from './_config-helpers.ts';

export const CHECK_ID = 'pnpm-workspace-correct';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/pnpm-workspace-correct.md';

// Required keys, expected values, and comparison mode. `minimumReleaseAge` is
// minutes; higher = more secure, so we accept anything ≥ 4320. The other two
// are booleans where the literal `true` is the only correct setting.
// `allowBuilds` and `trustPolicy` are intentionally not required — different
// teams will have different lists; the doc allows both keys but doesn't
// mandate specific contents.
const REQUIRED: ReadonlyArray<{ key: string; expected: string; mode: CompareMode }> = [
  { key: 'minimumReleaseAge', expected: '4320', mode: 'min-int' },
  { key: 'strictDepBuilds', expected: 'true', mode: 'eq' },
  { key: 'blockExoticSubdeps', expected: 'true', mode: 'eq' },
];

export const check: NodeCheck = {
  ecosystem: 'js',
  id: CHECK_ID,
  severity: 'blocking',
  async run(root: NodeRoot, ctx: RepoContext): Promise<Finding[]> {
    if (root.packageManager !== 'pnpm') return [];

    const relPath = root.path === '.' ? 'pnpm-workspace.yaml' : `${root.path}/pnpm-workspace.yaml`;
    const text = await readConfigIfPresent(join(ctx.repoRoot, relPath));
    if (text === null) {
      return REQUIRED.map((r) =>
        missing(root.path, relPath, r.key, r.expected, `pnpm-workspace.yaml is missing at ${relPath}.`),
      );
    }

    const top = parseTopLevelYamlScalars(text);
    const findings: Finding[] = [];
    for (const { key, expected, mode } of REQUIRED) {
      const actual = top.get(key);
      if (actual === undefined) {
        findings.push(missing(root.path, relPath, key, expected, `${relPath} does not set ${key}.`));
      } else if (!valueMeetsRequirement(actual, expected, mode)) {
        const title =
          mode === 'min-int'
            ? `\`${key}\` below minimum in ${relPath} (got ${actual}, want >= ${expected})`
            : `\`${key}\` has wrong value in ${relPath} (got ${actual}, want ${expected})`;
        const detail =
          mode === 'min-int'
            ? `Expected \`${key}: ${expected}\` or higher, found \`${key}: ${actual}\` in ${relPath}.`
            : `Expected \`${key}: ${expected}\`, found \`${key}: ${actual}\` in ${relPath}.`;
        const fix =
          mode === 'min-int'
            ? `Set \`${key}: ${expected}\` (or higher) in ${relPath}.`
            : `Set \`${key}: ${expected}\` in ${relPath}.`;
        findings.push({
          check_id: CHECK_ID,
          severity: 'blocking',
          root: root.path,
          title,
          detail,
          fix,
          doc_link: DOC_LINK,
        });
      }
    }
    return findings;
  },
};

function missing(root: string, relPath: string, key: string, expected: string, detail: string): Finding {
  return {
    check_id: CHECK_ID,
    severity: 'blocking',
    root,
    title: `\`${key}\` not set in ${relPath}`,
    detail,
    fix: `Add \`${key}: ${expected}\` to ${relPath}.`,
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
