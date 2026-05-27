import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Check, Finding, Root, RepoContext } from '../types.ts';

export const CHECK_ID = 'node-version-pinned';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/node-version-pinned.md';

// Minimum Node version per the hardening guide.
const MIN = { major: 24, minor: 5, patch: 0 };

// Signals checked in priority order. The first signal we find is the one we
// evaluate; subsequent signals are not double-checked. This matches developer
// expectation: whichever file the developer actually uses to drive `nvm` /
// `volta` / CI is the source of truth.
type Signal = 'engines.node' | '.nvmrc' | '.node-version' | 'volta.node';

export const check: Check = {
  id: CHECK_ID,
  severity: 'advisory',
  async run(root: Root, ctx: RepoContext): Promise<Finding[]> {
    const rootDir = root.path === '.' ? '.' : root.path;
    const found = await findFirstSignal(rootDir, ctx.repoRoot);
    if (found === null) {
      return [
        {
          check_id: CHECK_ID,
          severity: 'advisory',
          root: root.path,
          title: 'Node.js version not pinned',
          detail: `No engines.node, .nvmrc, .node-version, or volta.node found at ${rootDir === '.' ? 'the repo root' : rootDir}.`,
          fix: `Set \`engines.node\` to \`>=${formatV(MIN)}\` in package.json, or commit an \`.nvmrc\` file containing \`${formatV(MIN)}\`.`,
          doc_link: DOC_LINK,
        },
      ];
    }

    const minSupported = inferMinSupported(found.value);
    if (minSupported === null) {
      return [
        {
          check_id: CHECK_ID,
          severity: 'advisory',
          root: root.path,
          title: `Could not parse Node version from ${found.signal}`,
          detail: `Found "${found.value}" in ${found.signal}, but could not extract a minimum version.`,
          fix: `Use a concrete version (e.g. ${formatV(MIN)}) or a clear range (e.g. >=${formatV(MIN)}).`,
          doc_link: DOC_LINK,
        },
      ];
    }
    if (compareV(minSupported, MIN) < 0) {
      return [
        {
          check_id: CHECK_ID,
          severity: 'advisory',
          root: root.path,
          title: `Node ${formatV(minSupported)} is below recommended ${formatV(MIN)}`,
          detail: `${found.signal} resolves to a minimum-supported version of ${formatV(minSupported)}.`,
          fix: `Bump the version specifier so its minimum is at least ${formatV(MIN)}.`,
          doc_link: DOC_LINK,
        },
      ];
    }
    return [];
  },
};

type FoundSignal = { signal: Signal; value: string };

async function findFirstSignal(rootDir: string, repoRoot: string): Promise<FoundSignal | null> {
  const manifestPath = join(repoRoot, rootDir, 'package.json');
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        engines?: { node?: string };
        volta?: { node?: string };
      };
      if (typeof parsed.engines?.node === 'string' && parsed.engines.node.length > 0) {
        return { signal: 'engines.node', value: parsed.engines.node };
      }
      if (typeof parsed.volta?.node === 'string' && parsed.volta.node.length > 0) {
        return { signal: 'volta.node', value: parsed.volta.node };
      }
    } catch {
      // fall through to file-based signals
    }
  }
  for (const filename of ['.nvmrc', '.node-version'] as const) {
    const p = join(repoRoot, rootDir, filename);
    if (existsSync(p)) {
      const value = (await readFile(p, 'utf8')).trim();
      if (value.length > 0) {
        return { signal: filename, value };
      }
    }
  }
  return null;
}

type V = { major: number; minor: number; patch: number };

// Parses the minimum-supported version from a value. Handles concrete versions
// ("24.5.0", "v24.5.0"), simple ranges ((">=24.5.0", "^24.5.0"), and bare
// majors ("24"). Returns null if nothing recognisable can be extracted.
export function inferMinSupported(value: string): V | null {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2] ?? '0'),
    patch: Number(m[3] ?? '0'),
  };
}

function compareV(a: V, b: V): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function formatV(v: V): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}
