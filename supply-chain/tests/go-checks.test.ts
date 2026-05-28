import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { discoverGoRoots } from '../src/walk-go.ts';
import { check as gosumCommitted } from '../src/checks/go/gosum-committed.ts';
import { check as toolchainPinned } from '../src/checks/go/toolchain-pinned.ts';
import type { RepoContext } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'go-checks');

async function runGosum(fixture: string) {
  const repoRoot = join(fixturesDir, fixture);
  const roots = await discoverGoRoots(repoRoot);
  assert.equal(roots.length, 1);
  const ctx: RepoContext = { repoRoot, trackedFiles: null };
  return gosumCommitted.run(roots[0]!, ctx);
}

async function runToolchain(fixture: string) {
  const repoRoot = join(fixturesDir, fixture);
  const roots = await discoverGoRoots(repoRoot);
  assert.equal(roots.length, 1);
  const ctx: RepoContext = { repoRoot, trackedFiles: null };
  return toolchainPinned.run(roots[0]!, ctx);
}

// gosum-committed
test('gosum-committed: go.sum present with requires => no finding', async () => {
  assert.deepEqual(await runGosum('gosum-good'), []);
});

test('gosum-committed: go.sum missing with requires => blocking finding', async () => {
  const findings = await runGosum('gosum-missing');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.check_id, 'gosum-committed');
  assert.match(findings[0]!.title, /Missing go\.sum/);
});

test('gosum-committed: no requires => no finding (legitimate empty module)', async () => {
  assert.deepEqual(await runGosum('gosum-no-requires'), []);
});

test('gosum-committed: on disk but not tracked => finding', async () => {
  const repoRoot = join(fixturesDir, 'gosum-good');
  const roots = await discoverGoRoots(repoRoot);
  const ctx: RepoContext = {
    repoRoot,
    trackedFiles: new Set(['go.mod']), // go.sum deliberately absent
  };
  const findings = await gosumCommitted.run(roots[0]!, ctx);
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /not committed/);
});

// go-toolchain-pinned
test('go-toolchain-pinned: toolchain go1.24.3 + go 1.22 => no finding', async () => {
  assert.deepEqual(await runToolchain('toolchain-good'), []);
});

test('go-toolchain-pinned: no toolchain directive => finding', async () => {
  const findings = await runToolchain('toolchain-missing');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /Missing.*toolchain/);
});

test('go-toolchain-pinned: toolchain below minimum => finding', async () => {
  const findings = await runToolchain('toolchain-old');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /pinned below minimum/);
});

test('go-toolchain-pinned: go directive below minimum even with valid toolchain => finding', async () => {
  const findings = await runToolchain('go-directive-old');
  // Both checks fire: go directive is 1.18 (below 1.22), toolchain is fine.
  // Only the go-directive issue should surface here.
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /`go` directive below minimum/);
});
