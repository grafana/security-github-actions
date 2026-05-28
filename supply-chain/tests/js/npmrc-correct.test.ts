import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { discoverJsRoots } from '../../src/js/walk.ts';
import { check, CHECK_ID } from '../../src/js/npmrc-correct.ts';
import type { RepoContext } from '../../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'npmrc-correct');

async function runFor(fixture: string) {
  const repoRoot = join(fixturesDir, fixture);
  const roots = await discoverJsRoots(repoRoot);
  assert.equal(roots.length, 1);
  const ctx: RepoContext = { repoRoot, trackedFiles: null };
  return check.run(roots[0]!, ctx);
}

test('good: ignore-scripts=true => no findings', async () => {
  assert.deepEqual(await runFor('good'), []);
});

test('good-with-comments: comments and blank lines do not confuse the parser', async () => {
  assert.deepEqual(await runFor('good-with-comments'), []);
});

test('bad-missing: missing .npmrc => single finding', async () => {
  const findings = await runFor('bad-missing');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.check_id, CHECK_ID);
  assert.match(findings[0]!.title, /ignore-scripts/);
});

test('bad-wrong-value: ignore-scripts=false => single wrong-value finding', async () => {
  const findings = await runFor('bad-wrong-value');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /wrong value/);
  assert.match(findings[0]!.title, /ignore-scripts/);
});

test('not-npm-root: pnpm root skips the check entirely', async () => {
  assert.deepEqual(await runFor('not-npm-root'), []);
});
