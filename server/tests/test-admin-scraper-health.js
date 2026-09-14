/**
 * TEST: scraper-health stopgap admin endpoint (reliability plan)
 *
 * PURPOSE
 *   Regression coverage for scraperHealth.js's buildHealthReport() — the pure function
 *   behind GET /api/admin/scraper-health, added as a minimal stand-in for the real WS0.8
 *   dashboard (not built yet). No live server/network needed: this calls the function
 *   directly with a synthetic scraper list and drives scraperHealth's real in-memory state
 *   via its public recordSuccess/recordFailure/isOpen API, the same way runScraper.js does.
 *
 * USAGE
 *   node server/tests/test-admin-scraper-health.js
 *
 * EXIT CODE
 *   0 — all pilots passed   1 — any pilot failed
 */

'use strict';

const path = require('path');
const scraperHealth = require(path.join(__dirname, '../scrapers/scraperHealth'));
const { pass, fail, step, header, summary } = require('./lib/helpers');

const FAKE_SCRAPERS = [
  { key: 'fakeHealthy', label: 'Fake Healthy', jurisdiction: 'national', bucket: 2, mvpScope: true, timeoutMs: 20_000 },
  { key: 'fakeDegraded', label: 'Fake Degraded', jurisdiction: 'nsw', bucket: 2, mvpScope: true, timeoutMs: 20_000 },
  { key: 'fakeOpen', label: 'Fake Open', jurisdiction: 'act', bucket: 4, mvpScope: true, timeoutMs: 90_000 },
  { key: 'fakeNoData', label: 'Fake No Data', jurisdiction: 'national', bucket: 1, mvpScope: true, timeoutMs: 10_000 },
  { key: 'fakeNonMvp', label: 'Fake Non-MVP', jurisdiction: 'qld', bucket: 3, mvpScope: false, timeoutMs: 10_000 },
];

const BREAKER = { failureThreshold: 3, cooldownMs: 5 * 60_000 };

let passed = 0;
let failed = 0;
function check(label, cond, msg, details) {
  if (cond) {
    pass(label, msg);
    passed++;
  } else {
    fail(label, msg, details);
    failed++;
  }
}

header('WS4.1b — Admin scraper-health endpoint (buildHealthReport)');

scraperHealth._resetAll();

step('Pilot 1: an untouched key reports status "no-data"...');
{
  const report = scraperHealth.buildHealthReport(FAKE_SCRAPERS);
  const row = report.scrapers.find((s) => s.key === 'fakeNoData');
  check('Pilot 1', row && row.status === 'no-data' && row.lastSuccessAt === null,
    `fakeNoData → status=${row && row.status}`, row);
}

step('Pilot 2: a key with one recorded success reports "healthy" with a timestamp...');
{
  scraperHealth.recordSuccess('fakeHealthy');
  const report = scraperHealth.buildHealthReport(FAKE_SCRAPERS);
  const row = report.scrapers.find((s) => s.key === 'fakeHealthy');
  check('Pilot 2', row && row.status === 'healthy' && typeof row.lastSuccessAt === 'string',
    `fakeHealthy → status=${row && row.status}, lastSuccessAt=${row && row.lastSuccessAt}`, row);
}

step('Pilot 3: a key with failures below threshold reports "degraded", not "open"...');
{
  scraperHealth.recordFailure('fakeDegraded', BREAKER);
  const report = scraperHealth.buildHealthReport(FAKE_SCRAPERS);
  const row = report.scrapers.find((s) => s.key === 'fakeDegraded');
  check('Pilot 3', row && row.status === 'degraded' && row.isOpen === false && row.consecutiveFailures === 1,
    `fakeDegraded → status=${row && row.status}, consecutiveFailures=${row && row.consecutiveFailures}`, row);
}

step('Pilot 4: a key at/above failureThreshold reports "open" with openUntil/lastOpenedAt set...');
{
  scraperHealth.recordFailure('fakeOpen', BREAKER);
  scraperHealth.recordFailure('fakeOpen', BREAKER);
  scraperHealth.recordFailure('fakeOpen', BREAKER);
  const report = scraperHealth.buildHealthReport(FAKE_SCRAPERS);
  const row = report.scrapers.find((s) => s.key === 'fakeOpen');
  check('Pilot 4', row && row.status === 'open' && row.isOpen === true && !!row.openUntil && !!row.lastOpenedAt,
    `fakeOpen → status=${row && row.status}, openUntil=${row && row.openUntil}`, row);
}

step('Pilot 5: a non-mvp-scope key never populates (no data even if never called through the breaker)...');
{
  const report = scraperHealth.buildHealthReport(FAKE_SCRAPERS);
  const row = report.scrapers.find((s) => s.key === 'fakeNonMvp');
  check('Pilot 5', row && row.status === 'no-data' && row.mvpScope === false && row.breakerWrapped === false,
    `fakeNonMvp → status=${row && row.status}, breakerWrapped=${row && row.breakerWrapped}`, row);
}

step('Pilot 6: report shape carries generatedAt + note + exactly one row per input scraper...');
{
  const report = scraperHealth.buildHealthReport(FAKE_SCRAPERS);
  check('Pilot 6',
    typeof report.generatedAt === 'string' && typeof report.note === 'string' && report.scrapers.length === FAKE_SCRAPERS.length,
    `generatedAt=${report.generatedAt}, scrapers.length=${report.scrapers.length}`, report);
}

scraperHealth._resetAll();

summary(passed, failed);
process.exit(failed > 0 ? 1 : 0);
