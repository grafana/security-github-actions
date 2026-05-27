// Terminal-friendly rendering of a ReportInput. Used when running locally in
// a terminal (markdown's `<details>` blocks and `[Docs](...)` link syntax
// render as literal noise in a TTY).
//
// Colors are produced via node:util's `styleText`, which automatically
// respects `NO_COLOR`, `FORCE_COLOR`, and the stream's TTY-ness — we don't
// need a custom "should I emit ANSI" detector. Pass `useColor: false` for
// fully plain output (e.g. piping to a file).

import { styleText } from 'node:util';
import type { ReportInput } from './report.ts';
import type { Finding, CheckId } from './types.ts';

export function renderText(input: ReportInput, opts: { useColor?: boolean } = {}): string {
  // styleText resolves color on its own; useColor: false forces plain output
  // regardless of stream state (handy for snapshot tests).
  const c = palette(opts.useColor);

  const blocking = input.findings.filter((f) => f.severity === 'blocking');
  const advisory = input.findings.filter((f) => f.severity === 'advisory');
  const passingIds = new Set<CheckId>(input.ran);
  for (const f of input.findings) passingIds.delete(f.check_id);
  for (const f of input.suppressed) passingIds.delete(f.check_id);

  const lines: string[] = [];

  // Top-line status.
  if (blocking.length === 0) {
    lines.push(
      c.green('✓ Supply-chain checks passed') +
        c.dim(` (${advisory.length} advisory, ${input.suppressed.length} suppressed)`),
    );
  } else {
    lines.push(
      c.red(`✗ ${blocking.length} blocking`) +
        c.dim(`, ${advisory.length} advisory, ${input.suppressed.length} suppressed`),
    );
  }
  lines.push('');

  if (blocking.length > 0) {
    lines.push(c.red(c.bold(`── Blocking violations (${blocking.length}) ──`)));
    lines.push(...renderFindings(blocking, c, 'blocking'));
    lines.push('');
  }
  if (advisory.length > 0) {
    lines.push(c.yellow(c.bold(`── Advisory findings (${advisory.length}) ──`)));
    lines.push(...renderFindings(advisory, c, 'advisory'));
    lines.push('');
  }
  if (input.suppressed.length > 0) {
    lines.push(c.dim(c.bold(`── Suppressed (${input.suppressed.length}) ──`)));
    lines.push(...renderFindings(input.suppressed, c, 'suppressed'));
    lines.push('');
  }
  if (passingIds.size > 0) {
    lines.push(c.green(c.bold(`── Passing checks (${passingIds.size}) ──`)));
    const ordered = input.ran.filter((id) => passingIds.has(id));
    // Pack the passing list onto as few lines as possible; far more compact
    // than the markdown's vertical bullet list.
    const items = ordered.map((id) => c.green('✓ ') + id);
    for (const line of wrap(items, 90, '  ', '  ')) lines.push(line);
    lines.push('');
  }

  lines.push(c.dim(`Run: ${input.runUrl}`));
  return lines.join('\n');
}

function renderFindings(
  findings: Finding[],
  c: Palette,
  kind: 'blocking' | 'advisory' | 'suppressed',
): string[] {
  const byRoot = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byRoot.get(f.root) ?? [];
    list.push(f);
    byRoot.set(f.root, list);
  }
  const out: string[] = [];
  const marker = kind === 'blocking' ? c.red('✗') : kind === 'advisory' ? c.yellow('⚠') : c.dim('•');
  for (const [root, group] of byRoot) {
    out.push('');
    out.push('  ' + c.bold(root === '.' ? '(repo root)' : root));
    for (const f of group) {
      out.push(`    ${marker} ${f.title}`);
      out.push(`        ${c.dim(f.detail)}`);
      out.push(`        ${c.green('→')} ${f.fix}`);
      out.push(`        ${c.dim(f.check_id)}`);
    }
  }
  return out;
}

// Pack short items onto lines no wider than `width`. Used for the
// "Passing checks" compact list. Width is approximate — ANSI escapes inflate
// the string length without visible width — so we use a conservative
// per-item budget that ignores the escapes.
function wrap(items: string[], width: number, firstIndent: string, contIndent: string): string[] {
  if (items.length === 0) return [];
  const out: string[] = [];
  let current = firstIndent + items[0]!;
  let visibleLen = stripAnsi(current).length;
  for (let i = 1; i < items.length; i++) {
    const item = items[i]!;
    const itemLen = stripAnsi(item).length;
    if (visibleLen + 2 + itemLen > width) {
      out.push(current);
      current = contIndent + item;
      visibleLen = stripAnsi(current).length;
    } else {
      current += '  ' + item;
      visibleLen += 2 + itemLen;
    }
  }
  out.push(current);
  return out;
}

function stripAnsi(s: string): string {
  // We control which escapes we emit (only styleText), so a simple regex
  // covering SGR sequences is enough.
  return s.replace(/\[[0-9;]*m/g, '');
}

type Palette = {
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  bold: (s: string) => string;
  dim: (s: string) => string;
};

function palette(useColor: boolean | undefined): Palette {
  // Explicit useColor=false means "no color"; explicit true means "force
  // color"; undefined means "let styleText decide based on the stream".
  if (useColor === false) {
    return {
      red: (s) => s,
      green: (s) => s,
      yellow: (s) => s,
      bold: (s) => s,
      dim: (s) => s,
    };
  }
  const opts = useColor === true ? { validateStream: false } : undefined;
  return {
    red: (s) => styleText('red', s, opts),
    green: (s) => styleText('green', s, opts),
    yellow: (s) => styleText('yellow', s, opts),
    bold: (s) => styleText('bold', s, opts),
    dim: (s) => styleText('dim', s, opts),
  };
}
