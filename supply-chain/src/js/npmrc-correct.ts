import { join } from 'node:path';
import type { NodeCheck, Finding, NodeRoot, RepoContext } from '../types.ts';
import { readConfigIfPresent, parseLineConfig } from './_config-helpers.ts';

export const CHECK_ID = 'npmrc-correct';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/js/npmrc-correct.md';

// PR1 scope: only `ignore-scripts=true` is enforced.
// `allow-git=none` and `min-release-age=3` ship in a follow-up PR.
const REQUIRED_KEY = 'ignore-scripts';
const REQUIRED_VALUE = 'true';

export const check: NodeCheck = {
  ecosystem: 'js',
  id: CHECK_ID,
  severity: 'critical',
  async run(root: NodeRoot, ctx: RepoContext): Promise<Finding[]> {
    if (root.packageManager !== 'npm') return [];

    const relPath = root.path === '.' ? '.npmrc' : `${root.path}/.npmrc`;
    const text = await readConfigIfPresent(join(ctx.repoRoot, relPath));

    if (text === null) {
      return [missing(root.path, relPath, `.npmrc is missing at ${relPath}.`)];
    }

    const config = parseLineConfig(text);
    const actual = config.get(REQUIRED_KEY);
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
          detail: `Expected \`${REQUIRED_KEY}=${REQUIRED_VALUE}\`, found \`${REQUIRED_KEY}=${actual}\` in ${relPath}. Without this, every \`npm install\` runs arbitrary code from postinstall scripts of any package in the dependency tree — the dominant npm supply-chain attack vector.`,
          fix: `Set \`${REQUIRED_KEY}=${REQUIRED_VALUE}\` in ${relPath}.`,
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
    detail: `${detail} Without this, every \`npm install\` runs arbitrary code from postinstall scripts of any package in the dependency tree — the dominant npm supply-chain attack vector.`,
    fix: `Add \`${REQUIRED_KEY}=${REQUIRED_VALUE}\` to ${relPath}.`,
    doc_link: DOC_LINK,
  };
}
