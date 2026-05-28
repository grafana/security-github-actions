import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { parseAuditOutput } from '../src/checks/js/_audit-parse.ts';

// Minimal real-shape fixture: npm audit-report v2 (also pnpm v9+).
// One critical advisory in `lodash`, one high in `axios`, one moderate that we
// expect to be parsed but filtered out by the caller (the parser surfaces all
// severities; the check filters to high+critical).
const NPM_V2 = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    lodash: {
      name: 'lodash',
      severity: 'critical',
      range: '<4.17.21',
      via: [
        {
          source: 1094499,
          name: 'lodash',
          title: 'Prototype Pollution in lodash',
          url: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm',
          severity: 'critical',
          cwe: ['CWE-1321'],
          range: '<4.17.21',
        },
      ],
      effects: [],
      nodes: ['node_modules/lodash'],
      fixAvailable: { name: 'lodash', version: '4.17.21', isSemVerMajor: false },
    },
    axios: {
      name: 'axios',
      severity: 'high',
      range: '<0.21.2',
      via: [
        {
          source: 1089270,
          name: 'axios',
          title: 'Axios Cross-Site Request Forgery Vulnerability',
          url: 'https://github.com/advisories/GHSA-wf5p-g6vw-rhxx',
          severity: 'high',
          range: '<0.21.2',
        },
      ],
      effects: [],
      nodes: ['node_modules/axios'],
      fixAvailable: true,
    },
    'transitive-only': {
      name: 'transitive-only',
      severity: 'moderate',
      range: '*',
      via: ['axios'], // string ref — must NOT produce an advisory here
      effects: [],
      nodes: [],
      fixAvailable: false,
    },
  },
  metadata: { vulnerabilities: { critical: 1, high: 1, moderate: 1, low: 0, info: 0 } },
});

test('npm v2: emits one advisory per via-entry, ignores string refs', () => {
  const out = parseAuditOutput(NPM_V2);
  // 2 leaf advisories (lodash + axios). The `transitive-only` entry has only a
  // string ref so the parser doesn't emit a duplicate for it.
  assert.equal(out.length, 2);
  const lodash = out.find((a) => a.package === 'lodash')!;
  assert.equal(lodash.severity, 'critical');
  assert.match(lodash.title, /Prototype Pollution/);
  assert.equal(lodash.url, 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm');
  assert.equal(lodash.vulnerableRange, '<4.17.21');
  assert.deepEqual(lodash.fixAvailable, {
    name: 'lodash',
    version: '4.17.21',
    isSemVerMajor: false,
  });
  const axios = out.find((a) => a.package === 'axios')!;
  assert.equal(axios.severity, 'high');
  assert.equal(axios.fixAvailable, true);
});

// npm v1 / older pnpm: advisories keyed by numeric id.
const NPM_V1 = JSON.stringify({
  advisories: {
    '1234': {
      id: 1234,
      module_name: 'minimist',
      severity: 'high',
      title: 'Prototype Pollution',
      url: 'https://npmjs.com/advisories/1234',
      vulnerable_versions: '<1.2.6',
      patched_versions: '>=1.2.6',
      findings: [],
    },
  },
  metadata: { vulnerabilities: { high: 1, critical: 0 } },
});

test('npm v1: parses advisories collection and surfaces patchedRange', () => {
  const out = parseAuditOutput(NPM_V1);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.package, 'minimist');
  assert.equal(out[0]!.severity, 'high');
  assert.equal(out[0]!.vulnerableRange, '<1.2.6');
  assert.equal(out[0]!.patchedRange, '>=1.2.6');
});

// Yarn 4 NDJSON: one object per line.
const YARN_NDJSON = [
  JSON.stringify({
    value: 'semver',
    children: {
      ID: 'GHSA-c2qf-rxjj-qqgw',
      Issue: 'semver vulnerable to ReDoS',
      URL: 'https://github.com/advisories/GHSA-c2qf-rxjj-qqgw',
      Severity: 'high',
      'Vulnerable Versions': '<5.7.2',
    },
  }),
  JSON.stringify({
    value: 'tar',
    children: {
      Issue: 'Insufficient symlink protection',
      Severity: 'critical',
      'Vulnerable Versions': '<6.2.1',
    },
  }),
  '',
].join('\n');

test('yarn NDJSON: each line becomes one advisory', () => {
  const out = parseAuditOutput(YARN_NDJSON);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.package, 'semver');
  assert.equal(out[0]!.severity, 'high');
  assert.equal(out[0]!.url, 'https://github.com/advisories/GHSA-c2qf-rxjj-qqgw');
  assert.equal(out[1]!.package, 'tar');
  assert.equal(out[1]!.severity, 'critical');
});

test('empty / whitespace / garbage input returns []', () => {
  assert.deepEqual(parseAuditOutput(''), []);
  assert.deepEqual(parseAuditOutput('   \n\n  '), []);
  assert.deepEqual(parseAuditOutput('not json at all'), []);
});

test('unknown severity is normalised to "info"', () => {
  const odd = JSON.stringify({
    advisories: {
      '1': { module_name: 'x', severity: 'apocalyptic', title: 't' },
    },
  });
  const out = parseAuditOutput(odd);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.severity, 'info');
});

test('clean audit (zero vulnerabilities) returns []', () => {
  const clean = JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, info: 0 } },
  });
  assert.deepEqual(parseAuditOutput(clean), []);
});
