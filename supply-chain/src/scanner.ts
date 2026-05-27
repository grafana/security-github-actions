// Shared file scanner used by the four heuristic advisory checks
// (install-not-ci, npx-confusion, cache-poisoning-publish, oidc-publishing).
//
// Scans a fixed list of file types — workflows, Dockerfile, Tiltfile, Makefile,
// mise.toml, root *.sh — and exposes the matching contents to checks via
// per-line iteration. Comments are *not* stripped centrally because comment
// syntax differs by file type; checks that need to ignore comments do so
// themselves.

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, extname, posix } from 'node:path';

export type ScannedFile = {
  // Repo-relative path.
  path: string;
  // Lines of the file (1-indexed in references; the array is 0-indexed).
  lines: string[];
};

const SHELL_EXTENSIONS = new Set(['.sh']);

// Returns the list of file paths to scan, relative to repoRoot. The set is
// fixed and small; we don't try to read every file in the repo.
export async function listScannedFiles(repoRoot: string): Promise<ScannedFile[]> {
  const paths: string[] = [];

  // Workflows directory — every .yml/.yaml file.
  await collectFiles(join(repoRoot, '.github', 'workflows'), repoRoot, '.github/workflows', paths, (name) =>
    /\.ya?ml$/i.test(name),
  );

  // Top-level well-known files.
  for (const candidate of ['Dockerfile', 'Tiltfile', 'Makefile', 'mise.toml']) {
    if (existsSync(join(repoRoot, candidate))) paths.push(candidate);
  }

  // Top-level *.sh files (not recursive — scripts buried five dirs down are
  // out of scope until proven necessary).
  try {
    const top = await readdir(repoRoot, { withFileTypes: true });
    for (const entry of top) {
      if (entry.isFile() && SHELL_EXTENSIONS.has(extname(entry.name))) {
        paths.push(entry.name);
      }
      // Also catch Dockerfile.* variants (e.g. Dockerfile.dev)
      if (entry.isFile() && /^Dockerfile\./.test(entry.name)) {
        paths.push(entry.name);
      }
    }
  } catch {
    // empty/inaccessible repo root — nothing to scan
  }

  const out: ScannedFile[] = [];
  for (const p of paths) {
    try {
      const text = await readFile(join(repoRoot, p), 'utf8');
      out.push({ path: p, lines: text.split(/\r?\n/) });
    } catch {
      // unreadable file — skip
    }
  }
  return out;
}

async function collectFiles(
  absDir: string,
  repoRoot: string,
  relDir: string,
  out: string[],
  filter: (name: string) => boolean,
): Promise<void> {
  if (!existsSync(absDir)) return;
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isFile() && filter(entry.name)) {
      out.push(`${relDir}${posix.sep}${entry.name}`);
    }
  }
}

// True if path looks like a GitHub Actions workflow file.
export function isWorkflowFile(path: string): boolean {
  return /^\.github\/workflows\/.+\.ya?ml$/.test(path);
}

// True if path is a top-level Dockerfile or Dockerfile.<suffix>.
export function isDockerfile(path: string): boolean {
  const b = basename(path);
  return b === 'Dockerfile' || /^Dockerfile\./.test(b);
}
