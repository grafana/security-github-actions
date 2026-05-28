// Progress rendering for the supply-chain CLI.
//
// - **TTY** (local terminal): a single in-place line with an animated braille
//   spinner that ticks every 80ms. As each check starts, the line updates;
//   when a slow check (≥1s) finishes, the line is "promoted" to a permanent
//   ✓ line, scrolling above the still-active spinner. Colors via
//   node:util#styleText, which auto-respects NO_COLOR / FORCE_COLOR.
//
// - **non-TTY** (CI, piped, redirected): static one-line-per-event log. No
//   ANSI codes, no spinner, no in-place updates — the kind of output that
//   reads well in `actions/upload-artifact` logs.
//
// All output goes to stderr. The rendered report on stdout is undisturbed
// so `npm run check > report.md` still produces clean markdown.

import { styleText } from 'node:util';
import type { ProgressCallback, ProgressEvent } from './engine.ts';

const SLOW_MS = 1000;
const SPINNER_INTERVAL_MS = 80;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
// ANSI: \r = carriage return, \x1b[2K = clear entire line.
const CLEAR_LINE = '\r\x1b[2K';

export function makeProgressCallback(stream: NodeJS.WriteStream): ProgressCallback {
  const isTty = stream.isTTY === true;
  if (isTty) return ttyCallback(stream);
  return staticCallback(stream);
}

function ttyCallback(stream: NodeJS.WriteStream): ProgressCallback {
  // The "live" line is whatever the spinner is currently animating. When
  // empty, the spinner is paused — nothing's actively running.
  let liveLine = '';
  let frame = 0;
  let interval: NodeJS.Timeout | null = null;

  const c = palette();

  const renderLive = (): void => {
    if (liveLine.length === 0) return;
    const spinner = c.cyan(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!);
    stream.write(CLEAR_LINE);
    stream.write(`${spinner} ${liveLine}`);
    frame += 1;
  };

  const startSpinner = (): void => {
    if (interval !== null) return;
    renderLive(); // immediate first frame so there's no delay before something appears
    interval = setInterval(renderLive, SPINNER_INTERVAL_MS);
    // unref so the timer never holds the process open past the report.
    interval.unref();
  };

  const stopSpinner = (): void => {
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  };

  return (e: ProgressEvent) => {
    switch (e.kind) {
      case 'discovery-start':
        liveLine = c.dim('discovering roots…');
        startSpinner();
        return;

      case 'discovery-end': {
        stopSpinner();
        stream.write(CLEAR_LINE);
        const summary = describeDiscovery(e.jsRoots);
        stream.write(`${c.green('✓')} ${summary} ${c.dim(`(${e.durationMs}ms)`)}\n`);
        liveLine = '';
        return;
      }

      case 'check-start':
        liveLine = `${c.dim(`[${e.index}/${e.total}]`)} ${c.bold(e.checkId)} on ${c.cyan(describeRoot(e.root))}…`;
        startSpinner();
        return;

      case 'check-end':
        if (e.durationMs >= SLOW_MS) {
          // Promote slow check to a permanent line above the spinner.
          stopSpinner();
          stream.write(CLEAR_LINE);
          stream.write(
            `${c.green('✓')} ${c.bold(e.checkId)} on ${c.cyan(describeRoot(e.root))} ${c.dim(`(${formatDuration(e.durationMs)})`)}\n`,
          );
          liveLine = '';
          // Next check-start will restart the spinner.
        }
        return;

      case 'done':
        stopSpinner();
        if (liveLine.length > 0) {
          stream.write(CLEAR_LINE);
          liveLine = '';
        }
        return;
    }
  };
}

function staticCallback(stream: NodeJS.WriteStream): ProgressCallback {
  return (e: ProgressEvent) => {
    switch (e.kind) {
      case 'discovery-end':
        stream.write(`  ${describeDiscovery(e.jsRoots)} (${e.durationMs}ms)\n`);
        return;
      case 'check-start':
        stream.write(`  [${e.index}/${e.total}] ${e.checkId} on ${describeRoot(e.root)}\n`);
        return;
      case 'check-end':
        if (e.durationMs >= SLOW_MS) {
          stream.write(`    ↳ ${e.checkId} took ${formatDuration(e.durationMs)}\n`);
        }
        return;
      case 'discovery-start':
      case 'done':
        return;
    }
  };
}

type Palette = {
  bold: (s: string) => string;
  dim: (s: string) => string;
  green: (s: string) => string;
  cyan: (s: string) => string;
};

function palette(): Palette {
  // styleText auto-detects whether the stream supports colors (respects
  // NO_COLOR / FORCE_COLOR). We don't pass a stream explicitly so it
  // defaults to checking process.stdout — close enough; in practice both
  // stdout and stderr share TTY status when one of them is a terminal.
  return {
    bold: (s) => styleText('bold', s),
    dim: (s) => styleText('dim', s),
    green: (s) => styleText('green', s),
    cyan: (s) => styleText('cyan', s),
  };
}

function describeDiscovery(jsRoots: number): string {
  if (jsRoots === 0) return 'no roots';
  return `${jsRoots} JS root${jsRoots === 1 ? '' : 's'}`;
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

export const __test = { describeDiscovery, describeRoot, formatDuration };
