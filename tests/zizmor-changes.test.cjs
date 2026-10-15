const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(
  path.join(__dirname, '../.github/workflows/self-zizmor.yaml'), 'utf8',
);
const script = workflow.match(/          script: \|\n((?:            .*\n|\n)+)/)?.[1];
assert.ok(script, 'PR change detection must exist in the workflow');
const evaluate = new Function('github', 'context', 'core', `return (async () => {${script}})()`);

async function shouldScan(files, changedFiles = files.length) {
  const outputs = {};
  const listFiles = () => {};
  await evaluate({
    rest: { pulls: { listFiles } },
    paginate: async (method, args) => {
      assert.equal(method, listFiles);
      assert.deepEqual(args, { owner: 'grafana', repo: 'example', pull_number: 42, per_page: 100 });
      return files;
    },
  }, {
    repo: { owner: 'grafana', repo: 'example' },
    issue: { number: 42 },
    payload: { pull_request: { changed_files: changedFiles } },
  }, {
    setOutput: (name, value) => { outputs[name] = String(value); },
  });
  return outputs['found-files'];
}

test('skip unrelated source, scripts, and documentation changes', async () => {
  assert.equal(await shouldScan([
    { filename: 'ksonnet/environments/cortex/dev-us-central-0.cortex-dev-01/temp.libsonnet' },
    { filename: 'scripts/check.sh' },
    { filename: '.github/workflows/README.md' },
  ]), 'false');
});

test('scan workflow, action, and configuration changes', async () => {
  for (const filename of [
    '.github/workflows/ci.yml', '.github/workflows/ci.yaml',
    'example/.github/workflows/ci.yml',
    'action.yml', '.github/actions/check/action.yaml', 'custom/action.yml',
    'zizmor.yml', 'zizmor.yaml', '.zizmor.yml', '.github/zizmor.yml',
    '.github/zizmor.yaml',
  ]) {
    assert.equal(await shouldScan([{ filename }]), 'true', filename);
  }
});

test('scan deleted definitions and renames into or out of matching paths', async () => {
  assert.equal(await shouldScan([{ filename: '.github/workflows/ci.yml', status: 'removed' }]), 'true');
  assert.equal(await shouldScan([{ filename: 'archived.txt', previous_filename: 'action.yml' }]), 'true');
  assert.equal(await shouldScan([{ filename: 'action.yml', previous_filename: 'draft.txt' }]), 'true');
});

test('inspect matches beyond the first page', async () => {
  const files = Array.from({ length: 150 }, (_, i) => ({ filename: `src/${i}.js` }));
  files.push({ filename: '.github/workflows/ci.yml' });
  assert.equal(await shouldScan(files), 'true');
});

test('scan when GitHub truncates the changed-file list', async () => {
  assert.equal(await shouldScan([{ filename: 'README.md' }], 3001), 'true');
});

test('propagate API failures instead of silently skipping the scan', async () => {
  await assert.rejects(evaluate({
    rest: { pulls: { listFiles: () => {} } },
    paginate: async () => { throw new Error('API unavailable'); },
  }, { repo: {}, issue: { number: 42 } }, {}), /API unavailable/);
});
