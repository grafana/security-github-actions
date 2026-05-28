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

test('good: strictDepBuilds: true => no findings', async () => {
  assert.deepEqual(await runFor('good'), []);
});

test('bad-missing: missing pnpm-workspace.yaml => single finding', async () => {
  const findings = await runFor('bad-missing');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.check_id, CHECK_ID);
  assert.match(findings[0]!.title, /strictDepBuilds/);
});

test('bad-wrong-value: strictDepBuilds: false => single wrong-value finding', async () => {
  const findings = await runFor('bad-wrong-value');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.title, /wrong value/);
  assert.match(findings[0]!.title, /strictDepBuilds/);
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
