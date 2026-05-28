import type { NodeCheck, Finding, NodeRoot, RepoContext } from '../types.ts';
import { listScannedFiles } from './scanner.ts';

export const CHECK_ID = 'npx-confusion';

const DOC_LINK = 'https://github.com/grafana/security-github-actions/blob/main/supply-chain/docs/checks/js/npx-confusion.md';

// Bare binary names we treat as known-safe. The criterion is "well-established
// dev tool whose binary name matches a long-owned, well-known package on the
// registry." Adding to this list is a security review event — these are tools
// we trust to not be subject to a future name-squat.
const ALLOWED_BARE: ReadonlySet<string> = new Set([
  'tsc',
  'tsx',
  'prettier',
  'eslint',
  'vitest',
  'jest',
  'next',
  'vite',
  'tsup',
  'esbuild',
  'webpack',
  'rollup',
  'biome',
  'turbo',
  'nx',
  'concurrently',
  'cross-env',
  'rimraf',
  'serve',
]);

// Matches `npx <target>` where the target is not a flag and not already scoped.
// The `--package <name>` / `--no-install` / `--yes` / `-y` forms are
// considered safe.
const PATTERN = /\bnpx\s+([^\s]+)(?:\s|$)/;

export const check: NodeCheck = {
  ecosystem: 'js',
  id: CHECK_ID,
  severity: 'advisory',
  async run(root: NodeRoot, ctx: RepoContext): Promise<Finding[]> {
    if (root.path !== '.') return [];
    const files = await listScannedFiles(ctx.repoRoot);
    const findings: Finding[] = [];
    for (const file of files) {
      for (let i = 0; i < file.lines.length; i++) {
        const line = file.lines[i]!;
        const m = PATTERN.exec(line);
        if (!m) continue;
        const target = m[1]!;
        // Safe forms:
        if (target.startsWith('-')) continue; // a flag like --package, --yes
        if (target.startsWith('@')) continue; // already scoped
        if (ALLOWED_BARE.has(target)) continue;
        findings.push({
          check_id: CHECK_ID,
          severity: 'advisory',
          root: '.',
          title: `Unscoped \`npx ${target}\` in ${file.path}:${i + 1}`,
          detail: `If a binary named "${target}" is not available locally or in the npx cache, npx will fetch a package by that name from the public registry. An attacker who registered that name could execute code.`,
          fix: `Use \`npx --package <scope>/<name> ${target}\` to disambiguate.`,
          doc_link: DOC_LINK,
        });
      }
    }
    return findings;
  },
};
