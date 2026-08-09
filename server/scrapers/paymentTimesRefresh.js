'use strict';

const { fetchRegisterBuffer } = require('./paymentTimes');

// No scheduled-task pattern exists elsewhere in server/ — every other scraper only
// runs inside a live /api/search request. This decouples the PTRR register download
// from the request path entirely: refreshing in the background means a live search
// almost always hits an already-warm cache instead of racing the WAF synchronously.
const DEFAULT_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8h

async function refreshOnce() {
  try {
    const { stale, cachedAt } = await fetchRegisterBuffer();
    if (stale) {
      console.warn(`[paymentTimesRefresh] live fetch failed, cache still at ${cachedAt.toISOString()}`);
    } else {
      console.log(`[paymentTimesRefresh] cache warm as of ${cachedAt.toISOString()}`);
    }
  } catch (err) {
    // No cached copy and the live fetch failed — log and let the next cycle retry.
    // Never throw: this must not crash the long-lived server process.
    console.error('[paymentTimesRefresh] refresh cycle failed, no cache available:', err.message);
  }
}

function startPaymentTimesRefresh(intervalMs = Number(process.env.PTRR_REFRESH_INTERVAL_MS) || DEFAULT_INTERVAL_MS) {
  // Fire-and-forget — must not block server startup/app.listen.
  refreshOnce();
  return setInterval(refreshOnce, intervalMs);
}

module.exports = { startPaymentTimesRefresh };
