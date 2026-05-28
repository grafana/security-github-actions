// Go-module walker. Mirrors the JS walker in shape: discover every `go.mod`,
// classify each as a workspace root or workspace member (via `go.work`),
// return the roots. Independent code path from walk-js.ts so neither
// ecosystem can break the other.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import type { GoRoot } from '../types.ts';

// Directories never descended into.
const SKIP_DIRS = new Set([
  '.git',
  'vendor', // Go vendored deps — many nested go.mod inside that aren't roots
  'testdata',
  'node_modules', // some polyglot repos
  'dist',
  'build',
  'out',
  '.cache',
]);

async function readIgnoreFile(repoRoot: string): Promise<string[]> {
  const p = join(repoRoot, '.supply-chain-check-ignore');
  if (!existsSync(p)) return [];
  const text = await readFile(p, 'utf8');
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter((l) => l.length > 0);
}

type ParsedGoMod = {
  goVersion: string | null;
  goToolchain: string | null;
  hasRequires: boolean;
};

export async function discoverGoRoots(repoRoot: string): Promise<GoRoot[]> {
  const ignorePrefixes = await readIgnoreFile(repoRoot);
  const modPaths = (await findGoMods(repoRoot)).filter(
    (p) => !ignorePrefixes.some((prefix) => p === prefix || p.startsWith(prefix + posix.sep)),
  );

  if (modPaths.length === 0) return [];

  // Build the set of workspace-member directories from any `go.work` files.
  // A go.mod whose directory matches a `use` entry is a member.
  const workspaceMembership = await buildWorkspaceMembership(repoRoot, modPaths);

  const roots: GoRoot[] = [];
  for (const modPath of modPaths) {
    if (workspaceMembership.memberOf.has(modPath)) continue;
    const dir = dirname(modPath) === '.' ? '.' : dirname(modPath);
    const parsed = await parseGoMod(join(repoRoot, modPath));
    roots.push({
      ecosystem: 'go',
      path: dir,
      goVersion: parsed.goVersion,
      goToolchain: parsed.goToolchain,
      gosumPresent: existsSync(join(repoRoot, dir, 'go.sum')),
      hasRequires: parsed.hasRequires,
      workspaceMembers: [...(workspaceMembership.claimedBy.get(modPath) ?? [])]
        .map((m) => (dirname(m) === '.' ? '.' : dirname(m)))
        .sort(),
    });
  }
  roots.sort((a, b) => a.path.localeCompare(b.path));
  return roots;
}

async function findGoMods(repoRoot: string): Promise<string[]> {
  const out: string[] = [];
  await walkDir(repoRoot, '.', out);
  out.sort();
  return out;
}

async function walkDir(repoRoot: string, relDir: string, out: string[]): Promise<void> {
  const absDir = join(repoRoot, relDir);
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const next = relDir === '.' ? entry.name : `${relDir}${posix.sep}${entry.name}`;
      await walkDir(repoRoot, next, out);
    } else if (entry.isFile() && entry.name === 'go.mod') {
      const relPath = relDir === '.' ? 'go.mod' : `${relDir}${posix.sep}go.mod`;
      out.push(relPath);
    }
  }
}

// go.mod is line-oriented and small; we don't need a full parser. We
// extract the three signals we care about: `go 1.X.Y`, `toolchain go1.X.Y`,
// and whether any `require` statement exists.
async function parseGoMod(absPath: string): Promise<ParsedGoMod> {
  let text: string;
  try {
    text = await readFile(absPath, 'utf8');
  } catch {
    return { goVersion: null, goToolchain: null, hasRequires: false };
  }
  let goVersion: string | null = null;
  let goToolchain: string | null = null;
  let hasRequires = false;
  let inRequireBlock = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (line.length === 0) continue;

    // `go 1.22.0` — top-level directive (rarely appears inside a block).
    const goMatch = /^go\s+(\d+\.\d+(?:\.\d+)?)\s*$/.exec(line);
    if (goMatch) {
      goVersion = goMatch[1]!;
      continue;
    }

    // `toolchain go1.22.0`
    const toolchainMatch = /^toolchain\s+go(\d+\.\d+(?:\.\d+)?)\s*$/.exec(line);
    if (toolchainMatch) {
      goToolchain = toolchainMatch[1]!;
      continue;
    }

    // Require directives: either `require <module> <version>` on a single
    // line, or a `require (` block containing multiple entries.
    if (/^require\s+\(/.test(line)) {
      inRequireBlock = true;
      // `require (` alone on a line doesn't add an entry yet
      const after = line.replace(/^require\s+\(/, '').trim();
      if (after.length > 0 && after !== ')') hasRequires = true;
      continue;
    }
    if (inRequireBlock) {
      if (line === ')') {
        inRequireBlock = false;
        continue;
      }
      // Any non-`)` line inside `require (...)` is a module/version pair
      if (line.length > 0) hasRequires = true;
      continue;
    }
    if (/^require\s+\S/.test(line)) {
      hasRequires = true;
      continue;
    }
  }
  return { goVersion, goToolchain, hasRequires };
}

// Read every `go.work` file in the tree, expand `use ./dir` directives, and
// build a map from "module path" → "the go.work that claims it". A go.mod
// claimed by any `go.work` is a workspace member, not a root.
async function buildWorkspaceMembership(
  repoRoot: string,
  modPaths: string[],
): Promise<{ memberOf: Map<string, string>; claimedBy: Map<string, Set<string>> }> {
  // Find go.work files via a directory walk (separate from go.mod walk so
  // we don't need to bolt onto the existing loop).
  const workPaths: string[] = [];
  await walkDirFor(repoRoot, '.', 'go.work', workPaths);

  const memberOf = new Map<string, string>(); // mod path -> work path (the claimer)
  const claimedBy = new Map<string, Set<string>>(); // work path -> set of mod paths

  for (const workPath of workPaths) {
    const workDir = dirname(workPath) === '.' ? '.' : dirname(workPath);
    const dirs = await parseGoWorkUseDirs(join(repoRoot, workPath));
    for (const useDir of dirs) {
      // Resolve `useDir` (which is relative to the go.work file) to a
      // repo-relative module path.
      const resolvedDir = workDir === '.' ? useDir : `${workDir}${posix.sep}${useDir}`;
      const candidateModPath = resolvedDir === '.' ? 'go.mod' : `${resolvedDir}${posix.sep}go.mod`;
      if (!modPaths.includes(candidateModPath)) continue;
      // Nearest-claimer wins, matching the JS walker's policy.
      const existing = memberOf.get(candidateModPath);
      if (existing === undefined || workPath.length > existing.length) {
        memberOf.set(candidateModPath, workPath);
      }
      let set = claimedBy.get(workPath);
      if (set === undefined) {
        set = new Set();
        claimedBy.set(workPath, set);
      }
      set.add(candidateModPath);
    }
  }
  return { memberOf, claimedBy };
}

// Walk subtree collecting files matching exactly `filename`. SKIP_DIRS apply.
async function walkDirFor(
  repoRoot: string,
  relDir: string,
  filename: string,
  out: string[],
): Promise<void> {
  const absDir = join(repoRoot, relDir);
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const next = relDir === '.' ? entry.name : `${relDir}${posix.sep}${entry.name}`;
      await walkDirFor(repoRoot, next, filename, out);
    } else if (entry.isFile() && entry.name === filename) {
      const relPath = relDir === '.' ? filename : `${relDir}${posix.sep}${filename}`;
      out.push(relPath);
    }
  }
}

// Extract `use ./dir` (or `use dir`) entries from go.work. Handles both
// the single-line form and the block form:
//   use ./module-a
//   use (
//     ./module-a
//     ./module-b
//   )
async function parseGoWorkUseDirs(absPath: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(absPath, 'utf8');
  } catch {
    return [];
  }
  const out: string[] = [];
  let inBlock = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (line.length === 0) continue;
    if (/^use\s+\(/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line === ')') {
        inBlock = false;
        continue;
      }
      out.push(normaliseUseDir(line));
      continue;
    }
    const m = /^use\s+(\S.*)$/.exec(line);
    if (m) out.push(normaliseUseDir(m[1]!));
  }
  return out;
}

function normaliseUseDir(dir: string): string {
  // Strip leading `./`; `use ./apps/foo` and `use apps/foo` both target the
  // same dir.
  return dir.replace(/^\.\//, '').replace(/\/+$/, '');
}

// Re-exports for unit tests.
export const __test = { parseGoMod, parseGoWorkUseDirs };
