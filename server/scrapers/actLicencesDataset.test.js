'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const {
  fetchActLicenceRecords,
  fetchActDisciplinaryRecords,
  LICENCE_DATASET_KEY,
  DISCIPLINARY_DATASET_KEY,
} = require('./actLicencesDataset');
const { replaceDatasetRecords, diskCachePath } = require('./datasetStore');

function clearCache(key) {
  try { fs.unlinkSync(diskCachePath(key)); } catch { /* fine if absent */ }
}

// Fake axios that serves paginated Socrata-shaped responses: `pages` is an array of
// row arrays, one per expected $offset page — the last page must be shorter than
// PAGE_SIZE (1000) or the fetcher will keep paging past what's provided.
function makePaginatedAxios(pages) {
  let callCount = 0;
  return {
    get: async (url, config) => {
      const offset = config.params['$offset'];
      const pageIndex = offset / 1000;
      callCount++;
      return { data: pages[pageIndex] ?? [] };
    },
    get callCount() { return callCount; },
  };
}

test('fetchActLicenceRecords — walks multiple pages until a short page ends it', async () => {
  clearCache(LICENCE_DATASET_KEY);
  try {
    const page0 = Array.from({ length: 1000 }, (_, i) => ({ surname: `SMITH${i}` }));
    const page1 = [{ surname: 'LAST_ONE' }]; // short page — stop here
    const fakeAxios = makePaginatedAxios([page0, page1]);

    // 0 opts out of the real module's row-count sanity floor (5,000) — this fixture is
    // deliberately small/illustrative and tests pagination, not that guard (see the
    // dedicated guard tests below).
    const result = await fetchActLicenceRecords(fakeAxios, 0);
    assert.equal(result.stale, false);
    assert.equal(result.records.length, 1001);
    assert.equal(result.records[1000].surname, 'LAST_ONE');
  } finally {
    clearCache(LICENCE_DATASET_KEY);
  }
});

test('fetchActLicenceRecords — a single short page needs only one request', async () => {
  clearCache(LICENCE_DATASET_KEY);
  try {
    const fakeAxios = makePaginatedAxios([[{ surname: 'ONLY_ONE' }]]);
    const result = await fetchActLicenceRecords(fakeAxios, 0);
    assert.equal(result.records.length, 1);
    assert.equal(fakeAxios.callCount, 1);
  } finally {
    clearCache(LICENCE_DATASET_KEY);
  }
});

test('fetchActLicenceRecords — live fetch fails, falls back to a previously ingested copy', async () => {
  clearCache(LICENCE_DATASET_KEY);
  try {
    await replaceDatasetRecords(LICENCE_DATASET_KEY, [{ payload: { surname: 'CACHED' } }], {}, null);
    const fakeAxios = { get: async () => { throw new Error('Socrata down'); } };
    const result = await fetchActLicenceRecords(fakeAxios);
    assert.equal(result.stale, true);
    assert.deepEqual(result.records, [{ surname: 'CACHED' }]);
  } finally {
    clearCache(LICENCE_DATASET_KEY);
  }
});

test('fetchActLicenceRecords — live fetch fails and nothing has ever been ingested, throws', async () => {
  clearCache(LICENCE_DATASET_KEY);
  const fakeAxios = { get: async () => { throw new Error('Socrata down'); } };
  await assert.rejects(() => fetchActLicenceRecords(fakeAxios), /Socrata down/);
});

test('fetchActDisciplinaryRecords — uses its own dataset key, independent of the licence dataset', async () => {
  clearCache(DISCIPLINARY_DATASET_KEY);
  try {
    const fakeAxios = makePaginatedAxios([[{ licensee_name: 'ACME PTY LTD' }]]);
    // 0 opts out of the real module's disciplinary-dataset row-count floor (30).
    const result = await fetchActDisciplinaryRecords(fakeAxios, 0);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].licensee_name, 'ACME PTY LTD');
  } finally {
    clearCache(DISCIPLINARY_DATASET_KEY);
  }
});

// -------------------------------------------------------------------
// Row-count sanity guard (WS4 reliability-plan audit, 2026-09-10) — mirrors
// asicDpnDataset.js's guard and its tests; see that file for the full rationale. Each
// dataset gets its own floor (licence: 5,000; disciplinary: 30) since their real sizes
// differ by two orders of magnitude — see the comment on doFetchRecords.
// -------------------------------------------------------------------

test('fetchActLicenceRecords — fetch below the row-count floor falls back to the existing cache, does not overwrite it', async () => {
  clearCache(LICENCE_DATASET_KEY);
  try {
    await replaceDatasetRecords(LICENCE_DATASET_KEY, [{ payload: { surname: 'CACHED' } }], {}, null);
    // Simulates a Socrata API shape change: the "fresh" fetch returns a single row,
    // far below any real floor, without throwing.
    const fakeAxios = makePaginatedAxios([[{ surname: 'ONLY_ONE' }]]);
    const result = await fetchActLicenceRecords(fakeAxios, 5);
    assert.equal(result.stale, true, 'should fall back to the cache, not present the under-fetched rows as fresh');
    assert.deepEqual(result.records, [{ surname: 'CACHED' }]);
  } finally {
    clearCache(LICENCE_DATASET_KEY);
  }
});

test('fetchActLicenceRecords — fetch below the row-count floor with no existing cache throws (never returns the bad rows)', async () => {
  clearCache(LICENCE_DATASET_KEY);
  const fakeAxios = makePaginatedAxios([[{ surname: 'ONLY_ONE' }]]);
  await assert.rejects(() => fetchActLicenceRecords(fakeAxios, 5), /fetched only \d+ row\(s\)/);
});

test('fetchActDisciplinaryRecords — uses its own floor, independent of the licence dataset\'s', async () => {
  clearCache(DISCIPLINARY_DATASET_KEY);
  try {
    await replaceDatasetRecords(DISCIPLINARY_DATASET_KEY, [{ payload: { licensee_name: 'CACHED CO' } }], {}, null);
    const fakeAxios = makePaginatedAxios([[{ licensee_name: 'ONE ENTRY' }]]);
    const result = await fetchActDisciplinaryRecords(fakeAxios, 5);
    assert.equal(result.stale, true);
    assert.deepEqual(result.records, [{ licensee_name: 'CACHED CO' }]);
  } finally {
    clearCache(DISCIPLINARY_DATASET_KEY);
  }
});
