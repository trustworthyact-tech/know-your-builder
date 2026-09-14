'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { fetchVbaBpcRecords, CACHE_PATH } = require('./vicBpcDataset');

// No test file existed for this module before the WS4 reliability-plan audit
// (2026-09-10) — added alongside the row-count sanity guard below so the guard (and the
// existing fetch/cache-fallback behavior it sits next to) has real coverage. Puppeteer
// is bypassed entirely via the injectable _fetchAllPages param — no browser needed.

function clearCache() {
  try { fs.unlinkSync(CACHE_PATH); } catch { /* fine if absent */ }
}

function seedCache(records) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(records));
}

test('fetchVbaBpcRecords — fresh fetch above the floor succeeds and writes the cache', async () => {
  clearCache();
  try {
    const records = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const fakeFetch = async () => ({ records, reportedTotal: 10 });
    const result = await fetchVbaBpcRecords(5, fakeFetch);
    assert.equal(result.stale, false);
    assert.equal(result.records.length, 10);
    assert.ok(fs.existsSync(CACHE_PATH));
  } finally {
    clearCache();
  }
});

test('fetchVbaBpcRecords — live fetch throws, falls back to a previously cached copy', async () => {
  clearCache();
  try {
    seedCache([{ id: 'cached' }]);
    const fakeFetch = async () => { throw new Error('Cloudflare challenge not cleared'); };
    const result = await fetchVbaBpcRecords(5, fakeFetch);
    assert.equal(result.stale, true);
    assert.deepEqual(result.records, [{ id: 'cached' }]);
  } finally {
    clearCache();
  }
});

test('fetchVbaBpcRecords — live fetch throws and nothing has ever been cached, throws', async () => {
  clearCache();
  const fakeFetch = async () => { throw new Error('Cloudflare challenge not cleared'); };
  await assert.rejects(() => fetchVbaBpcRecords(5, fakeFetch), /Cloudflare challenge not cleared/);
});

// -------------------------------------------------------------------
// Row-count sanity guard (WS4 reliability-plan audit, 2026-09-10) — mirrors
// asicDpnDataset.js's guard; see that file for the full rationale. This is the one
// dataset module of the four covered by this audit that doesn't go through
// datasetStore.js (its own bespoke disk cache predates it), so there's no
// recordIngestionFailure call to verify here — just the promote/fallback behavior.
// -------------------------------------------------------------------

test('fetchVbaBpcRecords — fetch below the row-count floor falls back to the existing cache, does not overwrite it', async () => {
  clearCache();
  try {
    seedCache([{ id: 'cached-good' }]);
    // Simulates an API response-shape change: the "fresh" fetch returns 1 record
    // without throwing, far below any real floor.
    const fakeFetch = async () => ({ records: [{ id: 'under-parsed' }], reportedTotal: 1 });
    const result = await fetchVbaBpcRecords(5, fakeFetch);
    assert.equal(result.stale, true, 'should fall back to the cache, not present the under-fetched records as fresh');
    assert.deepEqual(result.records, [{ id: 'cached-good' }], 'the cache still holds the known-good record — nothing was overwritten');
  } finally {
    clearCache();
  }
});

test('fetchVbaBpcRecords — fetch below the row-count floor with no existing cache throws (never returns the bad records)', async () => {
  clearCache();
  const fakeFetch = async () => ({ records: [{ id: 'under-parsed' }], reportedTotal: 1 });
  await assert.rejects(() => fetchVbaBpcRecords(5, fakeFetch), /fetched only \d+ record\(s\)/);
});
