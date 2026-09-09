'use strict';

const { fetchRegisterBuffer, parseAllRows, DATASET_KEY } = require('./paymentTimes');
const { replaceDatasetRecords, recordIngestionFailure } = require('./datasetStore');

// No scheduled-task pattern exists elsewhere in server/ — every other scraper only
// runs inside a live /api/search request. This decouples the PTRR register download
// from the request path entirely: refreshing in the background means a live search
// almost always hits an already-warm cache instead of racing the WAF synchronously.
const DEFAULT_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8h

// WS1 (2026-09-09): this cycle now does two things, not one — downloads the raw
// workbook (unchanged) AND parses + ingests it into datasetStore.js, gated by the
// header-column validation check. A validation failure intentionally does NOT call
// replaceDatasetRecords at all, so whatever good rows are already in datasetStore
// stay live and queryable — this is the direct fix for the historical Section 8.3
// silent column-shift bug (CLAUDE.md).
async function refreshOnce() {
  let buf, stale, cachedAt;
  try {
    ({ buffer: buf, stale, cachedAt } = await fetchRegisterBuffer());
  } catch (err) {
    // No cached copy and the live fetch failed — log and let the next cycle retry.
    // Never throw: this must not crash the long-lived server process.
    console.error('[paymentTimesRefresh] refresh cycle failed, no cache available:', err.message);
    return;
  }

  if (stale) {
    console.warn(`[paymentTimesRefresh] live download failed, buffer cache still at ${cachedAt.toISOString()}`);
  } else {
    console.log(`[paymentTimesRefresh] buffer cache warm as of ${cachedAt.toISOString()}`);
  }

  let rows, headerIssues;
  try {
    ({ rows, headerIssues } = parseAllRows(buf));
  } catch (err) {
    console.error('[paymentTimesRefresh] failed to parse workbook, not promoting this ingestion:', err.message);
    await recordIngestionFailure(DATASET_KEY, `parse failed: ${err.message}`);
    return;
  }

  if (headerIssues.length > 0) {
    console.error('[paymentTimesRefresh] header validation failed, not promoting this ingestion:', headerIssues.join('; '));
    await recordIngestionFailure(DATASET_KEY, `header validation failed: ${headerIssues.join('; ')}`);
    return;
  }

  await replaceDatasetRecords(
    DATASET_KEY,
    rows.map((r) => ({ payload: r, abn: r.abn || null, normalisedName: r.name ? r.name.toLowerCase() : null })),
    { sourceUrl: 'https://register.paymenttimes.gov.au/dashboard.html' }
  );
  console.log(`[paymentTimesRefresh] ingested ${rows.length} row(s) into datasetStore`);
}

function startPaymentTimesRefresh(intervalMs = Number(process.env.PTRR_REFRESH_INTERVAL_MS) || DEFAULT_INTERVAL_MS) {
  // Fire-and-forget — must not block server startup/app.listen.
  refreshOnce();
  return setInterval(refreshOnce, intervalMs);
}

module.exports = { startPaymentTimesRefresh, refreshOnce };
