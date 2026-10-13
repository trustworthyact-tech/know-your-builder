'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nameMatchesEntity } = require('./asicEnforceableUndertakings');

// Regression guard for the 2026-09-14 fix — same shared filter shape and same bug as
// modernSlavery.js's isEntityMatch (see that file's test for the full root-cause writeup):
// a company name whose only word is exactly 3 characters (BHP, NAB, ANZ...) left zero
// "distinctive" words at the old > 3 threshold, silently matching nothing. Fixed to > 2.

test('nameMatchesEntity — a 3-character company name (e.g. "BHP") matches its own name, not silently rejected', () => {
  assert.equal(nameMatchesEntity('BHP Group Limited — Court Enforceable Undertaking', 'BHP'), true);
});

test('nameMatchesEntity — a 3-character name still does not match unrelated record text', () => {
  assert.equal(nameMatchesEntity('Woolworths Group Limited — Court Enforceable Undertaking', 'BHP'), false);
});

test('nameMatchesEntity — still rejects a 1-2 character fragment as too short to be distinctive', () => {
  assert.equal(nameMatchesEntity('A Co Pty Ltd — Court Enforceable Undertaking', 'A'), false);
});

test('nameMatchesEntity — a multi-word name is phrase-anchored, not "every word present anywhere"', () => {
  assert.equal(nameMatchesEntity('Kane Constructions Pty Ltd — Court Enforceable Undertaking', 'Kane Constructions'), true);
  assert.equal(
    nameMatchesEntity('Kane Smith and Constructions Holdings Pty Ltd — Court Enforceable Undertaking', 'Kane Constructions'),
    false
  );
});

// DATA_SOURCES_PLAN.md Phase 0 — an out-of-date cached copy is marked stale, with its date.
const { searchAsicEnforceableUndertakings } = require('./asicEnforceableUndertakings');

test('searchAsicEnforceableUndertakings — a stale cached copy sets completeness stale; a fresh one does not', async () => {
  const cachedAt = new Date('2026-10-01T00:00:00Z');
  const fresh = await searchAsicEnforceableUndertakings('Acme Pty Ltd', [], async () => ({ records: [], stale: false, cachedAt: new Date() }));
  assert.equal(fresh.completeness, undefined);
  const old = await searchAsicEnforceableUndertakings('Acme Pty Ltd', [], async () => ({ records: [], stale: true, cachedAt }));
  assert.equal(old.completeness, 'stale');
  assert.equal(old.asOf, cachedAt.toISOString());
});

test('searchAsicEnforceableUndertakings — no data at all is an error, not "no undertakings found"', async () => {
  const out = await searchAsicEnforceableUndertakings('Acme Pty Ltd', [], async () => { throw new Error('no cache'); });
  assert.equal(out.status, 'error');
});
