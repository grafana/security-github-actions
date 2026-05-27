// Audit-only CLI. Runs registry-audit across all roots and writes a JSON
// findings payload. Does NOT re-run the static checks (that's static-cli's
// job). The output is merged with the static job's output by render-cli.ts
// to produce the unified sticky PR comment.
//
// Exit code is always 0 (advisory: nothing this CLI does should fail the
// workflow). The workflow's `continue-on-error: true` is the second line of
// defence, but as a courtesy this CLI doesn't even try to surface a
// non-zero exit for audit findings.

import { writeFile } from 'node:fs/promises';
import { argv, env, exit, stdout } from 'node:process';

import { renderMarkdown } from './report.ts';
import { runChecks, buildRunUrl } from './engine.ts';
import { writePayload } from './io.ts';
import type { Check } from './types.ts';

import { check as registryAudit } from './checks/registry-audit.ts';

const AUDIT_CHECKS: Check[] = [registryAudit];

async function main(): Promise<void> {
  const repoRoot = argv[2] ?? '.';
  const result = await runChecks(repoRoot, AUDIT_CHECKS);

  if (result.rootCount === 0) {
    stdout.write('No package.json found; audit skipped.\n');
    return;
  }

  const findingsOut = env.SUPPLY_CHAIN_FINDINGS_OUT;
  if (findingsOut) {
    await writePayload(findingsOut, {
      source: 'audit',
      ran: result.ran,
      findings: result.active,
      suppressed: result.suppressed,
    });
  }

  // This job's own step summary (audit findings only). The unified comment
  // is the render job's responsibility.
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
    stdout.write(markdown + '\n');
  }
}

main().catch((err) => {
  stdout.write(`audit-cli: unexpected error: ${(err as Error).stack ?? err}\n`);
  // Even on a hard crash, exit 0. The empty/missing JSON output means the
  // render job will just not show audit findings — graceful degradation.
  exit(0);
});
