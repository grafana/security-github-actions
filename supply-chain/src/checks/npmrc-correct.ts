import { join } from 'node:path';
import type { Check, Finding, Root, RepoContext } from '../types.ts';
import { readConfigIfPresent, parseLineConfig, valueMeetsRequirement } from './_config-helpers.ts';
import type { CompareMode } from './_config-helpers.ts';

export const CHECK_ID = 'npmrc-correct';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/npmrc-correct.md';

// Required keys, their expected values, and how to compare them.
// `min-release-age` is days; higher = more secure, so it uses `min-int`.
// The other two are enum/boolean values where exact match is the only
// correct setting.
const REQUIRED: ReadonlyArray<{ key: string; expected: string; mode: CompareMode }> = [
  { key: 'ignore-scripts', expected: 'true', mode: 'eq' },
  { key: 'allow-git', expected: 'none', mode: 'eq' },
  { key: 'min-release-age', expected: '3', mode: 'min-int' },
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
    for (const { key, expected, mode } of REQUIRED) {
      const actual = config.get(key);
      if (actual === undefined) {
        findings.push(missingKeyFinding(root.path, relPath, key, expected, `${relPath} does not set ${key}.`));
      } else if (!valueMeetsRequirement(actual, expected, mode)) {
        const title =
          mode === 'min-int'
            ? `\`${key}\` below minimum in ${relPath} (got ${actual}, want >= ${expected})`
            : `\`${key}\` has wrong value in ${relPath} (got ${actual}, want ${expected})`;
        const detail =
          mode === 'min-int'
            ? `Expected \`${key}=${expected}\` or higher, found \`${key}=${actual}\` in ${relPath}.`
            : `Expected \`${key}=${expected}\`, found \`${key}=${actual}\` in ${relPath}.`;
        const fix =
          mode === 'min-int'
            ? `Set \`${key}=${expected}\` (or higher) in ${relPath}.`
            : `Set \`${key}=${expected}\` in ${relPath}.`;
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
