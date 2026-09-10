'use strict';

const axios = require('axios');
const { replaceDatasetRecords, queryDataset, recordIngestionFailure } = require('./datasetStore');

// A minimum sane row count for this register — found during the WS4 reliability-plan
// audit (2026-09-10): before this, a parse that silently produced 0 rows (a header/
// format change on ASIC's end, the exact failure class that broke Payment Times'
// Section 8.3 — see CLAUDE.md) would have been promoted straight into datasetStore,
// silently wiping the Disqualified Persons cache to empty and making every future
// search show a false "clean" with no alarm. The real register has run in the
// thousands of active entries for years; 100 is a floor far below any plausible
// legitimate value, chosen only to catch "parsed basically nothing," not to police
// the register's actual size.
const MIN_SANE_ROW_COUNT = 100;

// Resolves to the current CSV via the CKAN Action API rather than predicting a
// filename. Confirmed live (2026-08-19): the filename changes monthly only
// (bd_per_YYYYMM.csv — no day component), while content at that same URL is
// silently overwritten in place every Tuesday (AEST). This resource id has been
// stable since the resource was created (2016-06-16 per the API response) — the
// correct long-term anchor, not the dataset landing page HTML and not a predicted
// filename. package_show?id=asic-banned-disqualified-per also works if this id
// ever needs re-discovering (returns all resources for the dataset — PDF help
// file, CSV, TSV, XLSX).
const RESOURCE_SHOW_URL =
  'https://data.gov.au/data/api/3/action/resource_show?id=741da9e3-7e0c-458e-830c-c518698e1788';

// WS0 pilot migration (2026-09-08, reliability plan WS1.1 pulled forward): storage
// moved from a raw CSV file on a Railway volume to datasetStore.js (Postgres, with a
// disk-JSON fallback baked into that module — see server/scrapers/datasetStore.js).
// The CSV fetch-and-parse logic below is unchanged; only where parsed rows are
// written/read has changed. asicDpnMatch.js needs no changes — this keeps the exact
// same { rows, stale, cachedAt } contract.
const DATASET_KEY = 'asic_dpn';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// ── CSV parsing ──────────────────────────────────────────────────────────────
// Hand-rolled rather than a new dependency — CSV is simple enough, and this
// codebase already prefers hand-rolled parsing over new deps for file formats
// (see paymentTimes.js's hand-rolled ZIP/XLSX reader). Handles RFC 4180 quoted
// fields (commas and doubled-quote escapes inside quotes) — the real file quotes
// every field, e.g. "ROBERTS, VERONICA MARY", so a naive .split(',') would be wrong.

function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

// Strips a leading UTF-8 BOM — confirmed present in the live file (contradicts an
// older "tab-delimited" claim found during research; trust the live file).
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseCsv(buffer) {
  const text = stripBom(buffer.toString('utf8'));
  const lines = text.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

// ── Cache management ─────────────────────────────────────────────────────────
// Reads back through datasetStore.js rather than a local file directly — that module
// already handles the Postgres-vs-disk-fallback split. `stale: true` here means
// specifically "the live fetch failed, this is a previously-ingested copy" — a
// fetch-time-scoped meaning distinct from datasetStore's own generic SLA-based
// `stale` flag (not used here; that flag only activates when a caller passes
// `slaMs`, which this module deliberately doesn't).

async function readCachedRows() {
  const cached = await queryDataset(DATASET_KEY);
  if (!cached.rows || cached.rows.length === 0) return null;
  return { rows: cached.rows, stale: true, cachedAt: cached.fetchedAt };
}

// ── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Downloads and parses the current ASIC Banned and Disqualified Persons register.
 *
 * Returns { rows, stale, cachedAt }. `stale` is true when the live fetch failed
 * and a previously-ingested copy was returned instead (`cachedAt` is that copy's
 * fetch time) — callers should surface this to the user rather than presenting it
 * as fresh data. Throws only when the live fetch fails AND no ingested copy exists.
 *
 * _axios is injectable so tests can simulate API/download failures and stale
 * fallback without touching the network — same pattern as captcha.js's _http.
 * _minRows is injectable so tests can exercise the row-count sanity guard (below)
 * without needing a 100-row fixture, and so the guard's threshold isn't hardcoded
 * into every call site.
 */
async function doFetchDpnRows(_axios = axios, _minRows = MIN_SANE_ROW_COUNT) {
  let url;
  try {
    const { data } = await _axios.get(RESOURCE_SHOW_URL, { headers: HEADERS, timeout: 10_000 });
    url = data?.result?.url;
  } catch {
    // fallback: if the API call fails, try the ingested copy
  }

  if (!url) {
    const cached = await readCachedRows();
    if (cached) return cached;
    throw new Error('ASIC DPN: could not resolve current register CSV URL');
  }

  let buffer;
  try {
    const { data } = await _axios.get(url, {
      headers: HEADERS,
      timeout: 30_000,
      responseType: 'arraybuffer',
    });
    buffer = Buffer.from(data);
  } catch (err) {
    const cached = await readCachedRows();
    if (cached) return cached;
    throw err;
  }

  const rows = parseCsv(buffer);

  if (rows.length < _minRows) {
    // Treat an implausibly small parse exactly like a fetch failure: don't promote it
    // (the existing good cache stays live and queryable), record why, and fall back to
    // returning the last known-good rows to *this* caller too — returning the freshly
    // (under-)parsed rows here would present the same false "clean" result immediately,
    // even though nothing got persisted.
    console.error(`[asicDpnDataset] parsed only ${rows.length} row(s) from ${url} (expected ${_minRows}+) — refusing to promote, likely a source format change`);
    await recordIngestionFailure(DATASET_KEY, `parsed only ${rows.length} row(s) from ${url}, below the ${_minRows} sanity floor`);
    const cached = await readCachedRows();
    if (cached) return cached;
    throw new Error(`ASIC DPN: parsed only ${rows.length} row(s) and no prior cache to fall back to`);
  }

  const fetchedAt = new Date();
  try {
    await replaceDatasetRecords(DATASET_KEY, rows.map((payload) => ({ payload })), { sourceUrl: url });
  } catch {
    // Ingestion write failure is non-fatal — this fetch's rows are still returned
    // fresh to the caller; the next refresh cycle gets another chance to persist.
  }
  return { rows, stale: false, cachedAt: fetchedAt };
}

// Concurrent /api/search requests hitting a cold cache would otherwise each trigger
// their own download of the same small file — coalesce into one in-flight request,
// mirroring the inFlightFetch dedup pattern in paymentTimes.js (which itself mirrors
// austlii.js's pendingFetches).
let inFlightFetch = null;

async function fetchDpnRows(_axios = axios, _minRows = MIN_SANE_ROW_COUNT) {
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = doFetchDpnRows(_axios, _minRows);
  try {
    return await inFlightFetch;
  } finally {
    inFlightFetch = null;
  }
}

module.exports = { fetchDpnRows, parseCsv, parseCsvLine, DATASET_KEY, MIN_SANE_ROW_COUNT };
