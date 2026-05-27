// Shared JSON I/O format between the three CLIs (static, audit, render).
//
// The workflow uses two parallel "check" jobs (static + audit) and one
// "render" job that aggregates their output and posts the single sticky
// comment. JSON, not markdown, is what flows between jobs — markdown is
// only produced at the very end so the renderer can group findings by
// section consistently across both sources.

import { readFile, writeFile } from 'node:fs/promises';
import type { Finding, CheckId } from './types.ts';

export type ReportPayload = {
  // Stable identifiers of the checks that ran. The renderer uses this to
  // populate the "Passing checks" section (= ran minus emitted minus
  // suppressed). Checks themselves are not serialisable (they hold
  // functions), so we serialise the IDs alone.
  ran: CheckId[];
  findings: Finding[];
  suppressed: Finding[];
  // Free-form provenance string; the renderer doesn't depend on this but
  // it helps debugging when looking at the raw JSON.
  source: 'static' | 'audit';
};

export async function writePayload(path: string, payload: ReportPayload): Promise<void> {
  await writeFile(path, JSON.stringify(payload, null, 2) + '\n');
}

export async function readPayload(path: string): Promise<ReportPayload> {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text) as ReportPayload;
}

// Combine multiple payloads into a single ReportInput-shaped object the
// renderer can consume. The merge is the union of IDs and the concatenation
// of findings.
export function mergePayloads(payloads: ReportPayload[]): {
  ranIds: CheckId[];
  findings: Finding[];
  suppressed: Finding[];
} {
  const ranIds = uniqueOrdered(payloads.flatMap((p) => p.ran));
  const findings = payloads.flatMap((p) => p.findings);
  const suppressed = payloads.flatMap((p) => p.suppressed);
  return { ranIds, findings, suppressed };
}

function uniqueOrdered<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
