'use strict';

const { getPool } = require('./db');

// WS0.8 (reliability plan) — persisted history behind the reliability dashboard, backed by
// the health_check_event table (server/db/schema.sql). Companion to scraperHealth.js's
// in-memory breaker state: that module answers "is this key healthy right now," this one
// answers "how has it behaved over the last N days." Same injectable-pool DI style as
// datasetStore.js, so tests can pass a fake pool instead of a real Postgres connection.

// Best-effort insert — no-ops when no pool is configured (DATABASE_URL unset, the normal
// local-dev state per CLAUDE.md), and never throws or rejects. Callers (runScraper.js) fire
// this without awaiting it; the try/catch here plus the caller's own .catch(() => {}) is
// deliberate double protection against the exact unhandled-rejection process crash documented
// in CLAUDE.md's WS4.2 entry (abnPromise/asicPromise) — this function must never be the thing
// that takes the server down.
async function logEvent(key, outcome, error, pool = getPool()) {
  if (!pool) return;
  try {
    await pool.query(
      'INSERT INTO health_check_event (scraper_key, outcome, error) VALUES ($1, $2, $3)',
      [key, outcome, error ?? null]
    );
  } catch (err) {
    console.warn(`[healthHistory] failed to log event for ${key}:`, err.message);
  }
}

// Returns { [scraperKey]: { attempts, successes, successRate } } for the trailing
// `windowDays`, or null (not an empty object) when no pool is configured — callers should
// render "no persisted history available" rather than a misleading 0%/0 row for that case.
// Only 'success'/'failure' count toward attempts/successRate; 'circuit_open' rows are
// excluded from this rollup (they represent skipped calls, not attempted ones) but remain
// in the table for the dashboard to show separately if useful later.
async function getRollup({ windowDays = 7 } = {}, pool = getPool()) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT scraper_key,
            COUNT(*) FILTER (WHERE outcome = 'success') AS successes,
            COUNT(*) FILTER (WHERE outcome IN ('success', 'failure')) AS attempts
       FROM health_check_event
      WHERE occurred_at > now() - ($1 || ' days')::interval
      GROUP BY scraper_key`,
    [String(windowDays)]
  );

  const result = {};
  for (const row of rows) {
    const attempts = Number(row.attempts);
    const successes = Number(row.successes);
    result[row.scraper_key] = {
      attempts,
      successes,
      successRate: attempts > 0 ? successes / attempts : null,
    };
  }
  return result;
}

// Pure merge of scraperHealth.buildHealthReport()'s live snapshot with getRollup()'s
// persisted-history result — extracted so it's directly unit-testable (same reasoning as
// buildHealthReport itself being pure: no live server or DB needed to test the merge logic).
// `rollup` is whatever getRollup() returned, including null (no DB configured).
function mergeHistory(report, rollup) {
  const scrapers = report.scrapers.map((row) => {
    const history = rollup ? rollup[row.key] : undefined;
    return {
      ...row,
      historyAvailable: rollup !== null,
      attempts7d: history ? history.attempts : null,
      successRate7d: history ? history.successRate : null,
    };
  });
  return { ...report, scrapers };
}

module.exports = { logEvent, getRollup, mergeHistory };
