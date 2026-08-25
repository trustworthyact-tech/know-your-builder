const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchASICDisqualifiedFromDataset, buildResultsForDirector } = require('./asicDpnMatch');

function row(name, type, docNum, startDt, endDt, local, state) {
  return {
    REGISTER_NAME: 'Banned and Disqualified Persons',
    BD_PER_NAME: name,
    BD_PER_TYPE: type,
    BD_PER_DOC_NUM: docNum,
    BD_PER_START_DT: startDt,
    BD_PER_END_DT: endDt,
    BD_PER_ADD_LOCAL: local || '',
    BD_PER_ADD_STATE: state || '',
    BD_PER_ADD_PCODE: '',
    BD_PER_ADD_COUNTRY: 'AUSTRALIA',
    BD_PER_COMMENTS: 'No comment made',
  };
}

// -------------------------------------------------------------------
// buildResultsForDirector — pure matching/grouping logic, no I/O
// -------------------------------------------------------------------

test('buildResultsForDirector — matches a plain name', () => {
  const rows = [row('SMITH, JOHN', 'Disq. Director', '#001', '01/01/2023', '01/01/2026')];
  const results = buildResultsForDirector(rows, 'John Smith');
  assert.equal(results.length, 1);
  assert.match(results[0].title, /SMITH, JOHN/);
  assert.equal(results[0].status, 'Disqualified');
  assert.equal(results[0].metadata['Director Name'], 'SMITH, JOHN');
  assert.equal(results[0].metadata['Order Date'], '01/01/2023');
  assert.equal(results[0].metadata['Expiry Date'], '01/01/2026');
  assert.equal(results[0].metadata.Type, 'Disq. Director');
  assert.match(results[0].date, /Order expires: 01\/01\/2026/);
});

test('buildResultsForDirector — surname-first CSV format still matches given-name-first query (isNameMatch reused unchanged)', () => {
  const rows = [row('ROBERTS, VERONICA MARY', 'Disq. Director', '#031925499', '03/09/2025', '02/09/2030', 'TULLAMARINE', 'VIC')];
  const results = buildResultsForDirector(rows, 'Veronica Roberts');
  assert.equal(results.length, 1);
});

test('buildResultsForDirector — case-insensitive', () => {
  const rows = [row('SMITH, JOHN', 'Disq. Director', '#001', '01/01/2023', '01/01/2026')];
  const results = buildResultsForDirector(rows, 'john smith');
  assert.equal(results.length, 1);
});

test('buildResultsForDirector — no match returns empty array', () => {
  const rows = [row('BROWN, ALICE', 'Disq. Director', '#001', '01/01/2023', '01/01/2026')];
  const results = buildResultsForDirector(rows, 'John Smith');
  assert.equal(results.length, 0);
});

test('buildResultsForDirector — surfaces all ban types, not just Disq. Director', () => {
  const rows = [
    row('SMITH, JOHN', 'Disq. Director', '#001', '01/01/2020', '01/01/2025'),
    row('SMITH, JOHN', 'Banned Securities', '#002', '01/01/2020', '01/01/2025'),
    row('SMITH, JOHN', 'Credit Banned & Disqualified', '#003', '01/01/2020', '01/01/2025'),
    row('SMITH, JOHN', 'AFS Banned & Disqualified', '#004', '01/01/2020', '01/01/2025'),
  ];
  const results = buildResultsForDirector(rows, 'John Smith');
  assert.equal(results.length, 4);
  const types = results.map((r) => r.metadata.Type).sort();
  assert.deepEqual(types, ['AFS Banned & Disqualified', 'Banned Securities', 'Credit Banned & Disqualified', 'Disq. Director']);
});

test('buildResultsForDirector — groups multiple rows sharing a doc number into a single result', () => {
  // Mirrors the real Veronica Roberts case: 4 CSV rows, same order, different name
  // spelling/address variants — decided 2026-08-19 to collapse to 1 result, not 4.
  const rows = [
    row('HODGERS ROBERTS, VERONICA MARY', 'Disq. Director', '#031925499', '03/09/2025', '02/09/2030', 'TULLAMARINE', 'VIC'),
    row('ROBERTS, VERONICA MARY', 'Disq. Director', '#031925499', '03/09/2025', '02/09/2030', 'TULLAMARINE', 'VIC'),
    row('ROBERTS, VERONICA MARY', 'Disq. Director', '#031925499', '03/09/2025', '02/09/2030', 'TAYLORS LAKES', 'VIC'),
    row('ROBERTS, VERONICA', 'Disq. Director', '#031925499', '03/09/2025', '02/09/2030', 'TULLAMARINE', 'VIC'),
  ];
  const results = buildResultsForDirector(rows, 'Veronica Roberts');
  assert.equal(results.length, 1);
  assert.equal(results[0].metadata['Director Name'], 'HODGERS ROBERTS, VERONICA MARY');
  // Exact-equality, not substring matching: "ROBERTS, VERONICA" is itself a prefix
  // of "ROBERTS, VERONICA MARY", so a substring/regex check here would pass even if
  // the shorter variant were never actually listed as its own distinct entry.
  assert.equal(results[0].metadata['Also Known As'], 'ROBERTS, VERONICA MARY; ROBERTS, VERONICA');
  assert.match(results[0].metadata['Known Addresses'], /TULLAMARINE/);
  assert.match(results[0].metadata['Known Addresses'], /TAYLORS LAKES/);
});

test('buildResultsForDirector — no grouping (no AKA/addresses metadata) when only one row matches', () => {
  const rows = [row('SMITH, JOHN', 'Disq. Director', '#001', '01/01/2023', '01/01/2026', 'PERTH', 'WA')];
  const results = buildResultsForDirector(rows, 'John Smith');
  assert.equal(results[0].metadata['Also Known As'], undefined);
  assert.equal(results[0].metadata['Known Addresses'], undefined);
});

// -------------------------------------------------------------------
// searchASICDisqualifiedFromDataset — orchestration, dataset access mocked
// -------------------------------------------------------------------

test('searchASICDisqualifiedFromDataset — empty directors returns appropriate message', async () => {
  const result = await searchASICDisqualifiedFromDataset([]);
  assert.equal(result.results.length, 0);
  assert.match(result.summary, /No directors identified/);
  assert.equal(result.source, 'ASIC — Disqualified Persons Register');
  assert.equal(result.jurisdiction, 'Federal');
  assert.equal(result.category, 'identity');
});

test('searchASICDisqualifiedFromDataset — null directors returns appropriate message', async () => {
  const result = await searchASICDisqualifiedFromDataset(null);
  assert.equal(result.results.length, 0);
  assert.match(result.summary, /No directors identified/);
});

test('searchASICDisqualifiedFromDataset — dataset unavailable is reported honestly, not as a false clean', async () => {
  const fakeFetch = async () => { throw new Error('no cache, live fetch failed'); };
  const result = await searchASICDisqualifiedFromDataset(['Veronica Roberts'], fakeFetch);
  assert.equal(result.results.length, 0);
  assert.match(result.summary, /register data unavailable/);
  assert.doesNotMatch(result.summary, /no disqualification records found/);
});

test('searchASICDisqualifiedFromDataset — genuine match found end-to-end', async () => {
  const rows = [row('ROBERTS, VERONICA MARY', 'Disq. Director', '#031925499', '03/09/2025', '02/09/2030', 'TULLAMARINE', 'VIC')];
  const fakeFetch = async () => ({ rows, stale: false, cachedAt: new Date() });
  const result = await searchASICDisqualifiedFromDataset(['Veronica Roberts'], fakeFetch);
  assert.equal(result.results.length, 1);
  assert.match(result.summary, /1 director\(s\) found/);
});

test('searchASICDisqualifiedFromDataset — genuine clean reads as "no records found", not unavailable', async () => {
  const fakeFetch = async () => ({ rows: [row('BROWN, ALICE', 'Disq. Director', '#001', '01/01/2023', '01/01/2026')], stale: false, cachedAt: new Date() });
  const result = await searchASICDisqualifiedFromDataset(['Veronica Roberts'], fakeFetch);
  assert.equal(result.results.length, 0);
  assert.match(result.summary, /no disqualification records found/);
});

test('searchASICDisqualifiedFromDataset — stale cache is noted in the summary, not hidden', async () => {
  const rows = [row('ROBERTS, VERONICA MARY', 'Disq. Director', '#031925499', '03/09/2025', '02/09/2030', 'TULLAMARINE', 'VIC')];
  const cachedAt = new Date('2026-08-10');
  const fakeFetch = async () => ({ rows, stale: true, cachedAt });
  const result = await searchASICDisqualifiedFromDataset(['Veronica Roberts'], fakeFetch);
  assert.equal(result.results.length, 1);
  assert.match(result.summary, /may be a few days old/);
});

test('searchASICDisqualifiedFromDataset — no artificial director cap (live scrape capped at 6, dataset lookup does not)', async () => {
  // Live scrape capped at 6 directors because each cost a real captcha solve. A
  // dataset lookup is effectively free, so all 8 supplied names here get checked —
  // this fixture only has a match for the 8th name, which the old cap would have
  // silently dropped.
  const names = ['A One', 'B Two', 'C Three', 'D Four', 'E Five', 'F Six', 'G Seven', 'Veronica Roberts'];
  const rows = [row('ROBERTS, VERONICA MARY', 'Disq. Director', '#031925499', '03/09/2025', '02/09/2030', 'TULLAMARINE', 'VIC')];
  const fakeFetch = async () => ({ rows, stale: false, cachedAt: new Date() });
  const result = await searchASICDisqualifiedFromDataset(names, fakeFetch);
  assert.equal(result.results.length, 1);
});
