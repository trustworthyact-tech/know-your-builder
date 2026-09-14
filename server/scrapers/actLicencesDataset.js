'use strict';

const axios = require('axios');
const { replaceDatasetRecords, queryDataset, recordIngestionFailure } = require('./datasetStore');

// WS4 reliability-plan audit (2026-09-10) — see the identical guard in asicDpnDataset.js
// for the full rationale. These two datasets are confirmed (via Socrata's own count
// endpoint, per the comment above) to be very different sizes — 32,001 rows vs. 377 —
// so each gets its own floor rather than sharing one constant; both are generous margins
// below the real confirmed counts, meant only to catch "Socrata's API shape changed and
// fetchAllPages() came back nearly empty," not to police either dataset's actual size.
const MIN_SANE_ROW_COUNT_LICENCE = 5_000;
const MIN_SANE_ROW_COUNT_DISCIPLINARY = 30;

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

async function doFetchRecords(resourceUrl, datasetKey, _axios, _minRows) {
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

  if (rows.length < _minRows) {
    // Same "treat an implausibly small parse like a fetch failure" guard as
    // asicDpnDataset.js/asicEnforceableUndertakingsDataset.js — don't promote it, record
    // why, and fall back to the last known-good copy for this caller too.
    console.error(`[actLicencesDataset] ${datasetKey}: fetched only ${rows.length} row(s) (expected ${_minRows}+) — refusing to promote, likely a Socrata API shape change`);
    await recordIngestionFailure(datasetKey, `fetched only ${rows.length} row(s), below the ${_minRows} sanity floor`);
    const cached = await queryDataset(datasetKey);
    if (cached.rows && cached.rows.length > 0) {
      return { records: cached.rows, stale: true, cachedAt: cached.fetchedAt };
    }
    throw new Error(`${datasetKey}: fetched only ${rows.length} row(s) and no prior cache to fall back to`);
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
async function fetchActLicenceRecords(_axios = axios, _minRows = MIN_SANE_ROW_COUNT_LICENCE) {
  if (inFlightLicence) return inFlightLicence;
  inFlightLicence = doFetchRecords(LICENCE_RESOURCE_URL, LICENCE_DATASET_KEY, _axios, _minRows);
  try {
    return await inFlightLicence;
  } finally {
    inFlightLicence = null;
  }
}

let inFlightDisciplinary = null;
async function fetchActDisciplinaryRecords(_axios = axios, _minRows = MIN_SANE_ROW_COUNT_DISCIPLINARY) {
  if (inFlightDisciplinary) return inFlightDisciplinary;
  inFlightDisciplinary = doFetchRecords(DISCIPLINARY_RESOURCE_URL, DISCIPLINARY_DATASET_KEY, _axios, _minRows);
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
  MIN_SANE_ROW_COUNT_LICENCE,
  MIN_SANE_ROW_COUNT_DISCIPLINARY,
};
