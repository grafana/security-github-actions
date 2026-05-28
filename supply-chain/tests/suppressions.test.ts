import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { parseSuppressionsText, partitionBySuppression } from '../src/suppressions.ts';
import type { Finding } from '../src/types.ts';

const FILE = '.github/supply-chain.yml';

test('parses a single valid entry', () => {
  const yaml = [
    'suppressions:',
    '  - check_id: lockfile-committed',
    '    reason: "upstream mirror"',
    '    expires: 2026-12-31',
  ].join('\n');
  const { entries, errors } = parseSuppressionsText(yaml, FILE);
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.check_id, 'lockfile-committed');
  assert.equal(entries[0]!.reason, 'upstream mirror');
  assert.equal(entries[0]!.expires, '2026-12-31');
});

test('parses multiple entries', () => {
  const yaml = [
    'suppressions:',
    '  - check_id: a',
    '    reason: "ra"',
    '  - check_id: b',
    '    reason: "rb"',
  ].join('\n');
  const { entries, errors } = parseSuppressionsText(yaml, FILE);
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.check_id, 'a');
  assert.equal(entries[1]!.check_id, 'b');
});

test('reports missing reason as an error', () => {
  const yaml = ['suppressions:', '  - check_id: orphan'].join('\n');
  const { entries, errors } = parseSuppressionsText(yaml, FILE);
  assert.equal(entries.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!.message, /missing reason/);
});

test('reports unknown field as an error but still accepts the entry', () => {
  const yaml = [
    'suppressions:',
    '  - check_id: foo',
    '    reason: "r"',
    '    nonsense: 42',
  ].join('\n');
  const { entries, errors } = parseSuppressionsText(yaml, FILE);
  assert.equal(entries.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!.message, /unknown suppression field/);
});

test('comments and blank lines are ignored', () => {
  const yaml = [
    '# a comment',
    'suppressions:',
    '  # this entry is ours',
    '  - check_id: foo',
    '    reason: "r"',
    '',
  ].join('\n');
  const { entries, errors } = parseSuppressionsText(yaml, FILE);
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 1);
});

test('partition: suppressed findings move to the suppressed bucket', () => {
  const findings: Finding[] = [
    finding('lockfile-committed'),
    finding('npmrc-correct'),
  ];
  const { active, suppressed } = partitionBySuppression(findings, [
    { check_id: 'lockfile-committed', reason: 'r' },
  ]);
  assert.equal(active.length, 1);
  assert.equal(active[0]!.check_id, 'npmrc-correct');
  assert.equal(suppressed.length, 1);
  assert.equal(suppressed[0]!.check_id, 'lockfile-committed');
});

test('partition: expired suppression does NOT suppress', () => {
  const findings: Finding[] = [finding('lockfile-committed')];
  const { active, suppressed } = partitionBySuppression(
    findings,
    [{ check_id: 'lockfile-committed', reason: 'r', expires: '2020-01-01' }],
    new Date('2026-05-27'),
  );
  assert.equal(active.length, 1);
  assert.equal(suppressed.length, 0);
});

test('partition: future-dated suppression DOES suppress', () => {
  const findings: Finding[] = [finding('lockfile-committed')];
  const { active, suppressed } = partitionBySuppression(
    findings,
    [{ check_id: 'lockfile-committed', reason: 'r', expires: '2027-01-01' }],
    new Date('2026-05-27'),
  );
  assert.equal(active.length, 0);
  assert.equal(suppressed.length, 1);
});

function finding(check_id: string): Finding {
  return {
    check_id,
    severity: 'critical',
    root: '.',
    title: 't',
    detail: 'd',
    fix: 'f',
    doc_link: 'l',
  };
}
