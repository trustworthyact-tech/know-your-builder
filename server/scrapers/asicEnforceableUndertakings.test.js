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
