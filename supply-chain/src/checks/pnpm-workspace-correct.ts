import { join } from 'node:path';
import type { Check, Finding, Root, RepoContext } from '../types.ts';
import { readConfigIfPresent } from './_config-helpers.ts';

export const CHECK_ID = 'pnpm-workspace-correct';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/pnpm-workspace-correct.md';

// Required (key, expected literal value as it would appear in YAML).
// `allowBuilds` and `trustPolicy` are intentionally not required — different
// teams will have different lists; the doc allows both keys but doesn't
// mandate specific contents.
const REQUIRED: ReadonlyArray<{ key: string; expected: string }> = [
  { key: 'minimumReleaseAge', expected: '4320' },
  { key: 'strictDepBuilds', expected: 'true' },
  { key: 'blockExoticSubdeps', expected: 'true' },
];

export const check: Check = {
  id: CHECK_ID,
  severity: 'blocking',
  async run(root: Root, ctx: RepoContext): Promise<Finding[]> {
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
    for (const { key, expected } of REQUIRED) {
      const actual = top.get(key);
      if (actual === undefined) {
        findings.push(missing(root.path, relPath, key, expected, `${relPath} does not set ${key}.`));
      } else if (actual !== expected) {
        findings.push({
          check_id: CHECK_ID,
          severity: 'blocking',
          root: root.path,
          title: `\`${key}\` has wrong value in ${relPath} (got ${actual}, want ${expected})`,
          detail: `Expected \`${key}: ${expected}\`, found \`${key}: ${actual}\` in ${relPath}.`,
          fix: `Set \`${key}: ${expected}\` in ${relPath}.`,
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
