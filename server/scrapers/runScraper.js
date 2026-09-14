'use strict';

const defaultHealth = require('./scraperHealth');
const { assertValidResult } = require('./validateResult');
const healthHistory = require('./healthHistory');

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
 * sharing the real module-level Map. `logHealthEvent` (WS0.8, persisted history behind
 * the reliability dashboard) is injectable the same way, defaulting to the real
 * healthHistory.logEvent — fired-and-forgotten with a .catch(() => {}) so a DB hiccup
 * here can never surface as an unhandled rejection (the exact class of bug documented in
 * CLAUDE.md's WS4.2 entry) or add latency to the request this scraper is part of.
 */
async function runScraper(manifestEntry, fn, { send, health = defaultHealth, logHealthEvent = healthHistory.logEvent } = {}) {
  const { key, label, timeoutMs, breaker } = manifestEntry;

  if (health.isOpen(key)) {
    logHealthEvent(key, 'circuit_open', null).catch(() => {});
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
    logHealthEvent(key, 'success', null).catch(() => {});
    send({ key, label, status: 'done', ...assertValidResult(key, result) });
  } catch (err) {
    health.recordFailure(key, breaker);
    const message = err && err.message ? err.message : String(err);
    logHealthEvent(key, 'failure', message).catch(() => {});
    console.error(`[${key}]`, message);
    send({ key, label, status: 'error', error: 'Search failed', results: [], completeness: 'unavailable' });
  }
}

module.exports = { runScraper, withTimeout };
