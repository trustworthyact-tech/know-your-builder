const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { fetchDpnRows, parseCsv, parseCsvLine, DATASET_KEY } = require('./asicDpnDataset');
const { replaceDatasetRecords, diskCachePath } = require('./datasetStore');

// SAMPLE_CSV below is deliberately a 3-row illustrative fixture, well under the real
// module's MIN_SANE_ROW_COUNT (100) sanity floor — every test in this file that isn't
// specifically exercising that floor passes 0 here to opt out of it, since it's testing
// unrelated fetch/fallback behavior, not the row-count guard itself (see the dedicated
// "row-count sanity guard" tests below for that).
const NO_ROW_FLOOR = 0;

const SAMPLE_CSV =
  '﻿' +
  'REGISTER_NAME,BD_PER_NAME,BD_PER_TYPE,BD_PER_DOC_NUM,BD_PER_START_DT,BD_PER_END_DT,BD_PER_ADD_LOCAL,BD_PER_ADD_STATE,BD_PER_ADD_PCODE,BD_PER_ADD_COUNTRY,BD_PER_COMMENTS\n' +
  '"Banned and Disqualified Persons","ROBERTS, VERONICA MARY","Disq. Director","#031925499","03/09/2025","02/09/2030","TULLAMARINE","VIC","3043","AUSTRALIA","No comment made"\n' +
  '"Banned and Disqualified Persons","ROBERTS, VERONICA MARY","Disq. Director","#031925499","03/09/2025","02/09/2030","TAYLORS LAKES","VIC","3038","AUSTRALIA","No comment made"\n' +
  '"Banned and Disqualified Persons","SMITH, JOHN","Banned Securities","#000109221","01/01/1994","01/01/1999","","","","AUSTRALIA","Has a comment, with a comma"\n';

function clearCache() {
  try { fs.unlinkSync(diskCachePath(DATASET_KEY)); } catch { /* fine if absent */ }
}

// Seeds the store the same way a real ingestion would (via datasetStore.js, disk-fallback
// path since no DATABASE_URL is set in tests) rather than writing a raw file directly —
// this exercises the real read path fetchDpnRows() now goes through.
async function seedCache(csv = SAMPLE_CSV) {
  const rows = parseCsv(Buffer.from(csv, 'utf8'));
  await replaceDatasetRecords(DATASET_KEY, rows.map((payload) => ({ payload })), {}, null);
}

// -------------------------------------------------------------------
// parseCsvLine / parseCsv — pure functions, no I/O
// -------------------------------------------------------------------

test('parseCsvLine — splits plain fields', () => {
  assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
});

test('parseCsvLine — handles a quoted field containing a comma', () => {
  assert.deepEqual(
    parseCsvLine('"ROBERTS, VERONICA MARY","Disq. Director"'),
    ['ROBERTS, VERONICA MARY', 'Disq. Director']
  );
});

test('parseCsvLine — handles doubled-quote escape inside a quoted field', () => {
  assert.deepEqual(parseCsvLine('"She said ""hi""",ok'), ['She said "hi"', 'ok']);
});

test('parseCsv — strips BOM and maps header to row objects', () => {
  const rows = parseCsv(Buffer.from(SAMPLE_CSV, 'utf8'));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].BD_PER_NAME, 'ROBERTS, VERONICA MARY');
  assert.equal(rows[0].BD_PER_DOC_NUM, '#031925499');
  assert.equal(rows[0].BD_PER_TYPE, 'Disq. Director');
  assert.equal(rows[2].BD_PER_TYPE, 'Banned Securities');
  assert.equal(rows[2].BD_PER_COMMENTS, 'Has a comment, with a comma');
});

test('parseCsv — returns empty array for empty input', () => {
  assert.deepEqual(parseCsv(Buffer.from('', 'utf8')), []);
});

// -------------------------------------------------------------------
// fetchDpnRows — network fully mocked via injectable _axios; storage goes through
// datasetStore.js's disk-fallback path (no DATABASE_URL in tests), same as production
// behaves with the DB unreachable.
// -------------------------------------------------------------------

test('fetchDpnRows — fresh download succeeds, ingests via datasetStore, stale:false', async () => {
  clearCache();
  try {
    const fakeAxios = {
      get: async (url) => {
        if (url.includes('resource_show')) {
          return { data: { result: { url: 'https://example.test/bd_per.csv' } } };
        }
        return { data: Buffer.from(SAMPLE_CSV, 'utf8') };
      },
    };
    const result = await fetchDpnRows(fakeAxios, NO_ROW_FLOOR);
    assert.equal(result.stale, false);
    assert.equal(result.rows.length, 3);
    assert.ok(fs.existsSync(diskCachePath(DATASET_KEY)), 'ingestion should leave a readable cached copy');
  } finally {
    clearCache();
  }
});

test('fetchDpnRows — resource_show API call fails, falls back to previously ingested copy', async () => {
  clearCache();
  try {
    await seedCache();
    const fakeAxios = { get: async () => { throw new Error('network down'); } };
    const result = await fetchDpnRows(fakeAxios);
    assert.equal(result.stale, true);
    assert.equal(result.rows.length, 3);
  } finally {
    clearCache();
  }
});

test('fetchDpnRows — resource_show fails and nothing has ever been ingested, throws', async () => {
  clearCache();
  const fakeAxios = { get: async () => { throw new Error('network down'); } };
  await assert.rejects(() => fetchDpnRows(fakeAxios), /could not resolve current register CSV URL/);
});

test('fetchDpnRows — resource_show succeeds but download fails, falls back to previously ingested copy', async () => {
  clearCache();
  try {
    await seedCache();
    const fakeAxios = {
      get: async (url) => {
        if (url.includes('resource_show')) return { data: { result: { url: 'https://example.test/bd_per.csv' } } };
        throw new Error('download failed');
      },
    };
    const result = await fetchDpnRows(fakeAxios);
    assert.equal(result.stale, true);
    assert.equal(result.rows.length, 3);
  } finally {
    clearCache();
  }
});

test('fetchDpnRows — resource_show succeeds but download fails and nothing ingested, throws', async () => {
  clearCache();
  const fakeAxios = {
    get: async (url) => {
      if (url.includes('resource_show')) return { data: { result: { url: 'https://example.test/bd_per.csv' } } };
      throw new Error('download failed');
    },
  };
  await assert.rejects(() => fetchDpnRows(fakeAxios), /download failed/);
});

// -------------------------------------------------------------------
// Row-count sanity guard (WS4 reliability-plan audit, 2026-09-10) — a parse that comes
// back implausibly small (a source format change, not a genuine register size) must
// never be promoted, and must never be handed back to the caller as if it were real
// either — both would reproduce the historical Payment Times silent-column-shift bug,
// here against the Disqualified Persons register.
// -------------------------------------------------------------------

test('fetchDpnRows — parse below the row-count floor falls back to the existing cache, does not overwrite it', async () => {
  clearCache();
  try {
    await seedCache(); // 3 known-good rows already ingested
    const fakeAxios = {
      get: async (url) => {
        if (url.includes('resource_show')) return { data: { result: { url: 'https://example.test/bd_per.csv' } } };
        // Simulates a source format change: the "fresh" download parses to 1 row,
        // below any real floor — but a genuine format break, not a network failure.
        return { data: Buffer.from(SAMPLE_CSV.split('\n').slice(0, 2).join('\n'), 'utf8') };
      },
    };
    const result = await fetchDpnRows(fakeAxios, 3);
    assert.equal(result.stale, true, 'should fall back to the cache, not present the under-parsed rows as fresh');
    assert.equal(result.rows.length, 3, 'the cache still holds the 3 known-good rows — nothing was overwritten');
  } finally {
    clearCache();
  }
});

test('fetchDpnRows — parse below the row-count floor with no existing cache throws (never returns the bad rows)', async () => {
  clearCache();
  const fakeAxios = {
    get: async (url) => {
      if (url.includes('resource_show')) return { data: { result: { url: 'https://example.test/bd_per.csv' } } };
      return { data: Buffer.from(SAMPLE_CSV.split('\n').slice(0, 2).join('\n'), 'utf8') };
    },
  };
  await assert.rejects(() => fetchDpnRows(fakeAxios, 3), /parsed only \d+ row\(s\)/);
});
