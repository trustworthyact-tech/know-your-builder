'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchNSWFairTrading, fetchNswCompanyLookup } = require('./nswFairTrading');

// Regression guard for the 2026-09-22 fix: ScraperAPI's monthly credits were exhausted in
// production, so every fetchLicences() call started throwing a 403 — but the bare
// `catch { // non-fatal }` this replaced swallowed it silently, so a real licensed company
// (Universal Property Group, licence 85273C) reported "No NSW Fair Trading contractor
// licence records found" as a plain 'done' result — a false-clean result indistinguishable
// from an honest "checked, found nothing". Fixed by tracking `failed` per query and rolling
// it up into `completeness`/`status`, mirroring courtRecords.js's runJurisdictionSearch
// allFailed/anyFailed shape. These tests inject a fake `fetchLicences` (same `_fetchX`
// injectable-dependency convention as asic.js/asicDpnMatch.js) so the failure path is
// exercised deterministically, without a real ScraperAPI outage.

function rejectingFetch(err) {
  return async () => {
    throw err;
  };
}

test('searchNSWFairTrading — a live fetch failure reports an honest error, not a fabricated clean result', async () => {
  const result = await searchNSWFairTrading(
    'Universal Property Group Pty Limited',
    '',
    [],
    null,
    rejectingFetch(new Error('Request failed with status code 403'))
  );

  assert.equal(result.status, 'error');
  assert.equal(result.completeness, 'unavailable');
  assert.deepEqual(result.results, []);
  assert.match(result.summary, /could not complete/i);
});

test('searchNSWFairTrading — a successful primary query with a failed director query is marked partial, not silently clean', async () => {
  let call = 0;
  const fetchLicences = async (query) => {
    call += 1;
    if (call === 1) {
      return [{ licensee: 'UNIVERSAL PROPERTY GROUP PTY LIMITED', licenceNumber: '85273C', status: 'Current' }];
    }
    throw new Error('Request failed with status code 403');
  };

  const result = await searchNSWFairTrading(
    'Universal Property Group Pty Limited',
    '',
    ['Bhart Bhushan'],
    null,
    fetchLicences
  );

  assert.notEqual(result.status, 'error');
  assert.equal(result.completeness, 'partial');
  assert.equal(result.results.length, 1);
  assert.match(result.summary, /search incomplete/i);
});

test('searchNSWFairTrading — reuses a failed preFetchedPrimary result and still reports honestly', async () => {
  const preFetchedPrimary = { items: [], associatedNames: [], seen: new Set(), failed: true };

  const result = await searchNSWFairTrading(
    'Universal Property Group Pty Limited',
    '',
    [],
    preFetchedPrimary,
    rejectingFetch(new Error('should not be called — preFetchedPrimary already failed'))
  );

  assert.equal(result.status, 'error');
  assert.equal(result.completeness, 'unavailable');
});

test('searchNSWFairTrading — no failures at all still reports a normal complete result (unchanged behaviour)', async () => {
  const fetchLicences = async () => [
    { licensee: 'UNIVERSAL PROPERTY GROUP PTY LIMITED', licenceNumber: '85273C', status: 'Current' },
  ];

  const result = await searchNSWFairTrading('Universal Property Group Pty Limited', '', [], null, fetchLicences);

  assert.equal(result.status, undefined);
  assert.equal(result.completeness, 'complete');
  assert.equal(result.results.length, 1);
  assert.doesNotMatch(result.summary, /incomplete|could not complete/i);
});

test('fetchNswCompanyLookup — surfaces `failed: true` when the underlying search errors', async () => {
  const result = await fetchNswCompanyLookup(
    'Universal Property Group Pty Limited',
    rejectingFetch(new Error('Request failed with status code 403'))
  );

  assert.equal(result.failed, true);
  assert.deepEqual(result.items, []);
});
