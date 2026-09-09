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
}

function recordFailure(key, breaker) {
  const s = getState(key);
  s.consecutiveFailures += 1;
  if (s.consecutiveFailures >= breaker.failureThreshold) {
    s.openUntil = Date.now() + breaker.cooldownMs;
  }
}

// Test-only: reset all tracked state between test files.
function _resetAll() {
  state.clear();
}

module.exports = { isOpen, recordSuccess, recordFailure, _resetAll };
