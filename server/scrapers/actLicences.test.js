'use strict';

// DATA_SOURCES_PLAN.md Phase 0 — the ACT registers report an out-of-date cached copy as stale
// (with its date) and a missing one as an error, never as a clean "nothing found".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchACTLicences, searchACTDisciplinary } = require('./actLicences');

const cachedAt = new Date('2026-10-01T00:00:00Z');
const reader = (stale) => async () => ({ records: [], stale, cachedAt });
const missing = async () => {
  throw new Error('no cache');
};

test('searchACTLicences — stale copy marked stale, fresh copy not, missing copy an error', async () => {
  assert.equal((await searchACTLicences('Acme Pty Ltd', '', [], reader(false))).completeness, undefined);
  const old = await searchACTLicences('Acme Pty Ltd', '', [], reader(true));
  assert.equal(old.completeness, 'stale');
  assert.equal(old.asOf, cachedAt.toISOString());
  assert.equal((await searchACTLicences('Acme Pty Ltd', '', [], missing)).status, 'error');
});

test('searchACTDisciplinary — stale copy marked stale, fresh copy not, missing copy an error', async () => {
  assert.equal((await searchACTDisciplinary('Acme Pty Ltd', '', [], reader(false))).completeness, undefined);
  const old = await searchACTDisciplinary('Acme Pty Ltd', '', [], reader(true));
  assert.equal(old.completeness, 'stale');
  assert.equal((await searchACTDisciplinary('Acme Pty Ltd', '', [], missing)).status, 'error');
});
