import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { renderText } from '../src/text-report.ts';
import type { Finding } from '../src/types.ts';

function finding(check_id: string, severity: 'critical' | 'advisory', root = '.'): Finding {
  return {
    check_id,
    severity,
    root,
    title: `${check_id} title`,
    detail: 'detail line',
    fix: 'do the fix',
    doc_link: 'https://example/d',
  };
}

test('renderText: passing report has no critical section', () => {
  const out = renderText(
    {
      ran: ['a', 'b', 'c'],
      findings: [],
      suppressed: [],
      runUrl: 'https://example/run',
    },
    { useColor: false },
  );
  assert.match(out, /Supply-chain checks passed/);
  assert.doesNotMatch(out, /Critical violations/);
  assert.match(out, /Passing checks \(3\)/);
});

test('renderText: critical findings produce a critical section', () => {
  const out = renderText(
    {
      ran: ['a', 'b'],
      findings: [finding('a', 'critical')],
      suppressed: [],
      runUrl: 'https://example/run',
    },
    { useColor: false },
  );
  assert.match(out, /1 critical/);
  assert.match(out, /Critical violations \(1\)/);
  assert.match(out, /a title/);
  assert.match(out, /do the fix/);
});

test('renderText: findings group by root', () => {
  const out = renderText(
    {
      ran: ['a'],
      findings: [
        finding('a', 'critical', 'apps/frontend'),
        finding('a', 'critical', 'apps/backend'),
      ],
      suppressed: [],
      runUrl: 'https://example/run',
    },
    { useColor: false },
  );
  // Both root paths should appear as group headers.
  assert.match(out, /apps\/frontend/);
  assert.match(out, /apps\/backend/);
});

test('renderText: useColor=false produces no ANSI escapes', () => {
  const out = renderText(
    {
      ran: ['a'],
      findings: [finding('a', 'critical')],
      suppressed: [],
      runUrl: 'https://example/run',
    },
    { useColor: false },
  );
  // ANSI CSI introducer is ESC [
  assert.doesNotMatch(out, /\x1b\[/);
});

test('renderText: suppressed section appears when there are suppressed findings', () => {
  const out = renderText(
    {
      ran: ['a'],
      findings: [],
      suppressed: [finding('a', 'critical')],
      runUrl: 'https://example/run',
    },
    { useColor: false },
  );
  assert.match(out, /Suppressed \(1\)/);
});

test('renderText: no <details>, no <strong>, no raw markdown brackets', () => {
  const out = renderText(
    {
      ran: ['a', 'b'],
      findings: [finding('a', 'critical')],
      suppressed: [finding('b', 'advisory')],
      runUrl: 'https://example/run',
    },
    { useColor: false },
  );
  assert.doesNotMatch(out, /<details/);
  assert.doesNotMatch(out, /<\/details>/);
  assert.doesNotMatch(out, /<strong>/);
  assert.doesNotMatch(out, /<summary>/);
  // The markdown link syntax for the docs link is gone in text mode.
  assert.doesNotMatch(out, /\[Docs\]\(/);
});
