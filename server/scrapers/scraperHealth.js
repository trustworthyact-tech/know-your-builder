'use strict';

// In-memory circuit-breaker state, keyed by scraper key. Deliberately in-memory only —
// state resets on a Railway restart, which is fine: the breaker's job is to stop
// hammering a source mid-outage within one process's lifetime, not to remember outages
// across restarts. Persisting this is a WS0.8-dashboard-adjacent nice-to-have, not
// required for the breaker itself to work.

const state = new Map(); // key -> { consecutiveFailures, openUntil }

function getState(key) {
  let s = state.get(key);
  if (!s) {
    s = { consecutiveFailures: 0, openUntil: 0 };
    state.set(key, s);
  }
  return s;
}

// True while the circuit is open and not yet eligible for a half-open trial call.
// Once `openUntil` has passed, exactly one caller is let through (isOpen returns
// false) to test recovery — recordSuccess/recordFailure below decide whether that
// trial closes the circuit or re-opens it.
function isOpen(key) {
  const s = getState(key);
  return s.openUntil > Date.now();
}

function recordSuccess(key) {
  const s = getState(key);
  s.consecutiveFailures = 0;
  s.openUntil = 0;
  s.lastSuccessAt = Date.now();
}

function recordFailure(key, breaker) {
  const s = getState(key);
  s.consecutiveFailures += 1;
  s.lastFailureAt = Date.now();
  if (s.consecutiveFailures >= breaker.failureThreshold) {
    s.openUntil = Date.now() + breaker.cooldownMs;
    s.lastOpenedAt = Date.now();
  }
}

// Scraper-health stopgap (reliability plan) — a minimal read of what's currently tracked, for the
// admin health endpoint in index.js. Only keys that have actually gone through runScraper()
// at least once appear here (the Map is populated lazily by recordSuccess/recordFailure) —
// the endpoint fills in "no data yet" for every other manifest key itself, so an unexercised
// key isn't confused with a genuinely healthy one. This is deliberately a thin read of the
// same in-memory Map the breaker already uses, not a new store — WS0.8's real dashboard
// (persisted history, 7-day success rate) is still separate, larger, future work.
function getSnapshot(key) {
  const s = state.get(key);
  if (!s) return null;
  return {
    consecutiveFailures: s.consecutiveFailures,
    isOpen: isOpen(key),
    openUntil: s.openUntil > 0 ? new Date(s.openUntil).toISOString() : null,
    lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null,
    lastFailureAt: s.lastFailureAt ? new Date(s.lastFailureAt).toISOString() : null,
    lastOpenedAt: s.lastOpenedAt ? new Date(s.lastOpenedAt).toISOString() : null,
  };
}

// Builds the full report served by GET /api/admin/scraper-health — a pure function of
// `scrapers` (manifest.js's SCRAPERS list, passed in rather than required here to keep this
// module dependency-free and directly unit-testable with a synthetic scraper list) and this
// module's own in-memory state. No I/O, so it's testable without a live server or network.
function buildHealthReport(scrapers) {
  const rows = scrapers.map((entry) => {
    const snapshot = getSnapshot(entry.key);
    const status = !snapshot
      ? 'no-data'
      : snapshot.isOpen
      ? 'open'
      : snapshot.consecutiveFailures > 0
      ? 'degraded'
      : 'healthy';
    return {
      key: entry.key,
      label: entry.label,
      jurisdiction: entry.jurisdiction,
      bucket: entry.bucket,
      mvpScope: entry.mvpScope,
      breakerWrapped: entry.mvpScope,
      timeoutMs: entry.timeoutMs,
      status,
      ...(snapshot ?? {
        consecutiveFailures: null,
        isOpen: null,
        openUntil: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastOpenedAt: null,
      }),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    note:
      'Stopgap read of in-memory breaker state — resets on every process restart, and ' +
      '"no-data" means this key has not gone through a search since the last restart, not ' +
      'that it is unhealthy. Only mvpScope:true keys ever populate (breakerWrapped keys).',
    scrapers: rows,
  };
}

// Test-only: reset all tracked state between test files.
function _resetAll() {
  state.clear();
}

module.exports = { isOpen, recordSuccess, recordFailure, getSnapshot, buildHealthReport, _resetAll };
