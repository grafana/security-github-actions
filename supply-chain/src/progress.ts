// Progress rendering for the supply-chain CLI. Two modes:
//
// - **TTY** (running locally in a terminal): updates a single line in place
//   with `\r`, so the user sees a single "currently running" indicator that
//   changes as checks complete. After `done`, the line is cleared so the
//   final report renders cleanly below.
//
// - **non-TTY** (running in CI, piped to a file, redirected): writes static
//   log lines on each check start. Slow checks (>1s) also log their
//   duration on completion. Fast checks are silent on completion to avoid
//   wallpaper.
//
// All output goes to stderr — the rendered report on stdout is undisturbed,
// so `npm run check > report.md` still produces clean markdown.

import type { ProgressCallback, ProgressEvent } from './engine.ts';

const SLOW_MS = 1000;
// ANSI: \r = carriage return, \x1b[2K = clear entire line, \x1b[1m / \x1b[0m
// = bold / reset. We intentionally don't use the full styleText machinery
// here — the progress line shouldn't pick up rich colors that compete with
// the final report.
const CLEAR_LINE = '\r\x1b[2K';

export function makeProgressCallback(stream: NodeJS.WriteStream): ProgressCallback {
  const isTty = stream.isTTY === true;
  if (isTty) return ttyCallback(stream);
  return staticCallback(stream);
}

function ttyCallback(stream: NodeJS.WriteStream): ProgressCallback {
  // We keep a single line on the terminal that gets overwritten. When a
  // slow check finishes, we briefly "promote" the line to a permanent log
  // (write a newline) and then start a fresh in-place line.
  let lastLine = '';

  const write = (line: string): void => {
    stream.write(CLEAR_LINE);
    stream.write(line);
    lastLine = line;
  };

  return (e: ProgressEvent) => {
    switch (e.kind) {
      case 'discovery-start':
        write('  discovering roots…');
        return;
      case 'discovery-end': {
        const summary = describeDiscovery(e.jsRoots, e.goRoots);
        write(`  ${summary} (${e.durationMs}ms)`);
        return;
      }
      case 'check-start':
        write(`  [${e.index}/${e.total}] ${e.checkId} on ${describeRoot(e.root)}…`);
        return;
      case 'check-end':
        if (e.durationMs >= SLOW_MS) {
          // Promote: write a permanent line, then leave the in-place line
          // empty until the next check-start fills it.
          stream.write(CLEAR_LINE);
          stream.write(`  ✓ ${e.checkId} on ${describeRoot(e.root)} (${formatDuration(e.durationMs)})\n`);
          lastLine = '';
        }
        return;
      case 'done':
        // Clear the in-place line so the final report renders cleanly.
        if (lastLine.length > 0) {
          stream.write(CLEAR_LINE);
          lastLine = '';
        }
        return;
    }
  };
}

function staticCallback(stream: NodeJS.WriteStream): ProgressCallback {
  return (e: ProgressEvent) => {
    switch (e.kind) {
      case 'discovery-end':
        stream.write(`  ${describeDiscovery(e.jsRoots, e.goRoots)} (${e.durationMs}ms)\n`);
        return;
      case 'check-start':
        stream.write(`  [${e.index}/${e.total}] ${e.checkId} on ${describeRoot(e.root)}\n`);
        return;
      case 'check-end':
        if (e.durationMs >= SLOW_MS) {
          stream.write(`    ↳ ${e.checkId} took ${formatDuration(e.durationMs)}\n`);
        }
        return;
      // discovery-start and done are noisy in CI logs; skip them.
      case 'discovery-start':
      case 'done':
        return;
    }
  };
}

function describeDiscovery(jsRoots: number, goRoots: number): string {
  const parts: string[] = [];
  if (jsRoots > 0) parts.push(`${jsRoots} JS root${jsRoots === 1 ? '' : 's'}`);
  if (goRoots > 0) parts.push(`${goRoots} Go root${goRoots === 1 ? '' : 's'}`);
  if (parts.length === 0) return 'no roots';
  return parts.join(', ');
}

function describeRoot(root: string): string {
  return root === '.' ? '(repo root)' : root;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

// Re-exported for tests.
export const __test = { describeDiscovery, describeRoot, formatDuration };
