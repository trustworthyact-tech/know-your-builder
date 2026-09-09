'use strict';

const defaultHealth = require('./scraperHealth');
const { assertValidResult } = require('./validateResult');

// Hard outer bound via Promise.race, independent of and layered on top of browser.js's
// own internal challenge-timeout logic. This is the direct fix for the still-open
// "requests hung 1000+ seconds" class of incident documented in CLAUDE.md, where
// nothing today guarantees a scraper call eventually settles regardless of what its
// internals do. clearTimeout runs whichever side wins, so no dangling timer survives
// past this call.
function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs one scraper through a hard timeout + circuit breaker, streaming status via
 * `send` exactly like server/index.js's existing inline try/catch around each
 * `searches` entry — this is that same block, extracted and given a timeout + breaker.
 * Not yet wired into the live /api/search route (that's WS4.1); used directly by the
 * WS0 pilot integration and by anything built on top of it going forward.
 *
 * `health` is injectable so tests can isolate breaker state per test instead of
 * sharing the real module-level Map.
 */
async function runScraper(manifestEntry, fn, { send, health = defaultHealth } = {}) {
  const { key, label, timeoutMs, breaker } = manifestEntry;

  if (health.isOpen(key)) {
    send({
      key,
      label,
      status: 'error',
      error: 'Temporarily unavailable — repeated failures, retrying automatically',
      results: [],
      completeness: 'unavailable',
    });
    return;
  }

  send({ key, label, status: 'searching' });
  try {
    const result = await withTimeout(fn(), timeoutMs);
    health.recordSuccess(key);
    send({ key, label, status: 'done', ...assertValidResult(key, result) });
  } catch (err) {
    health.recordFailure(key, breaker);
    console.error(`[${key}]`, err && err.message ? err.message : err);
    send({ key, label, status: 'error', error: 'Search failed', results: [], completeness: 'unavailable' });
  }
}

module.exports = { runScraper, withTimeout };
