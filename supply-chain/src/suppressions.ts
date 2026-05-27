import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, CheckId } from './types.ts';

// One entry in `.github/supply-chain.yml`:
//   suppressions:
//     - check_id: lockfile-committed
//       reason: "Upstream mirror"
//       expires: 2026-12-31   # optional
export type SuppressionEntry = {
  check_id: CheckId;
  reason: string;
  expires?: string;
};

export type SuppressionLoadError = {
  // Repo-relative path of the file the error was raised against.
  file: string;
  line?: number;
  message: string;
};

export type SuppressionLoadResult = {
  entries: SuppressionEntry[];
  // Errors are surfaced as findings so the report user sees the problem
  // rather than silently swallowing a malformed suppression file.
  errors: SuppressionLoadError[];
};

const SUPPRESSION_FILE = '.github/supply-chain.yml';

// Parses .github/supply-chain.yml into entries. A malformed file produces
// errors (returned alongside any entries we did manage to parse) rather than
// throwing — we want the workflow to keep running and report the problem in
// the comment.
//
// Recognised shape:
//   suppressions:
//     - check_id: <string>
//       reason: <string>
//       expires: <ISO date>   # optional
//
// Anything else is ignored. This is *not* a general-purpose YAML parser;
// it covers exactly the documented shape and rejects everything else with
// a clear error.
export async function loadSuppressions(repoRoot: string): Promise<SuppressionLoadResult> {
  const path = join(repoRoot, SUPPRESSION_FILE);
  if (!existsSync(path)) return { entries: [], errors: [] };
  const text = await readFile(path, 'utf8');
  return parseSuppressionsText(text, SUPPRESSION_FILE);
}

export function parseSuppressionsText(text: string, file: string): SuppressionLoadResult {
  const lines = text.split(/\r?\n/);
  const entries: SuppressionEntry[] = [];
  const errors: SuppressionLoadError[] = [];

  let inSuppressions = false;
  let current: Partial<SuppressionEntry> | null = null;
  let currentStartLine = 0;

  const finalize = (): void => {
    if (current === null) return;
    if (typeof current.check_id !== 'string' || current.check_id.length === 0) {
      errors.push({ file, line: currentStartLine, message: 'suppression entry missing check_id' });
    } else if (typeof current.reason !== 'string' || current.reason.length === 0) {
      errors.push({ file, line: currentStartLine, message: `suppression for "${current.check_id}" missing reason` });
    } else {
      entries.push(current as SuppressionEntry);
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const stripped = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (stripped.length === 0) continue;

    if (/^suppressions\s*:/.test(stripped)) {
      inSuppressions = true;
      continue;
    }
    if (!inSuppressions) continue;

    // Top-level non-indented key ends the suppressions block.
    if (!/^\s/.test(stripped)) {
      finalize();
      inSuppressions = false;
      continue;
    }

    // New list item — `- key: value` starts a new entry.
    const itemStart = /^\s*-\s+(\w+)\s*:\s*(.*)$/.exec(stripped);
    if (itemStart) {
      finalize();
      current = {};
      currentStartLine = i + 1;
      assignField(current, itemStart[1]!, itemStart[2]!, file, i + 1, errors);
      continue;
    }

    // Continuation key — `  key: value` inside the current entry.
    const kv = /^\s+(\w+)\s*:\s*(.*)$/.exec(stripped);
    if (kv && current !== null) {
      assignField(current, kv[1]!, kv[2]!, file, i + 1, errors);
      continue;
    }

    errors.push({ file, line: i + 1, message: `unrecognised line: ${raw}` });
  }
  finalize();
  return { entries, errors };
}

function assignField(
  entry: Partial<SuppressionEntry>,
  key: string,
  value: string,
  file: string,
  line: number,
  errors: SuppressionLoadError[],
): void {
  const unquoted = unquote(value);
  switch (key) {
    case 'check_id':
      entry.check_id = unquoted;
      return;
    case 'reason':
      entry.reason = unquoted;
      return;
    case 'expires':
      entry.expires = unquoted;
      return;
    default:
      errors.push({ file, line, message: `unknown suppression field: ${key}` });
  }
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// Partition findings into (active, suppressed) based on the loaded entries
// and the current date. An entry with an `expires:` date in the past is
// treated as if it didn't exist (the finding remains active). This is the
// "self-expiring suppression" property — see ADR-0005.
export function partitionBySuppression(
  findings: Finding[],
  entries: SuppressionEntry[],
  now: Date = new Date(),
): { active: Finding[]; suppressed: Finding[] } {
  const liveIds = new Set<CheckId>();
  for (const e of entries) {
    if (e.expires !== undefined && isExpired(e.expires, now)) continue;
    liveIds.add(e.check_id);
  }
  const active: Finding[] = [];
  const suppressed: Finding[] = [];
  for (const f of findings) {
    if (liveIds.has(f.check_id)) suppressed.push(f);
    else active.push(f);
  }
  return { active, suppressed };
}

function isExpired(expires: string, now: Date): boolean {
  const t = Date.parse(expires);
  if (Number.isNaN(t)) return false; // invalid date => treat as no expiry
  return t < now.getTime();
}
