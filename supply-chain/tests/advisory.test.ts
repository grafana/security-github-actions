import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { discoverRoots } from '../src/walk.ts';
import type { Check, RepoContext } from '../src/types.ts';

import { check as installNotCi } from '../src/checks/js/install-not-ci.ts';
import { check as npxConfusion } from '../src/checks/js/npx-confusion.ts';
import { check as oidc } from '../src/checks/js/oidc-publishing.ts';
import { check as cachePublish } from '../src/checks/js/cache-poisoning-publish.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'advisory');

async function runCheck(checkObj: Check, fixture: string) {
  const repoRoot = join(fixturesDir, fixture);
  const roots = await discoverRoots(repoRoot);
  assert.equal(roots.length, 1);
  const ctx: RepoContext = { repoRoot, trackedFiles: null };
  return checkObj.run(roots[0]!, ctx);
}

// install-not-ci
test('install-not-ci: npm install + pnpm install --no-frozen-lockfile => 2 findings', async () => {
  const findings = await runCheck(installNotCi, 'install-not-ci');
  assert.equal(findings.length, 2);
});

test('install-not-ci: npm ci, pnpm --frozen-lockfile, yarn --immutable => no findings', async () => {
  assert.deepEqual(await runCheck(installNotCi, 'install-ci-ok'), []);
});

// npx-confusion
test('npx-confusion: allowlisted bare names pass; scoped pass; --package passes; one mystery flagged', async () => {
  const findings = await runCheck(npxConfusion, 'npx-confusion');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /some-mystery-tool/);
});

// oidc-publishing
test('oidc-publishing: publish workflow without id-token: write => finding', async () => {
  const findings = await runCheck(oidc, 'oidc-missing');
  assert.equal(findings.length, 1);
});

test('oidc-publishing: publish workflow with id-token: write and no tokens => no finding', async () => {
  assert.deepEqual(await runCheck(oidc, 'oidc-ok'), []);
});

test('oidc-publishing: no publish in workflows => no finding', async () => {
  assert.deepEqual(await runCheck(oidc, 'no-publish'), []);
});

// cache-poisoning-publish
test('cache-poisoning-publish: publish workflow with cache: npm => finding', async () => {
  const findings = await runCheck(cachePublish, 'cache-publish-bad');
  assert.equal(findings.length, 1);
});

test('cache-poisoning-publish: publish workflow with package-manager-cache: false => no finding', async () => {
  assert.deepEqual(await runCheck(cachePublish, 'cache-publish-ok'), []);
});

test('cache-poisoning-publish: non-publishing workflow with cache => no finding', async () => {
  assert.deepEqual(await runCheck(cachePublish, 'no-publish'), []);
});
