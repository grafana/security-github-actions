import { join } from 'node:path';
import type { Check, Finding, Root, RepoContext } from '../types.ts';
import { readConfigIfPresent, parseLineConfig } from './_config-helpers.ts';

export const CHECK_ID = 'npmrc-correct';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/npmrc-correct.md';

// Required keys and their expected values. One Finding is produced per missing
// or wrong-valued key — per ADR-Q1 / hardening guide.
const REQUIRED: ReadonlyArray<{ key: string; expected: string }> = [
  { key: 'ignore-scripts', expected: 'true' },
  { key: 'allow-git', expected: 'none' },
  { key: 'min-release-age', expected: '3' },
];

export const check: Check = {
  id: CHECK_ID,
  severity: 'blocking',
  async run(root: Root, ctx: RepoContext): Promise<Finding[]> {
    if (root.packageManager !== 'npm') return [];

    const relPath = root.path === '.' ? '.npmrc' : `${root.path}/.npmrc`;
    const text = await readConfigIfPresent(join(ctx.repoRoot, relPath));
    if (text === null) {
      // No .npmrc at all => one finding per required key, so the developer
      // sees exactly what to add.
      return REQUIRED.map((r) =>
        missingKeyFinding(root.path, relPath, r.key, r.expected, `.npmrc is missing at ${relPath}`),
      );
    }

    const config = parseLineConfig(text);
    const findings: Finding[] = [];
    for (const { key, expected } of REQUIRED) {
      const actual = config.get(key);
      if (actual === undefined) {
        findings.push(missingKeyFinding(root.path, relPath, key, expected, `${relPath} does not set ${key}.`));
      } else if (actual !== expected) {
        findings.push({
          check_id: CHECK_ID,
          severity: 'blocking',
          root: root.path,
          title: `\`${key}\` has wrong value in ${relPath} (got ${actual}, want ${expected})`,
          detail: `Expected \`${key}=${expected}\`, found \`${key}=${actual}\` in ${relPath}.`,
          fix: `Set \`${key}=${expected}\` in ${relPath}.`,
          doc_link: DOC_LINK,
        });
      }
    }
    return findings;
  },
};

function missingKeyFinding(
  root: string,
  relPath: string,
  key: string,
  expected: string,
  detail: string,
): Finding {
  return {
    check_id: CHECK_ID,
    severity: 'blocking',
    root,
    title: `\`${key}\` not set in ${relPath}`,
    detail,
    fix: `Add \`${key}=${expected}\` to ${relPath}.`,
    doc_link: DOC_LINK,
  };
}
