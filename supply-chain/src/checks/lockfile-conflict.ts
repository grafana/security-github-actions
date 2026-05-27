import type { Check, Finding, Root } from '../types.ts';

export const CHECK_ID = 'lockfile-conflict';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/lockfile-conflict.md';

// Two-or-more lockfiles at the same root => almost always a half-finished
// migration between package managers. Refuse to guess.
export const check: Check = {
  id: CHECK_ID,
  severity: 'blocking',
  async run(root: Root): Promise<Finding[]> {
    if (root.lockfiles.length <= 1) return [];
    return [
      {
        check_id: CHECK_ID,
        severity: 'blocking',
        root: root.path,
        title: `Multiple lockfiles at the same root (${root.lockfiles.length})`,
        detail: `Found: ${root.lockfiles.join(', ')}. The supply-chain workflow refuses to guess which package manager rules apply.`,
        fix: 'Delete the lockfile(s) for the package manager(s) you are not using, and ensure `packageManager:` matches the one you keep.',
        doc_link: DOC_LINK,
      },
    ];
  },
};
