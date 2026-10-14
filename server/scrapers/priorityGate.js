'use strict';

// A counting semaphore with two priority tiers, shared by proxyLimiter.js (proxy slots) and
// browser.js (headless-browser page slots). Extracted from proxyLimiter.js's original gate
// (LICENCE_MATCHING_PLAN.md Phase 1.3) for DATA_SOURCES_PLAN.md Phase 4, which needs the same
// behaviour in several places: per-site and overall residential-proxy limits, the ScrapeOps
// account limit, and Federal Court's priority on the browser pool.
//
// Follows the browser-pool design principles recorded in CLAUDE.md (2026-10-02):
// - two tiers only, 'high' and 'normal'; anything other than 'high' is normal (an unknown or
//   missing flag defaults low, never high);
// - FIFO within a tier, and no preemption: priority only decides who gets the next freed slot;
// - a starvation bound: after `maxHighStreak` consecutive high grants while normal callers are
//   waiting, one normal caller goes next;
// - `release()` checks the high queue first and the normal queue only as a fallback;
// - `acquire()` resolves with how long the caller waited, so callers can log it per tier.
//
// `limit` is a function so an env var can be read at call time (tests change it per case).

const DEFAULT_MAX_HIGH_STREAK = 4;

function createGate({ limit, maxHighStreak = DEFAULT_MAX_HIGH_STREAK }) {
  let active = 0;
  let highStreak = 0;
  const waiters = { high: [], normal: [] };

  function nextWaiter() {
    const preferNormal = highStreak >= maxHighStreak && waiters.normal.length > 0;
    if (waiters.high.length > 0 && !preferNormal) {
      highStreak++;
      return waiters.high.shift();
    }
    highStreak = 0;
    return waiters.normal.shift();
  }

  return {
    // A released slot is handed straight to the next waiter, so `active` only drops when
    // nobody is queued.
    async acquire(priority = 'normal') {
      if (active < limit()) {
        active++;
        return 0;
      }
      const start = Date.now();
      await new Promise((resolve) => waiters[priority === 'high' ? 'high' : 'normal'].push(resolve));
      return Date.now() - start;
    },
    release() {
      const next = nextWaiter();
      if (next) next();
      else active--;
    },
    stats: () => ({ active, waitingHigh: waiters.high.length, waitingNormal: waiters.normal.length }),
    _reset() {
      active = 0;
      highStreak = 0;
      waiters.high.length = 0;
      waiters.normal.length = 0;
    },
  };
}

module.exports = { createGate, DEFAULT_MAX_HIGH_STREAK };
