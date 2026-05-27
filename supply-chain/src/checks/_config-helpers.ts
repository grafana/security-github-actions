// Helpers shared between the three "config file is correct" checks
// (`.npmrc`, `pnpm-workspace.yaml`, `.yarnrc.yml`). Not exported from the
// package's public surface; used only by sibling check modules.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Reads a config file if present, returning its text. Returns null if the
// file is absent. Errors (permission etc.) propagate — they are a real
// problem, not a "no config" signal.
export async function readConfigIfPresent(absPath: string): Promise<string | null> {
  if (!existsSync(absPath)) return null;
  return readFile(absPath, 'utf8');
}

// .npmrc / .yarnrc style: line-oriented `key=value` (npm) or `key: value`
// (yarn). We accept both separators because callers may not know which they're
// reading. Comments (`#` or `;` at line start) are stripped. Multiple
// occurrences keep the last one (npm semantics).
export function parseLineConfig(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s;#].*$/, '').trim();
    if (line.length === 0) continue;
    const eq = line.indexOf('=');
    const colon = line.indexOf(':');
    let sep = -1;
    if (eq !== -1 && (colon === -1 || eq < colon)) sep = eq;
    else if (colon !== -1) sep = colon;
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = stripQuotes(line.slice(sep + 1).trim());
    if (key.length > 0) out.set(key, value);
  }
  return out;
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// How to compare an actual config value against the required value.
// - `eq`        — strict string equality. For boolean/enum settings where the
//                 only "correct" value is the literal we specify
//                 (e.g. `ignore-scripts=true`, `strictDepBuilds: true`).
// - `min-int`   — actual must parse as an integer and be >= expected. For
//                 release-age gates: a HIGHER cooldown is MORE secure, so
//                 anything at or above the required floor is fine.
export type CompareMode = 'eq' | 'min-int';

// True when `actual` satisfies the requirement according to `mode`.
// For `min-int` a non-integer `actual` (e.g. `"true"`, garbage) fails.
export function valueMeetsRequirement(
  actual: string,
  expected: string,
  mode: CompareMode,
): boolean {
  if (mode === 'eq') return actual === expected;
  const a = Number.parseInt(actual, 10);
  const e = Number.parseInt(expected, 10);
  if (Number.isNaN(a) || Number.isNaN(e)) return false;
  return a >= e;
}
