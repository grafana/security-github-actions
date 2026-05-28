import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { discoverJsRoots, __test } from '../../src/js/walk.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'walk');

test('single-package: one root at "."', async () => {
  const roots = await discoverJsRoots(join(fixturesDir, 'single-package'));
  assert.equal(roots.length, 1);
  assert.equal(roots[0]!.path, '.');
  assert.equal(roots[0]!.packageManager, 'pnpm');
  assert.deepEqual(roots[0]!.lockfiles, []);
  assert.deepEqual(roots[0]!.workspaceMembers, []);
});

test('single-with-lock: one root, one lockfile', async () => {
  const roots = await discoverJsRoots(join(fixturesDir, 'single-with-lock'));
  assert.equal(roots.length, 1);
  assert.equal(roots[0]!.path, '.');
  assert.equal(roots[0]!.packageManager, 'npm');
  assert.deepEqual(roots[0]!.lockfiles, ['package-lock.json']);
});

test('npm-workspaces: one root, two members, members are not roots', async () => {
  const roots = await discoverJsRoots(join(fixturesDir, 'npm-workspaces'));
  assert.equal(roots.length, 1, 'workspace children must not be classified as roots');
  assert.equal(roots[0]!.path, '.');
  assert.deepEqual(roots[0]!.workspaceMembers, ['packages/a', 'packages/b']);
});

test('pnpm-workspaces: pnpm-workspace.yaml claims members', async () => {
  const roots = await discoverJsRoots(join(fixturesDir, 'pnpm-workspaces'));
  assert.equal(roots.length, 1);
  assert.equal(roots[0]!.packageManager, 'pnpm');
  assert.deepEqual(roots[0]!.workspaceMembers, ['apps/backend', 'apps/frontend']);
});

test('multi-root: two unrelated projects produce two roots', async () => {
  const roots = await discoverJsRoots(join(fixturesDir, 'multi-root'));
  assert.equal(roots.length, 2);
  assert.deepEqual(
    roots.map((r) => r.path).sort(),
    ['projects/bar', 'projects/foo'],
  );
});

test('lockfile-conflict: walker surfaces multiple lockfiles (check decides severity)', async () => {
  const roots = await discoverJsRoots(join(fixturesDir, 'lockfile-conflict'));
  assert.equal(roots.length, 1);
  assert.deepEqual(roots[0]!.lockfiles.sort(), ['package-lock.json', 'pnpm-lock.yaml']);
});

test('nested-non-workspace: nested package.json without workspaces => both are roots', async () => {
  const roots = await discoverJsRoots(join(fixturesDir, 'nested-non-workspace'));
  assert.equal(roots.length, 2);
  assert.deepEqual(roots.map((r) => r.path).sort(), ['.', 'sub/pkg']);
});

test('globToRegex: handles segment and recursive wildcards', () => {
  const segment = __test.globToRegex('apps/*');
  assert.ok(segment.test('apps/frontend'));
  assert.ok(!segment.test('apps/frontend/nested'), 'single * must not cross /');
  assert.ok(!segment.test('apps'));

  const recursive = __test.globToRegex('packages/**');
  assert.ok(recursive.test('packages/a'));
  assert.ok(recursive.test('packages/a/b/c'));
  assert.ok(!recursive.test('other/a'));

  // Literal special chars are escaped, not interpreted.
  const literal = __test.globToRegex('apps/foo.bar');
  assert.ok(literal.test('apps/foo.bar'));
  assert.ok(!literal.test('apps/fooxbar'), '. must be literal, not "any char"');
});

test('parsePnpmWorkspaceGlobs: extracts only the packages list', () => {
  const yaml = [
    'packages:',
    '  - "apps/*"',
    '  - "packages/**"',
    '',
    'minimumReleaseAge: 4320',
    'strictDepBuilds: true',
  ].join('\n');
  assert.deepEqual(__test.parsePnpmWorkspaceGlobs(yaml), ['apps/*', 'packages/**']);
});
