'use strict';

const { fetchAsicEuRecords } = require('./asicEnforceableUndertakingsDataset');

// This register changes far less often than ASIC's weekly DPN CSV or even VIC BPC's
// register — new court enforceable undertakings are accepted at most a few times a
// month. 24h keeps the cache reasonably warm without fetching more often than the data
// actually changes. Mirrors vicBpcDatasetRefresh.js.
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

async function refreshOnce() {
  try {
    const { stale, cachedAt } = await fetchAsicEuRecords();
    if (stale) {
      console.warn(`[asicEnforceableUndertakingsDatasetRefresh] live fetch failed, cache still at ${cachedAt.toISOString()}`);
    } else {
      console.log(`[asicEnforceableUndertakingsDatasetRefresh] cache warm as of ${cachedAt.toISOString()}`);
    }
  } catch (err) {
    // No cached copy and the live fetch failed — log and let the next cycle retry.
    // Never throw: this must not crash the long-lived server process.
    console.error('[asicEnforceableUndertakingsDatasetRefresh] refresh cycle failed, no cache available:', err.message);
  }
}

function startAsicEuDatasetRefresh(intervalMs = Number(process.env.ASIC_EU_REFRESH_INTERVAL_MS) || DEFAULT_INTERVAL_MS) {
  // Fire-and-forget — must not block server startup/app.listen.
  refreshOnce();
  return setInterval(refreshOnce, intervalMs);
}

module.exports = { startAsicEuDatasetRefresh };
