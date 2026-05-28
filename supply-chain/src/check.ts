// The supply-chain CLI. Single entry point for both local use and CI.
//
// Usage:
//   node --experimental-strip-types src/check.ts [flags] [path]
//
// Flags:
//   --format=<f>   override the stdout format. `text` (terminal-friendly,
//                  default in a TTY), `markdown` (default when piped or in
//                  CI), or `html` (writes to file + auto-opens browser in
//                  TTY, streams to stdout when piped).
//   --no-html      skip writing the local HTML report (TTY only)
//   --no-open      write the HTML report but don't auto-open the browser
//
// Behaviour is driven by environment variables:
//   SUPPLY_CHAIN_FINDINGS_OUT — if set, write a JSON ReportPayload to this
//                               path (the CI contract; consumed by render-cli)
//   GITHUB_RUN_URL            — link used in the rendered report's footer
//
// Note: we do not write GITHUB_STEP_SUMMARY here. The render job
// (src/render-cli.ts) is the canonical step-summary writer for CI runs.
//
// Local default (TTY, no env sinks): full text report on stdout, HTML
// dropped to ~/.cache/supply-chain/, browser auto-opened. Use --no-html
// / --no-open to opt out.
//
// Path: positional argument; defaults to the current working directory.
// `cd supply-chain && npm run check` therefore checks the surrounding repo.
//
// Exit codes:
//   0 — no critical findings
//   1 — at least one critical finding
//   2 — unexpected error

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { argv, env, exit, platform, stdout, stderr } from 'node:process';
import { homedir } from 'node:os';
import { resolve, join, dirname } from 'node:path';

import { renderMarkdown } from './report.ts';
import { renderText } from './text-report.ts';
import { renderHtml } from './html-report.ts';
import { runChecks, buildRunUrl } from './engine.ts';
import { writePayload } from './io.ts';
import { makeProgressCallback } from './progress.ts';
import { ALL_CHECKS } from './registry.ts';
import type { ReportInput } from './report.ts';

type Format = 'text' | 'markdown' | 'html';
type Args = {
  target: string;
  format: Format | 'auto';
  noHtml: boolean;
  noOpen: boolean;
};

function parseArgs(raw: string[]): Args {
  let format: Format | 'auto' = 'auto';
  let noHtml = false;
  let noOpen = false;
  const positional: string[] = [];
  for (const a of raw) {
    if (a === '--no-html') noHtml = true;
    else if (a === '--no-open') noOpen = true;
    else if (a === '--format=text' || a === '--format=markdown' || a === '--format=html') {
      format = a.split('=')[1] as Format;
    } else if (a.startsWith('--')) {
      stderr.write(`supply-chain: unknown flag: ${a}\n`);
      exit(2);
    } else positional.push(a);
  }
  const cwd = env.INIT_CWD ?? env.PWD ?? '.';
  const target = resolve(positional[0] ?? cwd);
  return { target, format, noHtml, noOpen };
}

function resolveStdoutFormat(requested: Format | 'auto'): Format {
  if (requested !== 'auto') return requested;
  return stdout.isTTY ? 'text' : 'markdown';
}

function htmlReportPath(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return join(homedir(), '.cache', 'supply-chain', `report-${ts}.html`);
}

// Best-effort browser-open. Detached + stdio:'ignore' so the child outlives
// our process and doesn't pollute the terminal. Any failure is silent — the
// user still has the URL printed on stderr.
function openInBrowser(path: string): void {
  const cmd =
    platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(cmd, [path], { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      /* swallow — auto-open is a convenience, not a contract */
    });
    child.unref();
  } catch {
    /* same */
  }
}

async function writeHtmlReport(reportInput: ReportInput): Promise<string> {
  const path = htmlReportPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderHtml(reportInput));
  return path;
}

async function main(): Promise<void> {
  const { target, format, noHtml, noOpen } = parseArgs(argv.slice(2));

  stderr.write(`supply-chain: checking ${target}\n`);

  const onProgress = makeProgressCallback(stderr);
  const result = await runChecks(target, ALL_CHECKS, onProgress);

  if (result.rootCount === 0) {
    stdout.write('No package.json found; supply-chain checks skipped.\n');
    return;
  }

  const reportInput: ReportInput = {
    ran: result.ran,
    findings: result.active,
    suppressed: result.suppressed,
    runUrl: env.GITHUB_RUN_URL ?? buildRunUrl(),
  };

  // CI sink: JSON payload that the render job downloads and renders.
  const findingsOut = env.SUPPLY_CHAIN_FINDINGS_OUT;
  if (findingsOut) {
    await writePayload(findingsOut, {
      source: 'static',
      ran: result.ran,
      findings: result.active,
      suppressed: result.suppressed,
    });
  } else {
    // Local flow (no CI sink).
    const fmt = resolveStdoutFormat(format);

    // 1. Render to stdout per the chosen format. `--format=html` in a TTY
    //    is the one case we don't write text to the terminal — the HTML
    //    file IS the report; spewing HTML source to the terminal would be
    //    silly. Piped html still streams to stdout (so `> report.html` works).
    if (fmt === 'html' && !stdout.isTTY) {
      stdout.write(renderHtml(reportInput));
    } else if (fmt !== 'html') {
      const body = fmt === 'text' ? renderText(reportInput) : renderMarkdown(reportInput);
      stdout.write(body + '\n');
    }

    // 2. In a TTY, ALSO drop the HTML file and (by default) auto-open it.
    //    Always on regardless of format unless the user opted out — even
    //    when stdout already showed the text report. The browser view is
    //    nicer for sharing / scrolling / interactivity.
    if (stdout.isTTY && !noHtml) {
      const path = await writeHtmlReport(reportInput);
      stderr.write(`\n📄 Report: file://${path}\n`);
      if (!noOpen) openInBrowser(path);
    }
  }

  const critical = result.active.filter((f) => f.severity === 'critical');
  if (critical.length > 0) exit(1);
}

main().catch((err) => {
  stderr.write(`supply-chain: unexpected error: ${(err as Error).stack ?? err}\n`);
  exit(2);
});
