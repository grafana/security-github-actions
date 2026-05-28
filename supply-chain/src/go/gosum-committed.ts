import type { GoCheck, Finding, GoRoot, RepoContext } from '../types.ts';

export const CHECK_ID = 'gosum-committed';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/go/gosum-committed.md';

// `go.sum` must be present and tracked by git for every module that has at
// least one external dependency. A module with no `require` entries
// legitimately has no go.sum (there's nothing to hash), so we don't flag
// that case.
export const check: GoCheck = {
  ecosystem: 'go',
  id: CHECK_ID,
  severity: 'blocking',
  async run(root: GoRoot, ctx: RepoContext): Promise<Finding[]> {
    if (!root.hasRequires) return [];

    const relPath = root.path === '.' ? 'go.sum' : `${root.path}/go.sum`;

    if (!root.gosumPresent) {
      return [
        {
          check_id: CHECK_ID,
          severity: 'blocking',
          root: root.path,
          title: 'Missing go.sum',
          detail: `Module ${describe(root)} declares external dependencies but has no go.sum.`,
          fix: 'Run `go mod tidy` and commit the resulting go.sum.',
          doc_link: DOC_LINK,
        },
      ];
    }

    if (ctx.trackedFiles !== null && !ctx.trackedFiles.has(relPath)) {
      return [
        {
          check_id: CHECK_ID,
          severity: 'blocking',
          root: root.path,
          title: 'go.sum present but not committed',
          detail: `${relPath} exists on disk but is not tracked by git. Likely .gitignore'd.`,
          fix: `Remove go.sum from .gitignore and commit it.`,
          doc_link: DOC_LINK,
        },
      ];
    }

    return [];
  },
};

function describe(root: GoRoot): string {
  return root.path === '.' ? 'at the repository root' : `at ${root.path}`;
}
