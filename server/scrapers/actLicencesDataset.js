'use strict';

const axios = require('axios');
const { replaceDatasetRecords, queryDataset } = require('./datasetStore');

// WS1 (2026-09-09, reliability plan activities 1.5/1.6): bulk-fetch and cache both of
// ACT's Socrata open-data datasets instead of querying them live per search. Both are
// small enough to fetch outright — confirmed live via Socrata's own count endpoint:
// de4w-gbt3 (licences) has 32,001 rows, avib-prrz (disciplinary) has 377. Same
// fetch-once-cache-via-datasetStore-match-locally shape as asicDpnDataset.js/
// asicEnforceableUndertakingsDataset.js/vicBpcDataset.js.
const LICENCE_RESOURCE_URL = 'https://data.act.gov.au/resource/de4w-gbt3.json';
const DISCIPLINARY_RESOURCE_URL = 'https://data.act.gov.au/resource/avib-prrz.json';

const LICENCE_DATASET_KEY = 'act_licences';
const DISCIPLINARY_DATASET_KEY = 'act_disciplinary';

const PAGE_SIZE = 1000;

// Socrata pagination via $limit/$offset, ordered by :id for a stable page boundary
// across requests (unordered paging can duplicate/skip rows if the underlying table
// changes mid-walk — :id ordering avoids that).
async function fetchAllPages(url, _axios) {
  const all = [];
  let offset = 0;
  for (;;) {
    const { data } = await _axios.get(url, {
      params: { '$limit': PAGE_SIZE, '$offset': offset, '$order': ':id' },
      headers: { Accept: 'application/json' },
      timeout: 30_000,
    });
    const rows = Array.isArray(data) ? data : [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function doFetchRecords(resourceUrl, datasetKey, _axios) {
  let rows;
  try {
    rows = await fetchAllPages(resourceUrl, _axios);
  } catch (err) {
    const cached = await queryDataset(datasetKey);
    if (cached.rows && cached.rows.length > 0) {
      return { records: cached.rows, stale: true, cachedAt: cached.fetchedAt };
    }
    throw err;
  }

  try {
    await replaceDatasetRecords(datasetKey, rows.map((payload) => ({ payload })), { sourceUrl: resourceUrl });
  } catch {
    // Ingestion write failure is non-fatal — this fetch's rows are still returned
    // fresh to the caller; the next refresh cycle gets another chance to persist.
  }
  return { records: rows, stale: false, cachedAt: new Date() };
}

// Concurrent callers hitting a cold cache would otherwise each trigger their own bulk
// walk of the same dataset — coalesce into one in-flight request per dataset, mirroring
// the inFlightFetch pattern already used throughout server/scrapers/.
let inFlightLicence = null;
async function fetchActLicenceRecords(_axios = axios) {
  if (inFlightLicence) return inFlightLicence;
  inFlightLicence = doFetchRecords(LICENCE_RESOURCE_URL, LICENCE_DATASET_KEY, _axios);
  try {
    return await inFlightLicence;
  } finally {
    inFlightLicence = null;
  }
}

let inFlightDisciplinary = null;
async function fetchActDisciplinaryRecords(_axios = axios) {
  if (inFlightDisciplinary) return inFlightDisciplinary;
  inFlightDisciplinary = doFetchRecords(DISCIPLINARY_RESOURCE_URL, DISCIPLINARY_DATASET_KEY, _axios);
  try {
    return await inFlightDisciplinary;
  } finally {
    inFlightDisciplinary = null;
  }
}

module.exports = {
  fetchActLicenceRecords,
  fetchActDisciplinaryRecords,
  LICENCE_DATASET_KEY,
  DISCIPLINARY_DATASET_KEY,
};
