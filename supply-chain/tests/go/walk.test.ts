import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { discoverGoRoots, __test } from '../../src/go/walk.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'walk');

test('single-module: one root at "."', async () => {
  const roots = await discoverGoRoots(join(fixturesDir, 'single-module'));
  assert.equal(roots.length, 1);
  assert.equal(roots[0]!.ecosystem, 'go');
  assert.equal(roots[0]!.path, '.');
  assert.equal(roots[0]!.goVersion, '1.22');
  assert.equal(roots[0]!.goToolchain, null);
  assert.equal(roots[0]!.gosumPresent, false);
  assert.equal(roots[0]!.hasRequires, false);
});

test('with-toolchain-and-gosum: parses toolchain, detects go.sum, detects requires', async () => {
  const roots = await discoverGoRoots(join(fixturesDir, 'with-toolchain-and-gosum'));
  assert.equal(roots.length, 1);
  assert.equal(roots[0]!.goVersion, '1.22');
  assert.equal(roots[0]!.goToolchain, '1.24.0');
  assert.equal(roots[0]!.gosumPresent, true);
  assert.equal(roots[0]!.hasRequires, true);
});

test('no-requires-no-gosum: hasRequires false, gosumPresent false (legitimate)', async () => {
  const roots = await discoverGoRoots(join(fixturesDir, 'no-requires-no-gosum'));
  assert.equal(roots.length, 1);
  assert.equal(roots[0]!.hasRequires, false);
  assert.equal(roots[0]!.gosumPresent, false);
});

test('workspace: go.work claims members; only standalone-sibling + workspace-root are roots', async () => {
  const roots = await discoverGoRoots(join(fixturesDir, 'workspace'));
  // Two roots expected:
  //   - "." (the workspace root; its go.mod is missing in this fixture, so it
  //     should NOT appear — there's no go.mod at the workspace root in our
  //     fixture, only the go.work file).
  //   - "standalone-sibling" (sits next to the workspace, not claimed)
  // moduleA and moduleB are claimed by go.work, so they're NOT roots.
  const paths = roots.map((r) => r.path).sort();
  assert.deepEqual(paths, ['standalone-sibling']);
});

test('multi-root: two unrelated modules produce two roots', async () => {
  const roots = await discoverGoRoots(join(fixturesDir, 'multi-root'));
  assert.equal(roots.length, 2);
  assert.deepEqual(
    roots.map((r) => r.path).sort(),
    ['projectA', 'projectB'],
  );
});

test('parseGoMod: extracts go + toolchain + require flag', async () => {
  const tmp = join(fixturesDir, 'with-toolchain-and-gosum', 'go.mod');
  const parsed = await __test.parseGoMod(tmp);
  assert.equal(parsed.goVersion, '1.22');
  assert.equal(parsed.goToolchain, '1.24.0');
  assert.equal(parsed.hasRequires, true);
});

test('parseGoWorkUseDirs: handles block form', async () => {
  const tmp = join(fixturesDir, 'workspace', 'go.work');
  const dirs = await __test.parseGoWorkUseDirs(tmp);
  assert.deepEqual(dirs.sort(), ['moduleA', 'moduleB']);
});
