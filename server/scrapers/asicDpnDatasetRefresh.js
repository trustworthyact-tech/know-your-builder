'use strict';

const { fetchDpnRows } = require('./asicDpnDataset');

// This dataset refreshes weekly (every Tuesday AEST, confirmed 2026-08-19) — a 12h
// default interval catches that promptly without hammering the CKAN API. Same
// decoupled background-refresh pattern as paymentTimesRefresh.js: a live search
// almost always hits an already-warm cache instead of racing a cold fetch
// synchronously.
const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h

async function refreshOnce() {
  try {
    const { stale, cachedAt } = await fetchDpnRows();
    if (stale) {
      console.warn(`[asicDpnDatasetRefresh] live fetch failed, cache still at ${cachedAt.toISOString()}`);
    } else {
      console.log(`[asicDpnDatasetRefresh] cache warm as of ${cachedAt.toISOString()}`);
    }
  } catch (err) {
    // No cached copy and the live fetch failed — log and let the next cycle retry.
    // Never throw: this must not crash the long-lived server process.
    console.error('[asicDpnDatasetRefresh] refresh cycle failed, no cache available:', err.message);
  }
}

function startAsicDpnDatasetRefresh(intervalMs = Number(process.env.ASIC_DPN_REFRESH_INTERVAL_MS) || DEFAULT_INTERVAL_MS) {
  // Fire-and-forget — must not block server startup/app.listen.
  refreshOnce();
  return setInterval(refreshOnce, intervalMs);
}

module.exports = { startAsicDpnDatasetRefresh };
