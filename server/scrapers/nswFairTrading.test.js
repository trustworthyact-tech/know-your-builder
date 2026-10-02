'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nameMatchesEntity } = require('./nswFairTrading');

// Regression guard for the 2026-10-02 fix — see actLicences.test.js for the full
// root-cause writeup (same duplicated helper, same bug, found via the same real "CJC
// Management Services" search). Fixed > 3 to > 2.

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
