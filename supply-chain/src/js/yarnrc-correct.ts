import { join } from 'node:path';
import type { NodeCheck, Finding, NodeRoot, RepoContext } from '../types.ts';
import { readConfigIfPresent, valueMeetsRequirement } from './_config-helpers.ts';
import type { CompareMode } from './_config-helpers.ts';
import { parseTopLevelYamlScalars } from './pnpm-workspace-correct.ts';

export const CHECK_ID = 'yarnrc-correct';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/js/yarnrc-correct.md';

// `npmMinimalAgeGate` is minutes — higher = more secure, so we accept ≥ 4320.
// The two boolean keys must match exactly.
const REQUIRED: ReadonlyArray<{ key: string; expected: string; mode: CompareMode }> = [
  { key: 'enableScripts', expected: 'false', mode: 'eq' },
  { key: 'enableImmutableInstalls', expected: 'true', mode: 'eq' },
  { key: 'npmMinimalAgeGate', expected: '4320', mode: 'min-int' },
];

// Even the *presence* of this key is a security risk per the hardening guide.
const FORBIDDEN_KEY = 'approvedGitRepositories';

export const check: NodeCheck = {
  ecosystem: 'js',
  id: CHECK_ID,
  severity: 'critical',
  async run(root: NodeRoot, ctx: RepoContext): Promise<Finding[]> {
    if (root.packageManager !== 'yarn') return [];

    const relPath = root.path === '.' ? '.yarnrc.yml' : `${root.path}/.yarnrc.yml`;
    const text = await readConfigIfPresent(join(ctx.repoRoot, relPath));
    if (text === null) {
      return REQUIRED.map((r) =>
        missing(root.path, relPath, r.key, r.expected, `.yarnrc.yml is missing at ${relPath}.`),
      );
    }

    const findings: Finding[] = [];
    const top = parseTopLevelYamlScalars(text);
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
          severity: 'critical',
          root: root.path,
          title,
          detail,
          fix,
          doc_link: DOC_LINK,
        });
      }
    }

    if (containsTopLevelKey(text, FORBIDDEN_KEY)) {
      findings.push({
        check_id: CHECK_ID,
        severity: 'critical',
        root: root.path,
        title: `\`approvedGitRepositories\` is forbidden in ${relPath}`,
        detail: `The presence of \`approvedGitRepositories\` allows arbitrary code execution. The hardening guide forbids it even with an empty list.`,
        fix: `Remove \`approvedGitRepositories\` from ${relPath}.`,
        doc_link: DOC_LINK,
      });
    }

    return findings;
  },
};

function missing(root: string, relPath: string, key: string, expected: string, detail: string): Finding {
  return {
    check_id: CHECK_ID,
    severity: 'critical',
    root,
    title: `\`${key}\` not set in ${relPath}`,
    detail,
    fix: `Add \`${key}: ${expected}\` to ${relPath}.`,
    doc_link: DOC_LINK,
  };
}

// True if `key:` appears as a top-level (non-indented) key, regardless of
// whether it has a scalar value, opens a list, or opens a nested mapping.
function containsTopLevelKey(text: string, key: string): boolean {
  const re = new RegExp(`^${escapeRegex(key)}\\s*:`, 'm');
  // Strip comments line-by-line first so a `# approvedGitRepositories:` in a
  // comment is not a false positive.
  const stripped = text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, ''))
    .join('\n');
  return re.test(stripped);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
