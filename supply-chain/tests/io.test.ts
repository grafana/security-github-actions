import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { writePayload, readPayload, mergePayloads } from '../src/io.ts';
import type { ReportPayload } from '../src/io.ts';
import type { Finding } from '../src/types.ts';

function finding(check_id: string, severity: 'blocking' | 'advisory', root = '.'): Finding {
  return {
    check_id,
    severity,
    root,
    title: `${check_id} t`,
    detail: 'd',
    fix: 'f',
    doc_link: 'l',
  };
}

// Use a path inside the project's own writable space; the sandbox blocks
// tmpdir() writes in some environments.
function tmpPath(): string {
  const name = `io-test-${randomBytes(6).toString('hex')}.json`;
  // tests/ is writable in this sandbox even when /tmp is not
  return join(import.meta.dirname ?? '.', name);
}

test('write/read payload round-trips', async () => {
  const p = tmpPath();
  const payload: ReportPayload = {
    source: 'static',
    ran: ['a', 'b'],
    findings: [finding('a', 'blocking'), finding('b', 'advisory')],
    suppressed: [finding('c', 'blocking')],
  };
  try {
    await writePayload(p, payload);
    const got = await readPayload(p);
    assert.deepEqual(got, payload);
  } finally {
    try {
      await unlink(p);
    } catch {
      /* ignore */
    }
  }
});

test('mergePayloads: union of ran ids preserves first-seen order', () => {
  const a: ReportPayload = { source: 'static', ran: ['x', 'y'], findings: [], suppressed: [] };
  const b: ReportPayload = { source: 'audit', ran: ['y', 'z'], findings: [], suppressed: [] };
  const m = mergePayloads([a, b]);
  assert.deepEqual(m.ranIds, ['x', 'y', 'z']);
});

test('mergePayloads: findings and suppressions are concatenated', () => {
  const a: ReportPayload = {
    source: 'static',
    ran: ['a'],
    findings: [finding('a', 'blocking')],
    suppressed: [finding('b', 'blocking')],
  };
  const b: ReportPayload = {
    source: 'audit',
    ran: ['c'],
    findings: [finding('c', 'advisory')],
    suppressed: [],
  };
  const m = mergePayloads([a, b]);
  assert.equal(m.findings.length, 2);
  assert.equal(m.suppressed.length, 1);
});

test('mergePayloads: zero inputs => empty result', () => {
  const m = mergePayloads([]);
  assert.deepEqual(m, { ranIds: [], findings: [], suppressed: [] });
});

// Render integration — ensure a missing payload doesn't crash readPayload.
test('readPayload: invalid JSON throws', async () => {
  const p = tmpPath();
  try {
    await writeFile(p, 'not json');
    await assert.rejects(() => readPayload(p));
  } finally {
    try {
      await unlink(p);
    } catch {
      /* ignore */
    }
  }
});
