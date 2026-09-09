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

    const result = await fetchActLicenceRecords(fakeAxios);
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
    const result = await fetchActLicenceRecords(fakeAxios);
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
    const result = await fetchActDisciplinaryRecords(fakeAxios);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].licensee_name, 'ACME PTY LTD');
  } finally {
    clearCache(DISCIPLINARY_DATASET_KEY);
  }
});
