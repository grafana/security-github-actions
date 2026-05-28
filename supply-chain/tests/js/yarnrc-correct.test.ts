import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { discoverJsRoots } from '../../src/js/walk.ts';
import { check, CHECK_ID } from '../../src/js/yarnrc-correct.ts';
import type { RepoContext } from '../../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'yarnrc-correct');

async function runFor(fixture: string) {
  const repoRoot = join(fixturesDir, fixture);
  const roots = await discoverJsRoots(repoRoot);
  assert.equal(roots.length, 1);
  const ctx: RepoContext = { repoRoot, trackedFiles: null };
  return check.run(roots[0]!, ctx);
}

test('good: enableScripts: false => no findings', async () => {
  assert.deepEqual(await runFor('good'), []);
});

test('bad-missing: missing .yarnrc.yml => single finding', async () => {
  const findings = await runFor('bad-missing');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.check_id, CHECK_ID);
  assert.match(findings[0]!.title, /enableScripts/);
});

test('bad-wrong-value: enableScripts: true => single wrong-value finding', async () => {
  const findings = await runFor('bad-wrong-value');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /wrong value/);
  assert.match(findings[0]!.title, /enableScripts/);
});

test('not-yarn-root: skips the check', async () => {
  assert.deepEqual(await runFor('not-yarn-root'), []);
});
