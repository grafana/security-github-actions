import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { discoverRoots } from '../src/walk.ts';
import { check, CHECK_ID, __test } from '../src/checks/packagemanager-pinned.ts';
import type { RepoContext } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'packagemanager-pinned');

async function runFor(fixture: string) {
  const repoRoot = join(fixturesDir, fixture);
  const roots = await discoverRoots(repoRoot);
  assert.equal(roots.length, 1);
  const ctx: RepoContext = { repoRoot, trackedFiles: null };
  return check.run(roots[0]!, ctx);
}

test('good-npm: passes', async () => {
  assert.deepEqual(await runFor('good-npm'), []);
});

test('good-pnpm: passes', async () => {
  assert.deepEqual(await runFor('good-pnpm'), []);
});

test('good-yarn: passes', async () => {
  assert.deepEqual(await runFor('good-yarn'), []);
});

test('good-corepack-hash: +<sha> suffix is accepted', async () => {
  assert.deepEqual(await runFor('good-corepack-hash'), []);
});

test('bad-missing: emits missing-field finding', async () => {
  const findings = await runFor('bad-missing');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.check_id, CHECK_ID);
  assert.match(findings[0]!.title, /Missing/);
});

test('bad-old-npm: pinned below 11.10.0', async () => {
  const findings = await runFor('bad-old-npm');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /npm pinned below/);
});

test('bad-old-pnpm: pinned below 11.0.0', async () => {
  const findings = await runFor('bad-old-pnpm');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /pnpm pinned below/);
});

test('bad-old-yarn: yarn 1.x is below 4.14.0', async () => {
  const findings = await runFor('bad-old-yarn');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /yarn pinned below/);
});

test('bad-unknown: unrecognised manager name', async () => {
  const findings = await runFor('bad-unknown');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /Unrecognised/);
});

test('version compare: minor and patch ordering', () => {
  const cmp = __test.compareVersions;
  assert.equal(cmp({ major: 11, minor: 10, patch: 0 }, { major: 11, minor: 10, patch: 0 }), 0);
  assert.ok(cmp({ major: 11, minor: 9, patch: 9 }, { major: 11, minor: 10, patch: 0 }) < 0);
  assert.ok(cmp({ major: 12, minor: 0, patch: 0 }, { major: 11, minor: 10, patch: 0 }) > 0);
});
