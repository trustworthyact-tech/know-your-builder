'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isEntityMatch } = require('./modernSlavery');

// Regression guard for the 2026-09-14 fix: found via a live "BHP" search returning zero
// results despite BHP having real, current statements on the register. Root cause was the
// word-length filter requiring > 3 chars — a name whose only word is exactly 3 characters
// left zero "distinctive" words, so isEntityMatch always returned false. Fixed to > 2,
// matching courtRecords.js's titleMatchesTerm.

test('isEntityMatch — a 3-character company name (e.g. "BHP") matches its own name, not silently rejected', () => {
  assert.equal(isEntityMatch('BHP Group Limited (49 004 028 077)', 'BHP', ''), true);
});

test('isEntityMatch — a 3-character name still does not match unrelated entity text', () => {
  assert.equal(isEntityMatch('Woolworths Group Limited (88 000 014 675)', 'BHP', ''), false);
});

test('isEntityMatch — still rejects a 1-2 character fragment as too short to be distinctive', () => {
  // "A" alone strips to zero distinctive words either way — the fix only moves the bar
  // from >3 to >2, it doesn't remove the floor entirely.
  assert.equal(isEntityMatch('A Co Pty Ltd (12 345 678 901)', 'A', ''), false);
});

test('isEntityMatch — a multi-word name still requires every distinctive word present', () => {
  assert.equal(isEntityMatch('Acme Constructions Pty Ltd (11 111 111 111)', 'Acme Constructions', ''), true);
  assert.equal(isEntityMatch('Acme Holdings Pty Ltd (11 111 111 111)', 'Acme Constructions', ''), false);
});

test('isEntityMatch — an ABN match is definitive regardless of name', () => {
  // isEntityMatch strips spaces from the supplied `abn` before comparing, but does not
  // strip them from the entity text itself — the text must already contain the ABN as an
  // unspaced digit run for this path to fire (confirmed against the real code, not assumed).
  assert.equal(isEntityMatch('Some Entity (ABN 49004028077)', 'Completely Different Name', '49 004 028 077'), true);
});
