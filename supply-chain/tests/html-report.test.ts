import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { renderHtml } from '../src/html-report.ts';
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

test('renderHtml: passing report omits blocking section, includes passing badge', () => {
  const out = renderHtml({
    ran: ['a', 'b', 'c'],
    findings: [],
    suppressed: [],
    runUrl: null,
  });
  // Top-line is the "passed" message
  assert.match(out, /Supply-chain checks passed/);
  // No blocking-violations section
  assert.doesNotMatch(out, /Blocking violations/);
  // Passing badge with count
  assert.match(out, /3 Passing/);
});

test('renderHtml: blocking findings render in their own section', () => {
  const out = renderHtml({
    ran: ['a'],
    findings: [finding('a', 'blocking')],
    suppressed: [],
    runUrl: null,
  });
  assert.match(out, /Blocking violations.*\(1\)/s);
  assert.match(out, /a title/);
  assert.match(out, /do the fix/);
  assert.match(out, /finding-blocking/); // CSS class
});

test('renderHtml: findings group by root', () => {
  const out = renderHtml({
    ran: ['a'],
    findings: [
      finding('a', 'blocking', 'apps/frontend'),
      finding('a', 'blocking', 'apps/backend'),
    ],
    suppressed: [],
    runUrl: null,
  });
  assert.match(out, /apps\/frontend/);
  assert.match(out, /apps\/backend/);
});

test('renderHtml: HTML special characters in titles/details are escaped', () => {
  const out = renderHtml({
    ran: ['x'],
    findings: [
      {
        check_id: 'x',
        severity: 'blocking',
        root: '.',
        title: '<script>alert(1)</script>',
        detail: 'a & b "c"',
        fix: 'foo',
        doc_link: 'https://example/d?a=1&b=2',
      },
    ],
    suppressed: [],
    runUrl: null,
  });
  // The dangerous payload should NOT appear as a live tag
  assert.doesNotMatch(out, /<script>alert\(1\)<\/script>/);
  // It should appear escaped
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  // Detail's & should be escaped
  assert.match(out, /a &amp; b/);
  // Doc URL: & inside an attribute must be escaped to &amp;
  assert.match(out, /href="https:\/\/example\/d\?a=1&amp;b=2"/);
});

test('renderHtml: runUrl null => no footer link', () => {
  const out = renderHtml({
    ran: ['a'],
    findings: [],
    suppressed: [],
    runUrl: null,
  });
  assert.doesNotMatch(out, /View workflow run/);
});

test('renderHtml: runUrl present => footer link to that URL', () => {
  const out = renderHtml({
    ran: ['a'],
    findings: [],
    suppressed: [],
    runUrl: 'https://github.com/o/r/actions/runs/123',
  });
  assert.match(out, /href="https:\/\/github.com\/o\/r\/actions\/runs\/123"/);
  assert.match(out, /View workflow run/);
});

test('renderHtml: emits a complete HTML document with charset + viewport', () => {
  const out = renderHtml({
    ran: ['a'],
    findings: [],
    suppressed: [],
    runUrl: null,
  });
  assert.match(out, /^<!DOCTYPE html>/);
  assert.match(out, /<meta charset="utf-8">/);
  assert.match(out, /<meta name="viewport"/);
  assert.match(out, /<\/html>\s*$/);
});

test('renderHtml: suppressed findings get their own section', () => {
  const out = renderHtml({
    ran: ['a'],
    findings: [],
    suppressed: [finding('a', 'blocking')],
    runUrl: null,
  });
  assert.match(out, /Suppressed.*\(1\)/s);
  assert.match(out, /1 Suppressed/);
});
