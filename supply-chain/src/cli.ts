// Static-checks CLI. Runs every non-audit check across all roots, writes a
// JSON findings payload, and (when no environment-driven payload sink is set)
// emits the rendered markdown to stdout for local debugging.
//
// Exit codes:
//   0 — no blocking findings (advisory findings allowed)
//   1 — at least one blocking finding
//   2 — unexpected error (parser crash, etc.)

import { writeFile } from 'node:fs/promises';
import { argv, env, exit, stdout } from 'node:process';

import { renderMarkdown } from './report.ts';
import { runChecks, buildRunUrl } from './engine.ts';
import { writePayload } from './io.ts';
import type { Check } from './types.ts';

import { check as lockfileCommitted } from './checks/lockfile-committed.ts';
import { check as lockfileConflict } from './checks/lockfile-conflict.ts';
import { check as packagemanagerPinned } from './checks/packagemanager-pinned.ts';
import { check as npmrcCorrect } from './checks/npmrc-correct.ts';
import { check as pnpmWorkspaceCorrect } from './checks/pnpm-workspace-correct.ts';
import { check as yarnrcCorrect } from './checks/yarnrc-correct.ts';
import { check as nodeVersionPinned } from './checks/node-version-pinned.ts';
import { check as installNotCi } from './checks/install-not-ci.ts';
import { check as npxConfusion } from './checks/npx-confusion.ts';
import { check as oidcPublishing } from './checks/oidc-publishing.ts';
import { check as cachePoisoningPublish } from './checks/cache-poisoning-publish.ts';

// Order here is the order checks appear in the "Passing checks" section of
// the report. `registry-audit` is *not* here — it lives in audit-cli.ts.
const STATIC_CHECKS: Check[] = [
  // Blocking — see ADR-0003.
  packagemanagerPinned,
  lockfileCommitted,
  lockfileConflict,
  npmrcCorrect,
  pnpmWorkspaceCorrect,
  yarnrcCorrect,

  // Advisory (non-network).
  nodeVersionPinned,
  installNotCi,
  npxConfusion,
  oidcPublishing,
  cachePoisoningPublish,
];

async function main(): Promise<void> {
  const repoRoot = argv[2] ?? '.';
  const result = await runChecks(repoRoot, STATIC_CHECKS);

  if (result.rootCount === 0) {
    stdout.write('No package.json found; supply-chain checks skipped.\n');
    return;
  }

  // Primary contract: JSON payload at SUPPLY_CHAIN_FINDINGS_OUT. The render
  // job picks this up alongside the audit job's payload.
  const findingsOut = env.SUPPLY_CHAIN_FINDINGS_OUT;
  if (findingsOut) {
    await writePayload(findingsOut, {
      source: 'static',
      ran: result.ran,
      findings: result.active,
      suppressed: result.suppressed,
    });
  }

  // Secondary: this job's own step summary (so the static job's GH page
  // shows its own findings without depending on the render job). The
  // unified comment is rendered separately by render-cli.ts.
  const markdown = renderMarkdown({
    ran: result.ran,
    findings: result.active,
    suppressed: result.suppressed,
    runUrl: env.GITHUB_RUN_URL ?? buildRunUrl(),
  });

  const summaryFile = env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    await writeFile(summaryFile, markdown + '\n', { flag: 'a' });
  } else if (!findingsOut) {
    // Local invocation with no env wiring — emit markdown to stdout so
    // developers running the CLI by hand see something useful.
    stdout.write(markdown + '\n');
  }

  const blocking = result.active.filter((f) => f.severity === 'blocking');
  if (blocking.length > 0) exit(1);
}

main().catch((err) => {
  stdout.write(`supply-chain: unexpected error: ${(err as Error).stack ?? err}\n`);
  exit(2);
});
