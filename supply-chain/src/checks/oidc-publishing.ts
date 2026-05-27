import type { Check, Finding, Root, RepoContext } from '../types.ts';
import { listScannedFiles, isWorkflowFile, type ScannedFile } from '../scanner.ts';

export const CHECK_ID = 'oidc-publishing';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/oidc-publishing.md';

// Phase A — workflow contains a publish call (npm/pnpm/yarn).
const PUBLISH_RE = /^\s*(?:[-]?\s*run:\s*)?.*\b(npm|pnpm|yarn(?:\s+npm)?)\s+publish\b/;

// Phase B — workflow uses OIDC (id-token: write) and doesn't reference a
// long-lived token.
const TOKEN_RE = /\b(NPM_TOKEN|NODE_AUTH_TOKEN|NPM_AUTH_TOKEN)\b/;
const ID_TOKEN_WRITE_RE = /id-token\s*:\s*write/;

export const check: Check = {
  id: CHECK_ID,
  severity: 'advisory',
  async run(root: Root, ctx: RepoContext): Promise<Finding[]> {
    if (root.path !== '.') return [];

    const files = (await listScannedFiles(ctx.repoRoot)).filter((f) => isWorkflowFile(f.path));
    const findings: Finding[] = [];
    for (const file of files) {
      if (!hasPublishCall(file)) continue;
      const idToken = ID_TOKEN_WRITE_RE.test(file.lines.join('\n'));
      const referencesToken = TOKEN_RE.test(file.lines.join('\n'));
      if (!idToken || referencesToken) {
        findings.push({
          check_id: CHECK_ID,
          severity: 'advisory',
          root: '.',
          title: `Publishing workflow ${file.path} may not be using OIDC`,
          detail: idToken
            ? `${file.path} declares id-token: write but also references NPM_TOKEN / NODE_AUTH_TOKEN. Long-lived tokens defeat the OIDC posture.`
            : `${file.path} publishes to npm but does not declare \`permissions: id-token: write\`. Consider switching to OIDC (trusted publishing).`,
          fix: 'See https://docs.npmjs.com/trusted-publishers for the migration steps.',
          doc_link: DOC_LINK,
        });
      }
    }
    return findings;
  },
};

function hasPublishCall(file: ScannedFile): boolean {
  for (const rawLine of file.lines) {
    // Drop YAML comments (`#` to EOL) and shell comments inside `run:` blocks.
    const line = rawLine.replace(/#.*$/, '');
    if (PUBLISH_RE.test(line)) return true;
  }
  return false;
}
