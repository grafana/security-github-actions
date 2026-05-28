import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { discoverJsRoots } from '../../src/js/walk.ts';
import { check, parseTopLevelYamlScalars, CHECK_ID } from '../../src/js/pnpm-workspace-correct.ts';
import type { RepoContext } from '../../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures', 'pnpm-workspace-correct');

async function runFor(fixture: string) {
  const repoRoot = join(fixturesDir, fixture);
  const roots = await discoverJsRoots(repoRoot);
  assert.equal(roots.length, 1);
  const ctx: RepoContext = { repoRoot, trackedFiles: null };
  return check.run(roots[0]!, ctx);
}

test('good: all three required keys set => no findings', async () => {
  assert.deepEqual(await runFor('good'), []);
});

test('good-above-required: minimumReleaseAge higher than required is accepted (stricter = ok)', async () => {
  assert.deepEqual(await runFor('good-above-required'), []);
});

test('bad-missing: missing pnpm-workspace.yaml => 3 findings', async () => {
  const findings = await runFor('bad-missing');
  assert.equal(findings.length, 3);
  for (const f of findings) assert.equal(f.check_id, CHECK_ID);
});

test('bad-missing-keys: only minimumReleaseAge present => 2 findings', async () => {
  const findings = await runFor('bad-missing-keys');
  assert.equal(findings.length, 2);
});

test('bad-wrong-value: 3 findings — two wrong-value, one below-minimum (minimumReleaseAge)', async () => {
  const findings = await runFor('bad-wrong-value');
  assert.equal(findings.length, 3);
  for (const f of findings) assert.match(f.title, /wrong value|below minimum/);
  const ageFinding = findings.find((f) => f.title.includes('minimumReleaseAge'));
  assert.ok(ageFinding, 'expected a finding for minimumReleaseAge');
  assert.match(ageFinding!.title, /below minimum/);
});

test('not-pnpm-root: npm root skips the check entirely', async () => {
  assert.deepEqual(await runFor('not-pnpm-root'), []);
});

test('parseTopLevelYamlScalars: nested keys are ignored', () => {
  const yaml = [
    'minimumReleaseAge: 4320',
    'allowBuilds:',
    '  esbuild: true',
    'strictDepBuilds: true',
  ].join('\n');
  const m = parseTopLevelYamlScalars(yaml);
  assert.equal(m.get('minimumReleaseAge'), '4320');
  assert.equal(m.get('strictDepBuilds'), 'true');
  // `allowBuilds:` has no scalar value (opens a block), so it isn't recorded.
  assert.equal(m.get('allowBuilds'), undefined);
  // `esbuild:` is nested under allowBuilds — must not appear at top level.
  assert.equal(m.get('esbuild'), undefined);
});
