const { test } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { parseSearchResults, parseCompanyDetail, parseDirectors } = require('./asic');

const DETAIL_URL = 'https://connectonline.asic.gov.au/RegistrySearch/faces/landing/orgDetails.jspx?searchType=OrgAndBusNm&orgKey=616327863';

// -------------------------------------------------------------------
// parseSearchResults
// -------------------------------------------------------------------

function buildSearchHtml(rows) {
  const rowsHtml = rows
    .map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`)
    .join('');
  return `<html><body>
    <table>
      <thead><tr><th>Name</th><th>ACN / ABN</th><th>Type</th><th>Status</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </body></html>`;
}

test('parseSearchResults — returns matched row with valid 9-digit ACN', () => {
  const html = buildSearchHtml([
    ['Construction Victoria Pty Ltd', '616327863', 'Australian Proprietary Company', 'Registered'],
  ]);
  const $ = cheerio.load(html);
  const results = parseSearchResults($);

  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Construction Victoria Pty Ltd');
  assert.equal(results[0].acn, '616327863');
  assert.equal(results[0].type, 'Australian Proprietary Company');
  assert.equal(results[0].status, 'Registered');
  assert.match(results[0].url, /616327863/);
});

test('parseSearchResults — skips rows where ACN cell is not 9 digits', () => {
  const html = buildSearchHtml([
    ['Some Company', '12345', 'Proprietary', 'Registered'],        // too short
    ['Valid Co Pty Ltd', '123456789', 'Proprietary', 'Registered'], // valid
  ]);
  const $ = cheerio.load(html);
  const results = parseSearchResults($);

  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Valid Co Pty Ltd');
});

test('parseSearchResults — returns empty array when no matching table found', () => {
  const html = '<html><body><p>No results</p></body></html>';
  const $ = cheerio.load(html);
  const results = parseSearchResults($);
  assert.equal(results.length, 0);
});

test('parseSearchResults — stops after the first populated results table', () => {
  // Two tables that each qualify — should only parse the first
  const html = `<html><body>
    <table>
      <thead><tr><th>Name</th><th>ACN</th><th>Type</th><th>Status</th></tr></thead>
      <tbody><tr><td>Alpha Pty Ltd</td><td>111111111</td><td>Proprietary</td><td>Registered</td></tr></tbody>
    </table>
    <table>
      <thead><tr><th>Name</th><th>ACN</th><th>Type</th><th>Status</th></tr></thead>
      <tbody><tr><td>Beta Pty Ltd</td><td>222222222</td><td>Proprietary</td><td>Registered</td></tr></tbody>
    </table>
  </body></html>`;
  const $ = cheerio.load(html);
  const results = parseSearchResults($);
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Alpha Pty Ltd');
});

// -------------------------------------------------------------------
// parseCompanyDetail
// -------------------------------------------------------------------

function buildDetailHtml(dlPairs = [], tablePairs = []) {
  const dlHtml = dlPairs
    .map(([label, value]) => `<dt>${label}:</dt><dd>${value}</dd>`)
    .join('');
  const tableHtml = tablePairs
    .map(([label, value]) => `<tr><th>${label}</th><td>${value}</td></tr>`)
    .join('');
  return `<html><body><dl>${dlHtml}</dl><table>${tableHtml}</table></body></html>`;
}

test('parseCompanyDetail — extracts fields from dl/dt/dd pairs', () => {
  const html = buildDetailHtml([
    ['Status', 'Registered'],
    ['ACN', '616 327 863'],
    ['Date of registration', '01 Jan 2017'],
  ]);
  const $ = cheerio.load(html);
  const fields = parseCompanyDetail($);

  assert.equal(fields['Status'], 'Registered');
  assert.equal(fields['ACN'], '616 327 863');
  assert.equal(fields['Date of registration'], '01 Jan 2017');
});

test('parseCompanyDetail — extracts fields from th/td table rows', () => {
  const html = buildDetailHtml([], [
    ['Company type', 'Australian Proprietary Company'],
    ['Registered office', '123 Main St, Melbourne VIC 3000'],
  ]);
  const $ = cheerio.load(html);
  const fields = parseCompanyDetail($);

  assert.equal(fields['Company type'], 'Australian Proprietary Company');
  assert.equal(fields['Registered office'], '123 Main St, Melbourne VIC 3000');
});

test('parseCompanyDetail — returns empty object when no structured fields present', () => {
  const html = '<html><body><p>Nothing here</p></body></html>';
  const $ = cheerio.load(html);
  const fields = parseCompanyDetail($);
  assert.equal(Object.keys(fields).length, 0);
});

// -------------------------------------------------------------------
// parseDirectors
// -------------------------------------------------------------------

function buildDirectorsHtml(rows) {
  const rowsHtml = rows
    .map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`)
    .join('');
  return `<html><body>
    <table>
      <thead><tr><th>Officer name</th><th>Role</th><th>Appointed</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </body></html>`;
}

test('parseDirectors — returns director rows', () => {
  const html = buildDirectorsHtml([
    ['Jane Smith', 'Director', '01 Jan 2017'],
    ['Bob Jones', 'Secretary', '15 Mar 2018'],
  ]);
  const $ = cheerio.load(html);
  const directors = parseDirectors($, DETAIL_URL);

  assert.equal(directors.length, 1);
  assert.equal(directors[0].title, 'Jane Smith');
  assert.equal(directors[0].metadata.Role, 'Director');
  assert.equal(directors[0].metadata['Appointment Date'], '01 Jan 2017');
  assert.equal(directors[0].url, DETAIL_URL);
});

test('parseDirectors — returns empty array when no directors in table', () => {
  const html = buildDirectorsHtml([
    ['Bob Jones', 'Secretary', '15 Mar 2018'],
  ]);
  const $ = cheerio.load(html);
  const directors = parseDirectors($, DETAIL_URL);
  assert.equal(directors.length, 0);
});

test('parseDirectors — returns empty array when no officer table present', () => {
  const html = '<html><body><p>No officers</p></body></html>';
  const $ = cheerio.load(html);
  const directors = parseDirectors($, DETAIL_URL);
  assert.equal(directors.length, 0);
});

test('parseDirectors — captures multiple directors', () => {
  const html = buildDirectorsHtml([
    ['Jane Smith', 'Director', '01 Jan 2017'],
    ['Alice Brown', 'Director', '10 Feb 2019'],
    ['Bob Jones', 'Secretary', '15 Mar 2018'],
  ]);
  const $ = cheerio.load(html);
  const directors = parseDirectors($, DETAIL_URL);
  assert.equal(directors.length, 2);
  assert.equal(directors[0].title, 'Jane Smith');
  assert.equal(directors[1].title, 'Alice Brown');
});
