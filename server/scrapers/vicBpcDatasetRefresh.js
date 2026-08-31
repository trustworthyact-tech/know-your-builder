'use strict';

const { fetchVbaBpcRecords } = require('./vicBpcDataset');

// The BPC compliance-and-enforcement register changes far less often than
// ASIC's weekly DPN CSV, and — unlike that plain HTTP download — each refresh
// here is a full Puppeteer page load plus 4 in-page fetch() calls, sharing the
// same page-slot pool (browser.js's MAX_CONCURRENT_PAGES) as live production
// scraper traffic. 24h is a generous default: it keeps the cache reasonably
// warm without contending for pool slots more often than the data actually
// changes.
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

async function refreshOnce() {
  try {
    const { stale, cachedAt } = await fetchVbaBpcRecords();
    if (stale) {
      console.warn(`[vicBpcDatasetRefresh] live fetch failed, cache still at ${cachedAt.toISOString()}`);
    } else {
      console.log(`[vicBpcDatasetRefresh] cache warm as of ${cachedAt.toISOString()}`);
    }
  } catch (err) {
    // No cached copy and the live fetch failed — log and let the next cycle retry.
    // Never throw: this must not crash the long-lived server process.
    console.error('[vicBpcDatasetRefresh] refresh cycle failed, no cache available:', err.message);
  }
}

function startVicBpcDatasetRefresh(intervalMs = Number(process.env.VBA_BPC_REFRESH_INTERVAL_MS) || DEFAULT_INTERVAL_MS) {
  // Fire-and-forget — must not block server startup/app.listen.
  refreshOnce();
  return setInterval(refreshOnce, intervalMs);
}

module.exports = { startVicBpcDatasetRefresh };
