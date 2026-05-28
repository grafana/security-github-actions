// Render CLI. Reads N JSON payloads produced by the check CLI, merges
// them into a single ReportInput, and writes the resulting markdown to:
//   - GITHUB_STEP_SUMMARY (always, if set)
//   - SUPPLY_CHAIN_COMMENT_OUT (always, if set) — feeds post-comment.ts
//
// PR1 only passes a single `static` payload; a follow-up PR adds an
// `audit` payload that the renderer merges into the same comment.
//
// Missing input files are tolerated: if one of the upstream jobs failed
// to produce its JSON, the renderer still emits a useful comment from
// whatever it has.
//
// Exit code is 0 even if some inputs are missing. The render job is
// purely cosmetic — it should never fail the workflow. The static job's
// exit code is what gates merge.

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { argv, env, exit, stderr, stdout } from 'node:process';

import { readPayload, mergePayloads } from './io.ts';
import { renderMarkdown } from './report.ts';
import { buildRunUrl } from './engine.ts';

async function main(): Promise<void> {
  const inputs = argv.slice(2);
  if (inputs.length === 0) {
    stderr.write('render-cli: no input payloads given\n');
    exit(2);
  }

  const payloads = [];
  for (const path of inputs) {
    if (!existsSync(path)) {
      stderr.write(`render-cli: input missing, skipping: ${path}\n`);
      continue;
    }
    try {
      payloads.push(await readPayload(path));
    } catch (err) {
      stderr.write(`render-cli: failed to read ${path}: ${(err as Error).message}\n`);
    }
  }

  if (payloads.length === 0) {
    stderr.write('render-cli: no usable input payloads — emitting empty report.\n');
  }

  const merged = mergePayloads(payloads);
  const markdown = renderMarkdown({
    ran: merged.ranIds,
    findings: merged.findings,
    suppressed: merged.suppressed,
    runUrl: env.GITHUB_RUN_URL ?? buildRunUrl(),
  });

  const summaryFile = env.GITHUB_STEP_SUMMARY;
  if (summaryFile) await writeFile(summaryFile, markdown + '\n', { flag: 'a' });

  const commentOut = env.SUPPLY_CHAIN_COMMENT_OUT;
  if (commentOut) await writeFile(commentOut, markdown + '\n');

  // Always also write to stdout so the job's logs show the rendered comment
  // body. Helpful for debugging without downloading the artifact.
  stdout.write(markdown + '\n');
}

main().catch((err) => {
  stderr.write(`render-cli: ${(err as Error).stack ?? err}\n`);
  exit(0);
});
