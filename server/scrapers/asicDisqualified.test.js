const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchASICDisqualified, parseDisqualifiedResults } = require('./asicDisqualified');
const { row, table } = require('../tests/fixtures/adfDpnRow');

// -------------------------------------------------------------------
// parseDisqualifiedResults — pure function, no I/O
//
// Fixture matches ASIC Connect's real ADF DPN table markup (see
// server/tests/fixtures/adfDpnRow.js) — a flat <td> list does not reflect
// what the live register returns and previously caused every "should match"
// case here to silently return zero results.
// -------------------------------------------------------------------

const SEARCH_URL = 'https://connectonline.asic.gov.au/RegistrySearch/faces/landing/panelSearch.jspx?searchType=DPNm&searchText=John+Smith';

test('parseDisqualifiedResults — returns matching row when name matches', () => {
  const html = table(
    row('DPN001', 'John Smith', 'Disqualified Person Notice', '01 Jan 2023', '01 Jan 2026', 'Melbourne VIC')
  );
  const results = parseDisqualifiedResults(html, 'John Smith', SEARCH_URL);

  assert.equal(results.length, 1);
  assert.match(results[0].title, /John Smith/);
  assert.equal(results[0].status, 'Disqualified');
  assert.equal(results[0].metadata['Order Date'], '01 Jan 2023');
  assert.equal(results[0].metadata['Expiry Date'], '01 Jan 2026');
  assert.equal(results[0].metadata['Type'], 'Disqualified Person Notice');
  assert.match(results[0].date, /Order expires: 01 Jan 2026/);
});

test('parseDisqualifiedResults — uses order date in date field when no expiry date', () => {
  const html = table(
    row('DPN002', 'Jane Doe', 'Disqualified Person Notice', '15 Mar 2022', '', 'Sydney NSW')
  );
  const results = parseDisqualifiedResults(html, 'Jane Doe', SEARCH_URL);
  assert.equal(results.length, 1);
  assert.equal(results[0].date, '15 Mar 2022');
});

test('parseDisqualifiedResults — skips rows that do not match the query name', () => {
  const html = table(
    row('DPN003', 'Alice Brown', 'Disqualified Person Notice', '01 Jan 2023', '01 Jan 2026', 'Perth WA'),
    row('DPN004', 'John Smith', 'Disqualified Person Notice', '10 Feb 2023', '10 Feb 2026', 'Melbourne VIC')
  );
  const results = parseDisqualifiedResults(html, 'John Smith', SEARCH_URL);
  assert.equal(results.length, 1);
  assert.match(results[0].title, /John Smith/);
});

test('parseDisqualifiedResults — returns empty array when no matching rows', () => {
  const html = table(
    row('DPN005', 'Alice Brown', 'Disqualified Person Notice', '01 Jan 2023', '01 Jan 2026', 'Perth WA')
  );
  const results = parseDisqualifiedResults(html, 'John Smith', SEARCH_URL);
  assert.equal(results.length, 0);
});

test('parseDisqualifiedResults — returns empty array when table has no rows', () => {
  const html = '<html><body><table><thead></thead><tbody></tbody></table></body></html>';
  const results = parseDisqualifiedResults(html, 'John Smith', SEARCH_URL);
  assert.equal(results.length, 0);
});

test('parseDisqualifiedResults — uses fallback description when address cell is empty', () => {
  const html = table(
    row('DPN006', 'John Smith', 'Disqualified Person Notice', '01 Jan 2023', '01 Jan 2026', '')
  );
  const results = parseDisqualifiedResults(html, 'John Smith', SEARCH_URL);
  assert.equal(results.length, 1);
  assert.match(results[0].description, /ASIC Disqualified Persons Register/);
});

test('parseDisqualifiedResults — name match is case-insensitive', () => {
  const html = table(
    row('DPN007', 'JOHN SMITH', 'Disqualified Person Notice', '01 Jan 2023', '01 Jan 2026', 'Melbourne VIC')
  );
  const results = parseDisqualifiedResults(html, 'john smith', SEARCH_URL);
  assert.equal(results.length, 1);
});

test('parseDisqualifiedResults — matches when query name is a subset of a longer register name', () => {
  const html = table(
    row('DPN008', 'Smith, John Robert', 'Disqualified Person Notice', '01 Jan 2023', '01 Jan 2026', 'Melbourne VIC')
  );
  // isNameMatch is order-independent word-set matching (see asicDisqualified.js):
  // every word in the query must appear in the result's word set. Both "john" and
  // "smith" appear in "Smith, John Robert" (middle name aside), so this matches.
  const results = parseDisqualifiedResults(html, 'John Smith', SEARCH_URL);
  assert.equal(results.length, 1);
});

// -------------------------------------------------------------------
// searchASICDisqualified — unit tests for pure-logic paths
// -------------------------------------------------------------------

test('searchASICDisqualified — empty directors returns appropriate message', async () => {
  const result = await searchASICDisqualified([]);
  assert.equal(result.results.length, 0);
  assert.match(result.summary, /No directors identified/);
  assert.equal(result.source, 'ASIC — Disqualified Persons Register');
  assert.equal(result.jurisdiction, 'Federal');
  assert.equal(result.category, 'identity');
});

test('searchASICDisqualified — null directors returns appropriate message', async () => {
  const result = await searchASICDisqualified(null);
  assert.equal(result.results.length, 0);
  assert.match(result.summary, /No directors identified/);
});

test('searchASICDisqualified — no captcha key returns graceful degradation message', async () => {
  const result = await searchASICDisqualified(['John Smith', 'Jane Doe'], undefined);
  assert.equal(result.results.length, 0);
  assert.match(result.summary, /automated check unavailable/);
  assert.match(result.summary, /verify manually/);
  assert.match(result.summary, /2 director/);
});

test('searchASICDisqualified — no captcha key with empty string also degrades gracefully', async () => {
  const result = await searchASICDisqualified(['John Smith'], '');
  assert.equal(result.results.length, 0);
  assert.match(result.summary, /automated check unavailable/);
});
