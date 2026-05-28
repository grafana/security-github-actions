import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { valueMeetsRequirement } from '../../src/js/_config-helpers.ts';

test('eq mode: strict string equality', () => {
  assert.ok(valueMeetsRequirement('true', 'true', 'eq'));
  assert.ok(!valueMeetsRequirement('false', 'true', 'eq'));
  assert.ok(!valueMeetsRequirement('TRUE', 'true', 'eq'), 'case-sensitive');
});

test('min-int mode: equal-or-greater integers pass', () => {
  assert.ok(valueMeetsRequirement('4320', '4320', 'min-int'));
  assert.ok(valueMeetsRequirement('10080', '4320', 'min-int'), 'higher = stricter = ok');
  assert.ok(!valueMeetsRequirement('1440', '4320', 'min-int'), 'lower = less strict = fail');
  assert.ok(!valueMeetsRequirement('0', '4320', 'min-int'));
});

test('min-int mode: non-integer actual fails', () => {
  assert.ok(!valueMeetsRequirement('true', '4320', 'min-int'));
  assert.ok(!valueMeetsRequirement('', '4320', 'min-int'));
  assert.ok(!valueMeetsRequirement('NaN', '4320', 'min-int'));
});

test('min-int mode: leading digits accepted, trailing garbage tolerated by parseInt', () => {
  // parseInt('4320 minutes', 10) is 4320. We accept this — the parser pulls
  // the leading integer. If folks ever quote the value like `"4320"` we still
  // see '4320' after stripQuotes, so this matters less than it might seem.
  assert.ok(valueMeetsRequirement('4320 minutes', '4320', 'min-int'));
});
