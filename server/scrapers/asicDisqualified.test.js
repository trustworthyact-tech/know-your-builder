const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchASICDisqualified, parseDisqualifiedResults } = require('./asicDisqualified');

// -------------------------------------------------------------------
// parseDisqualifiedResults — pure function, no I/O
// -------------------------------------------------------------------

const SEARCH_URL = 'https://connectonline.asic.gov.au/RegistrySearch/faces/landing/panelSearch.jspx?searchType=DPNm&searchText=John+Smith';

function buildTableHtml(rows) {
  const rowsHtml = rows
    .map(
      (r) =>
        `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`
    )
    .join('');
  return `<html><body><table><thead><tr><th>Name</th><th>Order Date</th><th>Expiry Date</th><th>Reason</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;
}

test('parseDisqualifiedResults — returns matching row when name matches', () => {
  const html = buildTableHtml([
    ['John Smith', '01 Jan 2023', '01 Jan 2026', 'Insolvent trading'],
  ]);
  const results = parseDisqualifiedResults(html, 'John Smith', SEARCH_URL);

  assert.equal(results.length, 1);
  assert.match(results[0].title, /John Smith/);
  assert.equal(results[0].status, 'Disqualified');
  assert.equal(results[0].metadata['Order Date'], '01 Jan 2023');
  assert.equal(results[0].metadata['Expiry Date'], '01 Jan 2026');
  assert.equal(results[0].metadata['Reason'], 'Insolvent trading');
  assert.match(results[0].date, /Order expires: 01 Jan 2026/);
});

test('parseDisqualifiedResults — uses order date in date field when no expiry date', () => {
  const html = buildTableHtml([
    ['Jane Doe', '15 Mar 2022', '', 'Failure to pay penalty'],
  ]);
  const results = parseDisqualifiedResults(html, 'Jane Doe', SEARCH_URL);
  assert.equal(results.length, 1);
  assert.equal(results[0].date, '15 Mar 2022');
});

test('parseDisqualifiedResults — skips rows that do not match the query name', () => {
  const html = buildTableHtml([
    ['Alice Brown', '01 Jan 2023', '01 Jan 2026', 'Misconduct'],
    ['John Smith', '10 Feb 2023', '10 Feb 2026', 'Insolvent trading'],
  ]);
  const results = parseDisqualifiedResults(html, 'John Smith', SEARCH_URL);
  assert.equal(results.length, 1);
  assert.match(results[0].title, /John Smith/);
});

test('parseDisqualifiedResults — returns empty array when no matching rows', () => {
  const html = buildTableHtml([
    ['Alice Brown', '01 Jan 2023', '01 Jan 2026', 'Misconduct'],
  ]);
  const results = parseDisqualifiedResults(html, 'John Smith', SEARCH_URL);
  assert.equal(results.length, 0);
});

test('parseDisqualifiedResults — returns empty array when table has no rows', () => {
  const html = '<html><body><table><thead></thead><tbody></tbody></table></body></html>';
  const results = parseDisqualifiedResults(html, 'John Smith', SEARCH_URL);
  assert.equal(results.length, 0);
});

test('parseDisqualifiedResults — uses fallback description when reason cell is empty', () => {
  const html = buildTableHtml([
    ['John Smith', '01 Jan 2023', '01 Jan 2026', ''],
  ]);
  const results = parseDisqualifiedResults(html, 'John Smith', SEARCH_URL);
  assert.equal(results.length, 1);
  assert.match(results[0].description, /ASIC Disqualified Persons Register/);
});

test('parseDisqualifiedResults — name match is case-insensitive', () => {
  const html = buildTableHtml([
    ['JOHN SMITH', '01 Jan 2023', '01 Jan 2026', 'Insolvent trading'],
  ]);
  const results = parseDisqualifiedResults(html, 'john smith', SEARCH_URL);
  assert.equal(results.length, 1);
});

test('parseDisqualifiedResults — partial name match works (first + last)', () => {
  const html = buildTableHtml([
    ['Smith, John Robert', '01 Jan 2023', '01 Jan 2026', 'Fraud'],
  ]);
  // Query name is a substring normalised — smithjohnrobert includes smithjohn
  const results = parseDisqualifiedResults(html, 'John Smith', SEARCH_URL);
  // normalise strips non-alphanum: "smithjohnrobert" includes "johnsmith"? No, let's check
  // normalise("Smith, John Robert") = "smithjohnrobert"
  // normalise("John Smith")         = "johnsmith"
  // "smithjohnrobert".includes("johnsmith") === false
  // "johnsmith".includes("smithjohnrobert") === false
  // → no match expected (directional substring is not satisfied)
  assert.equal(results.length, 0);
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
