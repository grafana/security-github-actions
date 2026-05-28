import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { discoverJsRoots } from '../../src/js/walk.ts';
import { check, CHECK_ID } from '../../src/js/lockfile-conflict.ts';
import type { RepoContext } from '../../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
// Re-use the walker fixtures — lockfile-conflict has nothing additional to set up
// beyond what the walker already exercises.
const walkFixtures = join(here, 'fixtures', 'walk');

async function runFor(fixtureDir: string) {
  const roots = await discoverJsRoots(fixtureDir);
  assert.equal(roots.length, 1);
  const ctx: RepoContext = { repoRoot: fixtureDir, trackedFiles: null };
  return check.run(roots[0]!, ctx);
}

test('single lockfile: no finding', async () => {
  assert.deepEqual(await runFor(join(walkFixtures, 'single-with-lock')), []);
});

test('two lockfiles: one critical finding', async () => {
  const findings = await runFor(join(walkFixtures, 'lockfile-conflict'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.check_id, CHECK_ID);
  assert.match(findings[0]!.detail, /package-lock\.json/);
  assert.match(findings[0]!.detail, /pnpm-lock\.yaml/);
});

test('zero lockfiles: stays quiet (lockfile-committed handles it)', async () => {
  // single-package fixture has package.json but no lockfile
  assert.deepEqual(await runFor(join(walkFixtures, 'single-package')), []);
});
