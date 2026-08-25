const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isNameMatch, normalise, buildSearchUrl } = require('./asicDisqualified');

// -------------------------------------------------------------------
// The live-scrape functions previously tested here (searchASICDisqualified,
// checkDirector, parseDisqualifiedResults) were retired 2026-08-19 — see
// asicDpnMatch.test.js for the current dataset-backed equivalents, which cover
// the same matching behaviour (case-insensitivity, surname-first format,
// subset matching) via buildResultsForDirector.
// -------------------------------------------------------------------

test('normalise — lowercases and strips punctuation, keeps whitespace', () => {
  assert.equal(normalise('Roberts, Veronica Mary!'), 'roberts veronica mary');
});

test('normalise — handles null/undefined/empty input', () => {
  assert.equal(normalise(null), '');
  assert.equal(normalise(undefined), '');
  assert.equal(normalise(''), '');
});

test('isNameMatch — order-independent match, handles ASIC surname-first format', () => {
  assert.equal(isNameMatch('ROBERTS Veronica', 'Veronica Roberts'), true);
});

test('isNameMatch — case-insensitive', () => {
  assert.equal(isNameMatch('SMITH JOHN', 'john smith'), true);
});

test('isNameMatch — query name as a subset of a longer register name matches', () => {
  assert.equal(isNameMatch('Smith, John Robert', 'John Smith'), true);
});

test('isNameMatch — different person does not match', () => {
  assert.equal(isNameMatch('Brown, Alice', 'John Smith'), false);
});

test('isNameMatch — empty query never matches', () => {
  assert.equal(isNameMatch('Smith, John', ''), false);
});

test('buildSearchUrl — encodes the name into the ASIC Connect DPN search URL', () => {
  const url = buildSearchUrl('Veronica Roberts');
  assert.match(url, /^https:\/\/connectonline\.asic\.gov\.au\/RegistrySearch\/faces\/landing\/panelSearch\.jspx\?searchType=DPNm&searchText=/);
  assert.match(url, /Veronica%20Roberts/);
});
