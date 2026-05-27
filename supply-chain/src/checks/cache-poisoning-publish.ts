import type { Check, Finding, Root, RepoContext } from '../types.ts';
import { listScannedFiles, isWorkflowFile, type ScannedFile } from '../scanner.ts';

export const CHECK_ID = 'cache-poisoning-publish';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/cache-poisoning-publish.md';

const PUBLISH_RE = /\b(npm|pnpm|yarn(?:\s+npm)?)\s+publish\b/;

// Match `uses: actions/setup-node@…` to find each setup-node step.
const SETUP_NODE_RE = /uses\s*:\s*actions\/setup-node@/;
const PACKAGE_MANAGER_CACHE_FALSE = /package-manager-cache\s*:\s*false/;
const CACHE_KEY = /\bcache\s*:/;

export const check: Check = {
  id: CHECK_ID,
  severity: 'advisory',
  async run(root: Root, ctx: RepoContext): Promise<Finding[]> {
    if (root.path !== '.') return [];

    const files = (await listScannedFiles(ctx.repoRoot)).filter((f) => isWorkflowFile(f.path));
    const findings: Finding[] = [];
    for (const file of files) {
      if (!hasPublishCall(file)) continue;
      // For publishing workflows: every setup-node step should either explicitly
      // disable the package-manager-cache, or have no `cache:` input at all.
      const stepReports = analyseSetupNodeSteps(file);
      for (const step of stepReports) {
        if (!step.cacheDisabled) {
          findings.push({
            check_id: CHECK_ID,
            severity: 'advisory',
            root: '.',
            title: `Publishing workflow ${file.path} uses cached setup-node at line ${step.line}`,
            detail: `Publishing workflows should not consume the shared package-manager cache. Lower-trust CI jobs can poison it.`,
            fix: 'Add `package-manager-cache: false` to the `actions/setup-node` step in the publishing job.',
            doc_link: DOC_LINK,
          });
        }
      }
    }
    return findings;
  },
};

function hasPublishCall(file: ScannedFile): boolean {
  return file.lines.some((l) => PUBLISH_RE.test(l.replace(/#.*$/, '')));
}

type StepReport = { line: number; cacheDisabled: boolean };

// Find each setup-node use site and examine the `with:` block immediately
// following it. We approximate "the with: block" as "the next ~15 indented
// lines after the uses: line". Crude, but adequate at advisory severity.
function analyseSetupNodeSteps(file: ScannedFile): StepReport[] {
  const reports: StepReport[] = [];
  for (let i = 0; i < file.lines.length; i++) {
    const line = file.lines[i]!;
    if (!SETUP_NODE_RE.test(line)) continue;
    let cacheDisabled = true; // default: no `cache:` at all => OK
    for (let j = i + 1; j < Math.min(file.lines.length, i + 16); j++) {
      const inner = file.lines[j]!;
      // Stop if dedented (next step) — heuristic: a line starting with `- ` at
      // the same indent as the `- uses:` we matched.
      if (/^\s*- /.test(inner) && inner !== file.lines[i]) break;
      if (PACKAGE_MANAGER_CACHE_FALSE.test(inner)) {
        cacheDisabled = true;
        break;
      }
      if (CACHE_KEY.test(inner)) {
        // A cache: input is present without an explicit disable below it.
        // The order of inputs doesn't actually matter to setup-node, but we
        // can't distinguish "cache: true" from "cache: npm" cheaply; treat
        // any `cache:` mention as enabled unless we *also* see the explicit
        // disable.
        cacheDisabled = false;
      }
    }
    reports.push({ line: i + 1, cacheDisabled });
  }
  return reports;
}
