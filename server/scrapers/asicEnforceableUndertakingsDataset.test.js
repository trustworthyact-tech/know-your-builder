'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { fetchAsicEuRecords, parseRecords, DATASET_KEY } = require('./asicEnforceableUndertakingsDataset');
const { replaceDatasetRecords, diskCachePath } = require('./datasetStore');

const SAMPLE_HTML = `
<table class="asic-table">
  <tbody>
    <tr>
      <td>s93AA</td>
      <td><p>Acme Constructions Pty Ltd</p></td>
      <td><a href="/media/1">Media Release 26-001MR</a></td>
      <td>01/02/2026</td>
    </tr>
    <tr>
      <td>s93AA</td>
      <td>Mrs I C Hilder<br><a href="/media/2">Media Release 98/236</a></td>
      <td><a href="/media/2">Media Release 98/236</a></td>
      <td>03/04/1998</td>
    </tr>
  </tbody>
</table>
`;

function clearCache() {
  try { fs.unlinkSync(diskCachePath(DATASET_KEY)); } catch { /* fine if absent */ }
}

async function seedCache() {
  const records = parseRecords(SAMPLE_HTML);
  await replaceDatasetRecords(DATASET_KEY, records.map((payload) => ({ payload })), {}, null);
}

// -------------------------------------------------------------------
// parseRecords — pure function, no I/O
// -------------------------------------------------------------------

test('parseRecords — extracts party text from a normal <p>-wrapped row', () => {
  const records = parseRecords(SAMPLE_HTML);
  assert.equal(records.length, 2);
  assert.equal(records[0].partyText, 'Acme Constructions Pty Ltd');
  assert.equal(records[0].date, '01/02/2026');
});

test('parseRecords — handles a bare-text-node row with no <p> wrapper (pre-2011 shape)', () => {
  const records = parseRecords(SAMPLE_HTML);
  // Must not glue the name and the link text together with no space
  assert.equal(records[1].partyText, 'Mrs I C Hilder');
});

test('parseRecords — returns an empty array for HTML with no matching table', () => {
  assert.deepEqual(parseRecords('<html><body>nothing here</body></html>'), []);
});

// -------------------------------------------------------------------
// fetchAsicEuRecords — network fully mocked via injectable _axios; storage goes
// through datasetStore.js's disk-fallback path (no DATABASE_URL in tests).
// -------------------------------------------------------------------

test('fetchAsicEuRecords — fresh fetch succeeds, ingests via datasetStore, stale:false', async () => {
  clearCache();
  try {
    const fakeAxios = { get: async () => ({ data: SAMPLE_HTML }) };
    const result = await fetchAsicEuRecords(fakeAxios);
    assert.equal(result.stale, false);
    assert.equal(result.records.length, 2);
    assert.ok(fs.existsSync(diskCachePath(DATASET_KEY)));
  } finally {
    clearCache();
  }
});

test('fetchAsicEuRecords — live fetch fails, falls back to a previously ingested copy', async () => {
  clearCache();
  try {
    await seedCache();
    const fakeAxios = { get: async () => { throw new Error('network down'); } };
    const result = await fetchAsicEuRecords(fakeAxios);
    assert.equal(result.stale, true);
    assert.equal(result.records.length, 2);
  } finally {
    clearCache();
  }
});

test('fetchAsicEuRecords — live fetch fails and nothing has ever been ingested, throws', async () => {
  clearCache();
  const fakeAxios = { get: async () => { throw new Error('network down'); } };
  await assert.rejects(() => fetchAsicEuRecords(fakeAxios), /network down/);
});
