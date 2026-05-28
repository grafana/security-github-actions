import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { discoverRoots } from '../src/walk.ts';
import { check, CHECK_ID } from '../src/checks/js/lockfile-committed.ts';
import type { RepoContext } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'lockfile-committed');

// Fixtures aren't real git repos. Pass trackedFiles=null to opt out of git
// verification and fall back to disk presence. The tracked-file branch is
// exercised by a separate fixture-free unit test below.
const FS_ONLY: RepoContext = { repoRoot: '<unset>', trackedFiles: null };

async function runFor(fixture: string) {
  const repoRoot = join(fixturesDir, fixture);
  const roots = await discoverRoots(repoRoot);
  assert.equal(roots.length, 1, 'fixture must produce exactly one root');
  return check.run(roots[0]!, { ...FS_ONLY, repoRoot });
}

test('good-npm: package-lock.json present => no findings', async () => {
  assert.deepEqual(await runFor('good-npm'), []);
});

test('good-pnpm: pnpm-lock.yaml present => no findings', async () => {
  assert.deepEqual(await runFor('good-pnpm'), []);
});

test('good-yarn: yarn.lock present => no findings', async () => {
  assert.deepEqual(await runFor('good-yarn'), []);
});

test('bad-missing-npm: no lockfile => one blocking finding', async () => {
  const findings = await runFor('bad-missing-npm');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.check_id, CHECK_ID);
  assert.equal(findings[0]!.severity, 'blocking');
  assert.match(findings[0]!.title, /package-lock\.json/);
});

test('bad-missing-pnpm: no lockfile => one blocking finding mentioning pnpm-lock.yaml', async () => {
  const findings = await runFor('bad-missing-pnpm');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.detail, /pnpm/);
  assert.match(findings[0]!.title, /pnpm-lock\.yaml/);
});

test('bad-no-pm: no packageManager => check stays quiet (separate check handles it)', async () => {
  assert.deepEqual(await runFor('bad-no-pm'), []);
});

test('lockfile present on disk but not in trackedFiles => finding', async () => {
  // Reuse the good-npm fixture's walker output, but pass a tracked-files set
  // that excludes the lockfile to simulate .gitignore'd-but-on-disk.
  const repoRoot = join(fixturesDir, 'good-npm');
  const roots = await discoverRoots(repoRoot);
  const findings = await check.run(roots[0]!, {
    repoRoot,
    trackedFiles: new Set(['package.json']), // lockfile deliberately absent
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /not committed/);
});

test('lockfile present on disk AND in trackedFiles => no finding', async () => {
  const repoRoot = join(fixturesDir, 'good-npm');
  const roots = await discoverRoots(repoRoot);
  const findings = await check.run(roots[0]!, {
    repoRoot,
    trackedFiles: new Set(['package.json', 'package-lock.json']),
  });
  assert.deepEqual(findings, []);
});
