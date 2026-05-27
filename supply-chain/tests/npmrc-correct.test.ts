import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { discoverRoots } from '../src/walk.ts';
import { check, CHECK_ID } from '../src/checks/npmrc-correct.ts';
import type { RepoContext } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'npmrc-correct');

async function runFor(fixture: string) {
  const repoRoot = join(fixturesDir, fixture);
  const roots = await discoverRoots(repoRoot);
  assert.equal(roots.length, 1);
  const ctx: RepoContext = { repoRoot, trackedFiles: null };
  return check.run(roots[0]!, ctx);
}

test('good: all three keys correct => no findings', async () => {
  assert.deepEqual(await runFor('good'), []);
});

test('good-with-comments: comments and blank lines do not confuse the parser', async () => {
  assert.deepEqual(await runFor('good-with-comments'), []);
});

test('good-above-required: min-release-age higher than required is accepted (stricter = ok)', async () => {
  assert.deepEqual(await runFor('good-above-required'), []);
});

test('bad-missing: missing .npmrc => one finding per required key (3)', async () => {
  const findings = await runFor('bad-missing');
  assert.equal(findings.length, 3);
  for (const f of findings) assert.equal(f.check_id, CHECK_ID);
  const keys = findings.map((f) => f.title).join(' | ');
  assert.match(keys, /ignore-scripts/);
  assert.match(keys, /allow-git/);
  assert.match(keys, /min-release-age/);
});

test('bad-missing-keys: only ignore-scripts present => 2 findings', async () => {
  const findings = await runFor('bad-missing-keys');
  assert.equal(findings.length, 2);
});

test('bad-wrong-value: 3 findings — two wrong-value, one below-minimum (min-release-age)', async () => {
  const findings = await runFor('bad-wrong-value');
  assert.equal(findings.length, 3);
  for (const f of findings) assert.match(f.title, /wrong value|below minimum/);
  // min-release-age=1 fails as below-minimum, not wrong-value
  const ageFinding = findings.find((f) => f.title.includes('min-release-age'));
  assert.ok(ageFinding, 'expected a finding for min-release-age');
  assert.match(ageFinding!.title, /below minimum/);
});

test('not-npm-root: pnpm root skips the check entirely', async () => {
  assert.deepEqual(await runFor('not-npm-root'), []);
});
