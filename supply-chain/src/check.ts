// The supply-chain CLI. Single entry point for both local use and CI.
//
// Usage:
//   node --experimental-strip-types src/check.ts [flags] [path]
//
// Flags:
//   --no-audit     skip the network-dependent registry-audit check
//                  (faster, works offline; used by the CI `static` job)
//   --audit-only   run only the registry-audit check
//                  (used by the CI `audit` job)
//   --format=<f>   override the stdout format. `text` (terminal-friendly,
//                  default in a TTY) or `markdown` (default when piped or
//                  in CI). The CI env-var sinks always receive markdown
//                  regardless of this flag.
//
// Behaviour is driven by environment variables:
//   SUPPLY_CHAIN_FINDINGS_OUT — if set, write a JSON ReportPayload to this
//                               path (the CI contract; consumed by render-cli)
//   GITHUB_STEP_SUMMARY       — if set, append the rendered markdown here
//                               (so the CI job's page shows its findings)
//   GITHUB_RUN_URL            — link used in the rendered report's footer
//
// If neither of the env-driven sinks is set (the local case), the rendered
// markdown is written to stdout.
//
// Path: positional argument; defaults to the current working directory.
// `cd supply-chain && npm run check` therefore checks the surrounding repo.
//
// Exit codes:
//   0 — no blocking findings
//   1 — at least one blocking finding
//   2 — unexpected error
//
// Note: the audit checks are all `severity: 'advisory'`, so a clean
// `--audit-only` run always exits 0. The one exception is a malformed
// `.github/supply-chain.yml` (which we surface as a synthetic blocking
// finding); that's caught by the CI workflow's `continue-on-error: true`
// on the audit job.

import { writeFile } from 'node:fs/promises';
import { argv, env, exit, stdout, stderr } from 'node:process';
import { resolve } from 'node:path';

import { renderMarkdown } from './report.ts';
import { renderText } from './text-report.ts';
import { runChecks, buildRunUrl } from './engine.ts';
import { writePayload } from './io.ts';
import { makeProgressCallback } from './progress.ts';
import { STATIC_CHECKS, AUDIT_CHECKS, ALL_CHECKS } from './registry.ts';
import type { Check } from './types.ts';
import type { ReportPayload } from './io.ts';

type Mode = 'all' | 'static-only' | 'audit-only';
type Format = 'text' | 'markdown';
type Args = { mode: Mode; target: string; format: Format | 'auto' };

function parseArgs(raw: string[]): Args {
  let mode: Mode = 'all';
  let format: Format | 'auto' = 'auto';
  const positional: string[] = [];
  for (const a of raw) {
    if (a === '--no-audit') mode = 'static-only';
    else if (a === '--audit-only') mode = 'audit-only';
    else if (a === '--format=text' || a === '--format=markdown') {
      format = a.split('=')[1] as Format;
    } else if (a.startsWith('--')) {
      stderr.write(`supply-chain: unknown flag: ${a}\n`);
      exit(2);
    } else positional.push(a);
  }
  const cwd = env.INIT_CWD ?? env.PWD ?? '.';
  const target = resolve(positional[0] ?? cwd);
  return { mode, target, format };
}

// Pick the stdout format. CI env-var sinks always use markdown; for stdout,
// `text` is the default when we're attached to a terminal so that the user
// sees a readable report rather than raw `<details>` blocks. `--format` forces.
function resolveStdoutFormat(requested: Format | 'auto'): Format {
  if (requested !== 'auto') return requested;
  return stdout.isTTY ? 'text' : 'markdown';
}

function checksForMode(mode: Mode): { checks: Check[]; source: ReportPayload['source'] } {
  if (mode === 'static-only') return { checks: STATIC_CHECKS, source: 'static' };
  if (mode === 'audit-only') return { checks: AUDIT_CHECKS, source: 'audit' };
  // "all" means a one-shot local run; for JSON-output purposes it's labelled
  // as "static" (the renderer doesn't care). The CI never sends "all" through
  // the JSON path because the two CI jobs always pass an explicit mode.
  return { checks: ALL_CHECKS, source: 'static' };
}

async function main(): Promise<void> {
  const { mode, target, format } = parseArgs(argv.slice(2));
  const { checks, source } = checksForMode(mode);

  stderr.write(`supply-chain: checking ${target} (${mode})\n`);

  const onProgress = makeProgressCallback(stderr);
  const result = await runChecks(target, checks, onProgress);

  if (result.rootCount === 0) {
    stdout.write('No package.json found; supply-chain checks skipped.\n');
    return;
  }

  const reportInput = {
    ran: result.ran,
    findings: result.active,
    suppressed: result.suppressed,
    runUrl: env.GITHUB_RUN_URL ?? buildRunUrl(),
  };

  // CI sinks always receive markdown — GitHub renders it.
  const findingsOut = env.SUPPLY_CHAIN_FINDINGS_OUT;
  if (findingsOut) {
    await writePayload(findingsOut, {
      source,
      ran: result.ran,
      findings: result.active,
      suppressed: result.suppressed,
    });
  }

  const summaryFile = env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    await writeFile(summaryFile, renderMarkdown(reportInput) + '\n', { flag: 'a' });
  }

  // Local case (no env-driven sinks): write to stdout, picking the format
  // automatically based on whether stdout is a TTY (or honouring --format=).
  if (!findingsOut && !summaryFile) {
    const fmt = resolveStdoutFormat(format);
    const body = fmt === 'text' ? renderText(reportInput) : renderMarkdown(reportInput);
    stdout.write(body + '\n');
  }

  const blocking = result.active.filter((f) => f.severity === 'blocking');
  if (blocking.length > 0) exit(1);
}

main().catch((err) => {
  stderr.write(`supply-chain: unexpected error: ${(err as Error).stack ?? err}\n`);
  exit(2);
});
