import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { discoverRoots } from '../src/walk.ts';
import { check, CHECK_ID } from '../src/checks/yarnrc-correct.ts';
import type { RepoContext } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'yarnrc-correct');

async function runFor(fixture: string) {
  const repoRoot = join(fixturesDir, fixture);
  const roots = await discoverRoots(repoRoot);
  assert.equal(roots.length, 1);
  const ctx: RepoContext = { repoRoot, trackedFiles: null };
  return check.run(roots[0]!, ctx);
}

test('good: passes', async () => {
  assert.deepEqual(await runFor('good'), []);
});

test('good-above-required: npmMinimalAgeGate higher than required is accepted (stricter = ok)', async () => {
  assert.deepEqual(await runFor('good-above-required'), []);
});

test('bad-missing: missing .yarnrc.yml => 3 findings', async () => {
  const findings = await runFor('bad-missing');
  assert.equal(findings.length, 3);
  for (const f of findings) assert.equal(f.check_id, CHECK_ID);
});

test('bad-missing-keys: 2 missing-key findings', async () => {
  const findings = await runFor('bad-missing-keys');
  assert.equal(findings.length, 2);
});

test('bad-wrong-value: 3 findings — two wrong-value, one below-minimum (npmMinimalAgeGate)', async () => {
  const findings = await runFor('bad-wrong-value');
  assert.equal(findings.length, 3);
  for (const f of findings) assert.match(f.title, /wrong value|below minimum/);
  const ageFinding = findings.find((f) => f.title.includes('npmMinimalAgeGate'));
  assert.ok(ageFinding, 'expected a finding for npmMinimalAgeGate');
  assert.match(ageFinding!.title, /below minimum/);
});

test('bad-forbidden-key: approvedGitRepositories present with values => 1 finding', async () => {
  const findings = await runFor('bad-forbidden-key');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /approvedGitRepositories/);
});

test('bad-forbidden-key-empty-list: even an empty list trips the check', async () => {
  const findings = await runFor('bad-forbidden-key-empty-list');
  assert.equal(findings.length, 1);
});

test('good-comment-mentions-forbidden: comments do not trigger the forbidden-key rule', async () => {
  assert.deepEqual(await runFor('good-comment-mentions-forbidden'), []);
});

test('not-yarn-root: skips the check', async () => {
  assert.deepEqual(await runFor('not-yarn-root'), []);
});
