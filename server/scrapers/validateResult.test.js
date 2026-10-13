'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertValidResult, staleFields } = require('./validateResult');

test('assertValidResult — an error result defaults to unavailable, a normal one to complete', () => {
  assert.equal(assertValidResult('k', { status: 'error', results: [], summary: 'x' }).completeness, 'unavailable');
  assert.equal(assertValidResult('k', { results: [], summary: 'x' }).completeness, 'complete');
});

test('staleFields — only a stale copy is marked, with its date; the result overrides the default', () => {
  assert.deepEqual(staleFields(false, new Date()), {});
  const at = new Date('2026-10-01T00:00:00Z');
  assert.deepEqual(staleFields(true, at), { completeness: 'stale', asOf: at.toISOString() });
  assert.deepEqual(staleFields(true, null), { completeness: 'stale' });
  const out = assertValidResult('k', { results: [], summary: 'x', ...staleFields(true, at) });
  assert.equal(out.completeness, 'stale');
  assert.equal(out.asOf, at.toISOString());
});
