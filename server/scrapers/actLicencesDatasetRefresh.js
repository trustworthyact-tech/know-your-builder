'use strict';

const { fetchActLicenceRecords, fetchActDisciplinaryRecords } = require('./actLicencesDataset');

// 24h — matches vicBpcDatasetRefresh.js/asicEnforceableUndertakingsDatasetRefresh.js;
// no evidence either ACT Socrata dataset updates faster than daily.
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function refreshOne(label, fetchFn) {
  try {
    const { stale, cachedAt, records } = await fetchFn();
    if (stale) {
      console.warn(`[actLicencesDatasetRefresh] ${label}: live fetch failed, cache still at ${cachedAt.toISOString()}`);
    } else {
      console.log(`[actLicencesDatasetRefresh] ${label}: cache warm as of ${cachedAt.toISOString()} (${records.length} rows)`);
    }
  } catch (err) {
    // No cached copy and the live fetch failed — log and let the next cycle retry.
    // Never throw: this must not crash the long-lived server process.
    console.error(`[actLicencesDatasetRefresh] ${label} refresh failed, no cache available:`, err.message);
  }
}

async function refreshOnce() {
  await refreshOne('licence', fetchActLicenceRecords);
  await refreshOne('disciplinary', fetchActDisciplinaryRecords);
}

function startActLicencesDatasetRefresh(intervalMs = Number(process.env.ACT_LICENCES_REFRESH_INTERVAL_MS) || DEFAULT_INTERVAL_MS) {
  // Fire-and-forget — must not block server startup/app.listen.
  refreshOnce();
  return setInterval(refreshOnce, intervalMs);
}

module.exports = { startActLicencesDatasetRefresh };
