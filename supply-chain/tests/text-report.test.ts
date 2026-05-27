import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { renderText } from '../src/text-report.ts';
import type { Finding } from '../src/types.ts';

function finding(check_id: string, severity: 'blocking' | 'advisory', root = '.'): Finding {
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

test('renderText: passing report has no blocking section', () => {
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
  assert.doesNotMatch(out, /Blocking violations/);
  assert.match(out, /Passing checks \(3\)/);
});

test('renderText: blocking findings produce a blocking section', () => {
  const out = renderText(
    {
      ran: ['a', 'b'],
      findings: [finding('a', 'blocking')],
      suppressed: [],
      runUrl: 'https://example/run',
    },
    { useColor: false },
  );
  assert.match(out, /1 blocking/);
  assert.match(out, /Blocking violations \(1\)/);
  assert.match(out, /a title/);
  assert.match(out, /do the fix/);
});

test('renderText: findings group by root', () => {
  const out = renderText(
    {
      ran: ['a'],
      findings: [
        finding('a', 'blocking', 'apps/frontend'),
        finding('a', 'blocking', 'apps/backend'),
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
      findings: [finding('a', 'blocking')],
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
      suppressed: [finding('a', 'blocking')],
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
      findings: [finding('a', 'blocking')],
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
