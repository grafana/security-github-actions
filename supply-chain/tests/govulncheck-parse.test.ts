import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { parseGovulncheckOutput } from '../src/checks/go/_govulncheck-parse.ts';

// Realistic shape: govulncheck -json emits NDJSON. We feed a mix of config,
// progress, osv, and finding messages — only the call-reachable findings
// (top trace frame has a `function` field) should produce advisories.
const CANNED = [
  JSON.stringify({
    config: {
      protocol_version: 'v1.0.0',
      scanner_name: 'govulncheck',
      scanner_version: 'v1.1.0',
    },
  }),
  JSON.stringify({ progress: { message: 'Scanning your code...' } }),
  JSON.stringify({
    osv: {
      schema_version: '1.3.1',
      id: 'GO-2023-1840',
      modified: '2023-08-09T20:27:33Z',
      published: '2023-08-09T20:27:33Z',
      aliases: ['CVE-2023-39320'],
      summary: 'Stack exhaustion in cmd/go in syntax.Walk',
      details: 'A long detail string...',
      database_specific: { url: 'https://pkg.go.dev/vuln/GO-2023-1840' },
    },
  }),
  // Reachable finding — function is set on the top trace frame.
  JSON.stringify({
    finding: {
      osv: 'GO-2023-1840',
      fixed_version: 'v0.13.0',
      trace: [
        {
          module: 'golang.org/x/text',
          package: 'golang.org/x/text/language',
          function: 'Parse',
          version: 'v0.12.0',
        },
        { module: 'example.com/yourapp', function: 'main' },
      ],
    },
  }),
  // Imported-but-unreachable finding — empty function. Should NOT produce
  // an advisory.
  JSON.stringify({
    finding: {
      osv: 'GO-2023-1840',
      trace: [{ module: 'golang.org/x/text', version: 'v0.12.0' }],
    },
  }),
  // Another reachable, no fixed version — produces a "no fix" advisory.
  JSON.stringify({
    osv: {
      id: 'GO-2025-9999',
      summary: 'Theoretical vuln with no patch',
      database_specific: { url: 'https://pkg.go.dev/vuln/GO-2025-9999' },
    },
  }),
  JSON.stringify({
    finding: {
      osv: 'GO-2025-9999',
      trace: [
        {
          module: 'example.com/unpatched',
          package: 'example.com/unpatched/pkg',
          function: 'BadFn',
          version: 'v1.2.3',
        },
      ],
    },
  }),
].join('\n');

test('parseGovulncheckOutput: only call-reachable findings produce advisories', () => {
  const out = parseGovulncheckOutput(CANNED);
  assert.equal(out.length, 2);

  const reachable = out.find((a) => a.osv === 'GO-2023-1840')!;
  assert.equal(reachable.module, 'golang.org/x/text');
  assert.equal(reachable.symbol, 'Parse');
  assert.equal(reachable.vulnerableVersion, 'v0.12.0');
  assert.equal(reachable.fixedVersion, 'v0.13.0');
  assert.match(reachable.summary, /Stack exhaustion/);
  assert.equal(reachable.url, 'https://pkg.go.dev/vuln/GO-2023-1840');
});

test('parseGovulncheckOutput: no-fix advisory carries through', () => {
  const out = parseGovulncheckOutput(CANNED);
  const nofix = out.find((a) => a.osv === 'GO-2025-9999')!;
  assert.equal(nofix.fixedVersion, undefined);
  assert.equal(nofix.symbol, 'BadFn');
});

test('parseGovulncheckOutput: empty / garbage input returns []', () => {
  assert.deepEqual(parseGovulncheckOutput(''), []);
  assert.deepEqual(parseGovulncheckOutput('   '), []);
  assert.deepEqual(parseGovulncheckOutput('not json\n{also not}'), []);
});

test('parseGovulncheckOutput: clean scan (no finding messages) returns []', () => {
  const clean = [
    JSON.stringify({ config: { protocol_version: 'v1.0.0' } }),
    JSON.stringify({ progress: { message: 'done' } }),
  ].join('\n');
  assert.deepEqual(parseGovulncheckOutput(clean), []);
});

test('parseGovulncheckOutput: missing OSV record falls back to OSV id as summary + default URL', () => {
  const noOsvRecord = JSON.stringify({
    finding: {
      osv: 'GO-2025-XXXX',
      trace: [{ module: 'm', function: 'F', version: 'v1.0.0' }],
    },
  });
  const out = parseGovulncheckOutput(noOsvRecord);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.summary, 'GO-2025-XXXX');
  assert.equal(out[0]!.url, 'https://pkg.go.dev/vuln/GO-2025-XXXX');
});
