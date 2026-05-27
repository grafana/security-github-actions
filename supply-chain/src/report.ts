import type { Finding, CheckId } from './types.ts';

// Marker used to find-and-update the sticky comment on subsequent runs.
// Changing the marker breaks history matching, so it is versioned.
export const STICKY_MARKER = '<!-- supply-chain-report-v1 -->';

export type ReportInput = {
  // Stable IDs of the checks that ran (across all sources). Used to render
  // the "Passing checks" section: ran minus emitted minus suppressed.
  ran: CheckId[];
  // Findings produced by the run, in whatever order checks emitted them.
  findings: Finding[];
  // Findings that matched a suppression entry (still reported, never silent).
  suppressed: Finding[];
  // Link to the workflow run that produced this report.
  runUrl: string;
};

export function renderMarkdown(input: ReportInput): string {
  const blocking = input.findings.filter((f) => f.severity === 'blocking');
  const advisory = input.findings.filter((f) => f.severity === 'advisory');
  const passingIds = new Set<CheckId>(input.ran);
  for (const f of input.findings) passingIds.delete(f.check_id);
  for (const f of input.suppressed) passingIds.delete(f.check_id);

  const status =
    blocking.length === 0
      ? `✅ Supply-chain checks passed (${advisory.length} advisory)`
      : `❌ ${blocking.length} blocking, ${advisory.length} advisory`;

  return [
    STICKY_MARKER,
    `## ${status}`,
    '',
    section('Blocking violations', blocking, blocking.length > 0),
    section('Advisory findings', advisory, true),
    section('Suppressed', input.suppressed, false),
    passingSection(input.ran, passingIds),
    '',
    `<sub>[workflow run](${input.runUrl})</sub>`,
  ].join('\n');
}

function section(title: string, findings: Finding[], expanded: boolean): string {
  if (findings.length === 0) return '';
  const open = expanded ? ' open' : '';
  const byRoot = groupBy(findings, (f) => f.root);
  const inner: string[] = [];
  for (const [root, group] of byRoot) {
    inner.push(`#### \`${root}\``);
    for (const f of group) {
      inner.push(
        `- **${f.title}** — ${f.detail}`,
        `  - Fix: ${f.fix}`,
        `  - [Docs](${f.doc_link}) · \`${f.check_id}\``,
      );
    }
  }
  return [
    `<details${open}><summary><strong>${title}</strong> (${findings.length})</summary>`,
    '',
    ...inner,
    '',
    '</details>',
  ].join('\n');
}

function passingSection(ran: CheckId[], passingIds: Set<CheckId>): string {
  if (passingIds.size === 0) return '';
  const ordered = ran.filter((id) => passingIds.has(id)).map((id) => `- ✅ \`${id}\``);
  return [
    `<details><summary><strong>Passing checks</strong> (${ordered.length})</summary>`,
    '',
    ...ordered,
    '',
    '</details>',
  ].join('\n');
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const existing = out.get(k);
    if (existing) existing.push(item);
    else out.set(k, [item]);
  }
  return out;
}
