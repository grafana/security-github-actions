import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import type { Root, PackageManager } from './types.ts';

// Directory names we never descend into. Adding to this list is cheap; the cost
// of accidentally walking into them is real (node_modules in particular can be
// tens of thousands of nested package.json files).
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.yarn',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  'coverage',
]);

// Path-prefix patterns from `.supply-chain-check-ignore` at the repo root.
// Each line is a directory prefix relative to the repo root (e.g.
// `tests/fixtures`). Any manifest path starting with one of these prefixes is
// excluded from the walk. Glob characters are not interpreted — this is
// intentionally dumb prefix matching, which covers the dominant use case (a
// single fixtures directory).
async function readIgnoreFile(repoRoot: string): Promise<string[]> {
  const p = join(repoRoot, '.supply-chain-check-ignore');
  if (!existsSync(p)) return [];
  const text = await readFile(p, 'utf8');
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter((l) => l.length > 0);
}

type RawManifest = {
  packageManager?: string;
  workspaces?: string[] | { packages?: string[] };
};

export async function discoverRoots(repoRoot: string): Promise<Root[]> {
  const ignorePrefixes = await readIgnoreFile(repoRoot);
  const manifestPaths = (await findManifests(repoRoot)).filter(
    (p) => !ignorePrefixes.some((prefix) => p === prefix || p.startsWith(prefix + posix.sep)),
  );

  const parsed = new Map<string, RawManifest>();
  for (const p of manifestPaths) {
    parsed.set(p, await readJson(join(repoRoot, p)));
  }

  // For each manifest, resolve its declared workspace globs (npm/yarn syntax in
  // package.json; pnpm syntax in pnpm-workspace.yaml) and match them against
  // the manifests we discovered. Produces: rootManifestPath -> Set<memberPath>.
  const claimedMembers = new Map<string, Set<string>>();
  for (const manifestPath of manifestPaths) {
    const dirPath = dirname(manifestPath) === '.' ? '.' : dirname(manifestPath);
    const globs = await readWorkspaceGlobs(repoRoot, dirPath, parsed.get(manifestPath));
    if (globs.length === 0) continue;
    const members = matchManifestsToGlobs(manifestPaths, dirPath, globs);
    if (members.size > 0) claimedMembers.set(manifestPath, members);
  }

  // A manifest is a workspace member if some *other* manifest claims it.
  // Degenerate case: two ancestors claim the same path — the nearest (longest
  // root path) wins.
  const memberOf = new Map<string, string>();
  for (const [rootPath, members] of claimedMembers) {
    for (const member of members) {
      const existing = memberOf.get(member);
      if (existing === undefined || rootPath.length > existing.length) {
        memberOf.set(member, rootPath);
      }
    }
  }

  const roots: Root[] = [];
  for (const manifestPath of manifestPaths) {
    if (memberOf.has(manifestPath)) continue;
    const dirPath = dirname(manifestPath) === '.' ? '.' : dirname(manifestPath);
    roots.push({
      path: dirPath,
      packageManager: resolvePackageManager(parsed.get(manifestPath)),
      lockfiles: await findLockfiles(repoRoot, dirPath),
      workspaceMembers: [...(claimedMembers.get(manifestPath) ?? [])]
        .map((m) => (dirname(m) === '.' ? '.' : dirname(m)))
        .sort(),
    });
  }

  roots.sort((a, b) => a.path.localeCompare(b.path));
  return roots;
}

async function findManifests(repoRoot: string): Promise<string[]> {
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
      // Skip hidden dirs except .github, which we may want to surface configs from.
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const next = relDir === '.' ? entry.name : `${relDir}${posix.sep}${entry.name}`;
      await walkDir(repoRoot, next, out);
    } else if (entry.isFile() && entry.name === 'package.json') {
      const relPath = relDir === '.' ? 'package.json' : `${relDir}${posix.sep}package.json`;
      out.push(relPath);
    }
  }
}

async function readJson(absPath: string): Promise<RawManifest> {
  try {
    const text = await readFile(absPath, 'utf8');
    return JSON.parse(text) as RawManifest;
  } catch {
    return {};
  }
}

async function readWorkspaceGlobs(
  repoRoot: string,
  dirPath: string,
  manifest: RawManifest | undefined,
): Promise<string[]> {
  if (manifest?.workspaces) {
    if (Array.isArray(manifest.workspaces)) return manifest.workspaces;
    if (manifest.workspaces.packages) return manifest.workspaces.packages;
  }
  const pnpmWorkspaceFile = join(repoRoot, dirPath, 'pnpm-workspace.yaml');
  if (existsSync(pnpmWorkspaceFile)) {
    return parsePnpmWorkspaceGlobs(await readFile(pnpmWorkspaceFile, 'utf8'));
  }
  return [];
}

// Reads only the `packages:` list. Anything else (settings like
// `minimumReleaseAge`) is handled by the per-check pnpm config reader, not here.
function parsePnpmWorkspaceGlobs(yaml: string): string[] {
  const out: string[] = [];
  let inPackages = false;
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').replace(/\s+$/, '');
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = /^\s+-\s+["']?([^"'\s]+)["']?\s*$/.exec(line);
      if (m && m[1]) {
        out.push(m[1]);
        continue;
      }
      if (line && !/^\s/.test(line)) inPackages = false;
    }
  }
  return out;
}

function matchManifestsToGlobs(
  manifestPaths: string[],
  rootDir: string,
  globs: string[],
): Set<string> {
  const claimed = new Set<string>();
  const rootPrefix = rootDir === '.' ? '' : `${rootDir}${posix.sep}`;
  const rootManifest = rootDir === '.' ? 'package.json' : `${rootDir}${posix.sep}package.json`;
  for (const glob of globs) {
    const re = globToRegex(glob);
    for (const manifestPath of manifestPaths) {
      if (manifestPath === rootManifest) continue;
      if (!manifestPath.startsWith(rootPrefix)) continue;
      const relToRoot = manifestPath.slice(rootPrefix.length);
      if (!relToRoot.endsWith('/package.json')) continue;
      const memberDir = relToRoot.slice(0, -'/package.json'.length);
      if (re.test(memberDir)) claimed.add(manifestPath);
    }
  }
  return claimed;
}

// Supports segment wildcards (*) and recursive globs (**). Brace expansion and
// character classes are deliberately omitted — extremely rare in workspace globs
// and not worth the complexity until proven necessary.
function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\/+$/, '');
  let pattern = '^';
  let i = 0;
  while (i < normalized.length) {
    const c = normalized[i];
    if (c === '*' && normalized[i + 1] === '*') {
      pattern += '.*';
      i += 2;
      if (normalized[i] === '/') i += 1;
    } else if (c === '*') {
      pattern += '[^/]*';
      i += 1;
    } else if (c !== undefined && /[.+()|^$?{}[\]\\]/.test(c)) {
      pattern += '\\' + c;
      i += 1;
    } else {
      pattern += c;
      i += 1;
    }
  }
  pattern += '$';
  return new RegExp(pattern);
}

function resolvePackageManager(manifest: RawManifest | undefined): PackageManager | null {
  const pm = manifest?.packageManager;
  if (typeof pm !== 'string') return null;
  if (pm.startsWith('npm@')) return 'npm';
  if (pm.startsWith('pnpm@')) return 'pnpm';
  if (pm.startsWith('yarn@')) return 'yarn';
  return null;
}

async function findLockfiles(repoRoot: string, dirPath: string): Promise<string[]> {
  const candidates = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];
  const found: string[] = [];
  for (const name of candidates) {
    if (existsSync(join(repoRoot, dirPath, name))) {
      found.push(dirPath === '.' ? name : `${dirPath}${posix.sep}${name}`);
    }
  }
  return found;
}

// Re-exported for unit tests of the helpers in isolation.
export const __test = { globToRegex, parsePnpmWorkspaceGlobs };
