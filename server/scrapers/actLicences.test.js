'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nameMatchesEntity } = require('./actLicences');

// Regression guard for the 2026-10-02 fix — same shared filter shape and same bug as
// modernSlavery.js's isEntityMatch (see that file's test for the full root-cause writeup):
// a company name whose only word is exactly 3 characters (CJC, BHP, NAB...) left zero
// "distinctive" words at the old > 3 threshold, so the match fell through to requiring
// only the remaining common words. Found live via a real "CJC Management Services Pty
// Ltd" search, which — before this fix — matched the unrelated ACT licensee "All Class
// Building & Management Services" on "management"/"services" alone, pulling that
// company's partner ("Shaun West") into resolveDirectors() and spraying his name across
// every other director-dependent search. Fixed to > 2.

test('nameMatchesEntity — a 3-character company name (e.g. "CJC") requires its own distinctive word, not just common words', () => {
  assert.equal(
    nameMatchesEntity('All Class Building & Management Services Pty Limited', 'CJC Management Services'),
    false
  );
});

test('nameMatchesEntity — a 3-character company name still matches its own real name', () => {
  assert.equal(nameMatchesEntity('CJC Management Services Pty Ltd', 'CJC Management Services'), true);
});

test('nameMatchesEntity — still rejects a 1-2 character fragment as too short to be distinctive', () => {
  assert.equal(nameMatchesEntity('A Co Pty Ltd', 'A'), false);
});

test('nameMatchesEntity — a parenthesised token still matches via punctuation stripping (2026-09-09 fix, unaffected by this change)', () => {
  assert.equal(nameMatchesEntity('Geocon Constructors (ACT) Pty Ltd', 'Geocon Constructors (ACT) Pty Ltd'), true);
});
