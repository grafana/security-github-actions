import { join } from 'node:path';
import type { Check, Finding, Root, RepoContext } from '../types.ts';
import { readConfigIfPresent } from './_config-helpers.ts';
import { parseTopLevelYamlScalars } from './pnpm-workspace-correct.ts';

export const CHECK_ID = 'yarnrc-correct';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/yarnrc-correct.md';

const REQUIRED: ReadonlyArray<{ key: string; expected: string }> = [
  { key: 'enableScripts', expected: 'false' },
  { key: 'enableImmutableInstalls', expected: 'true' },
  { key: 'npmMinimalAgeGate', expected: '4320' },
];

// Even the *presence* of this key is a security risk per the hardening guide.
const FORBIDDEN_KEY = 'approvedGitRepositories';

export const check: Check = {
  id: CHECK_ID,
  severity: 'blocking',
  async run(root: Root, ctx: RepoContext): Promise<Finding[]> {
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

    if (containsTopLevelKey(text, FORBIDDEN_KEY)) {
      findings.push({
        check_id: CHECK_ID,
        severity: 'blocking',
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
    severity: 'blocking',
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
