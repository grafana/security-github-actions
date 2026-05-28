import { join } from 'node:path';
import type { NodeCheck, Finding, NodeRoot, RepoContext } from '../types.ts';
import { readConfigIfPresent } from './_config-helpers.ts';
import { parseTopLevelYamlScalars } from './pnpm-workspace-correct.ts';

export const CHECK_ID = 'yarnrc-correct';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/js/yarnrc-correct.md';

// PR1 scope: only `enableScripts: false` is enforced. `enableImmutableInstalls`,
// `npmMinimalAgeGate`, and the forbidden `approvedGitRepositories` rule ship
// in a follow-up PR.
const REQUIRED_KEY = 'enableScripts';
const REQUIRED_VALUE = 'false';

export const check: NodeCheck = {
  ecosystem: 'js',
  id: CHECK_ID,
  severity: 'critical',
  async run(root: NodeRoot, ctx: RepoContext): Promise<Finding[]> {
    if (root.packageManager !== 'yarn') return [];

    const relPath = root.path === '.' ? '.yarnrc.yml' : `${root.path}/.yarnrc.yml`;
    const text = await readConfigIfPresent(join(ctx.repoRoot, relPath));

    if (text === null) {
      return [missing(root.path, relPath, `.yarnrc.yml is missing at ${relPath}.`)];
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
          detail: `Expected \`${REQUIRED_KEY}: ${REQUIRED_VALUE}\`, found \`${REQUIRED_KEY}: ${actual}\` in ${relPath}. Without this, every \`yarn install\` runs arbitrary code from postinstall scripts of any package in the dependency tree.`,
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
    detail: `${detail} Without this, every \`yarn install\` runs arbitrary code from postinstall scripts of any package in the dependency tree.`,
    fix: `Add \`${REQUIRED_KEY}: ${REQUIRED_VALUE}\` to ${relPath}.`,
    doc_link: DOC_LINK,
  };
}
