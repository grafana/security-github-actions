import type { NodeCheck, Finding, NodeRoot, RepoContext, PackageManager } from '../types.ts';

export const CHECK_ID = 'lockfile-committed';

// Map of package manager → expected lockfile filename at the root. Yarn 1 and
// Yarn 4 share `yarn.lock`. pnpm uses `pnpm-lock.yaml`. npm uses
// `package-lock.json`. We do not accept "any" lockfile — a pnpm root with a
// `package-lock.json` is a separate problem (lockfile-conflict + wrong-manager
// findings), handled elsewhere.
const EXPECTED: Record<PackageManager, string> = {
  npm: 'package-lock.json',
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock',
};

export const check: NodeCheck = {
  ecosystem: 'js',
  id: CHECK_ID,
  severity: 'critical',
  async run(root: NodeRoot, ctx: RepoContext): Promise<Finding[]> {
    // The packageManager-pinned check handles the missing-packageManager case
    // on its own. Without a manager we can't know which lockfile to require,
    // so we stay quiet here.
    if (root.packageManager === null) return [];

    const expectedName = EXPECTED[root.packageManager];
    const expectedPath = root.path === '.' ? expectedName : `${root.path}/${expectedName}`;

    const onDisk = root.lockfiles.includes(expectedPath);
    if (!onDisk) {
      return [
        {
          check_id: CHECK_ID,
          severity: 'critical',
          root: root.path,
          title: `Missing lockfile (${expectedName})`,
          detail: `Root ${describe(root)} declares packageManager=${root.packageManager} but has no ${expectedName}.`,
          fix: `Run the project's install command and commit the resulting ${expectedName}.`,
          doc_link: 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/js/lockfile-committed.md',
        },
      ];
    }

    // On disk; now verify it's tracked by git (defends against .gitignore'd lockfile).
    if (ctx.trackedFiles !== null && !ctx.trackedFiles.has(expectedPath)) {
      return [
        {
          check_id: CHECK_ID,
          severity: 'critical',
          root: root.path,
          title: `Lockfile present but not committed (${expectedName})`,
          detail: `${expectedPath} exists on disk but is not tracked by git. Likely .gitignore'd.`,
          fix: `Remove ${expectedName} from .gitignore and commit it.`,
          doc_link: 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/js/lockfile-committed.md',
        },
      ];
    }

    return [];
  },
};

function describe(root: NodeRoot): string {
  return root.path === '.' ? 'the repository root' : root.path;
}
