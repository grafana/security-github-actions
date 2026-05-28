import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { makeProgressCallback, __test } from '../src/progress.ts';
import type { ProgressEvent } from '../src/engine.ts';

// In-memory stream that records the chunks written to it. Mimics
// process.stderr.write semantics: returns boolean, ignores the encoding arg.
class CaptureStream {
  out: string[] = [];
  isTTY: boolean;
  constructor(isTty: boolean) {
    this.isTTY = isTty;
  }
  write(chunk: string): boolean {
    this.out.push(chunk);
    return true;
  }
  // The rest of NodeJS.WriteStream — we only ever touch write + isTTY.
}

test('describeDiscovery: singular vs plural, missing ecosystems', () => {
  assert.equal(__test.describeDiscovery(1, 0), '1 JS root');
  assert.equal(__test.describeDiscovery(3, 2), '3 JS roots, 2 Go roots');
  assert.equal(__test.describeDiscovery(0, 1), '1 Go root');
  assert.equal(__test.describeDiscovery(0, 0), 'no roots');
});

test('formatDuration: ms / sub-10s / 10s+ buckets', () => {
  assert.equal(__test.formatDuration(150), '150ms');
  assert.equal(__test.formatDuration(999), '999ms');
  assert.equal(__test.formatDuration(1000), '1.0s');
  assert.equal(__test.formatDuration(2750), '2.8s');
  assert.equal(__test.formatDuration(12500), '13s');
});

test('describeRoot: "." becomes "(repo root)"', () => {
  assert.equal(__test.describeRoot('.'), '(repo root)');
  assert.equal(__test.describeRoot('apps/frontend'), 'apps/frontend');
});

test('non-TTY callback: writes static lines for check-start and slow check-end', () => {
  const s = new CaptureStream(false);
  const cb = makeProgressCallback(s as unknown as NodeJS.WriteStream);
  const events: ProgressEvent[] = [
    { kind: 'discovery-start' },
    { kind: 'discovery-end', jsRoots: 1, goRoots: 0, durationMs: 42 },
    { kind: 'check-start', checkId: 'lockfile-committed', root: '.', index: 1, total: 2 },
    { kind: 'check-end', checkId: 'lockfile-committed', root: '.', durationMs: 12, findingCount: 0 },
    { kind: 'check-start', checkId: 'registry-audit', root: '.', index: 2, total: 2 },
    { kind: 'check-end', checkId: 'registry-audit', root: '.', durationMs: 2500, findingCount: 3 },
    { kind: 'done', durationMs: 2600 },
  ];
  for (const e of events) cb(e);
  const joined = s.out.join('');
  // Discovery + both starts appear
  assert.match(joined, /1 JS root/);
  assert.match(joined, /\[1\/2\] lockfile-committed/);
  assert.match(joined, /\[2\/2\] registry-audit/);
  // Slow check (>=1s) shows duration; fast check does not
  assert.match(joined, /registry-audit took 2\.5s/);
  assert.doesNotMatch(joined, /lockfile-committed took/);
  // No ANSI cursor-control sequences in static mode
  assert.doesNotMatch(joined, /\x1b\[2K/);
  assert.doesNotMatch(joined, /\r/);
});

test('TTY callback: uses cursor-control sequences and clears on done', () => {
  const s = new CaptureStream(true);
  const cb = makeProgressCallback(s as unknown as NodeJS.WriteStream);
  cb({ kind: 'check-start', checkId: 'foo', root: '.', index: 1, total: 1 });
  cb({ kind: 'check-end', checkId: 'foo', root: '.', durationMs: 50, findingCount: 0 });
  cb({ kind: 'done', durationMs: 60 });
  const joined = s.out.join('');
  // At least one in-place clear (\r\x1b[2K) was emitted
  assert.match(joined, /\r\x1b\[2K/);
});

test('TTY callback: slow check is "promoted" to a permanent line', () => {
  const s = new CaptureStream(true);
  const cb = makeProgressCallback(s as unknown as NodeJS.WriteStream);
  cb({ kind: 'check-start', checkId: 'registry-audit', root: '.', index: 1, total: 1 });
  cb({ kind: 'check-end', checkId: 'registry-audit', root: '.', durationMs: 2500, findingCount: 0 });
  const joined = s.out.join('');
  // The slow check completion writes a checkmark line with the duration
  assert.match(joined, /✓ registry-audit/);
  assert.match(joined, /2\.5s/);
});
