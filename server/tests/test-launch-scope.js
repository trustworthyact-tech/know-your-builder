/**
 * TEST: Launch scope — national + NSW + ACT only (2026-09-22)
 *
 * PURPOSE
 *   Know Your Builder launched covering national registers plus NSW and ACT
 *   courts/licensing only (see CLAUDE.md "Launch scope"). manifest.js's
 *   `ENABLED_JURISDICTIONS` env var (default `national,nsw,act`) computes an `inScope`
 *   flag per entry, and searchOrchestrator.js's `runSearchRequest()` filters SCRAPERS by
 *   that flag before either Promise.all loop. This test proves the wiring end to end: an
 *   out-of-scope key must never be invoked (no network call, no resource held) and must
 *   never appear in the streamed results at all — not a "disabled" placeholder, genuinely
 *   absent, matching manifest.js's own comment on the distinction from
 *   DISABLED_SCRAPER_KEYS.
 *
 *   Every mvpScope key's breaker is forced open first (same technique as
 *   test-ws4-fault-injection.js's Section A) so the 16 in-scope keys short-circuit near-
 *   instantly instead of making real network calls — this test doesn't need network
 *   access or real credentials to prove the filtering property.
 *
 * USAGE
 *   node server/tests/test-launch-scope.js
 *
 * EXIT CODE
 *   0 — all assertions passed   1 — any assertion failed
 */

'use strict';

const path = require('path');
const { SCRAPERS, getScraper } = require(path.join(__dirname, '../scrapers/manifest'));
const scraperHealth = require(path.join(__dirname, '../scrapers/scraperHealth'));
const { runSearchRequest } = require(path.join(__dirname, '../searchOrchestrator'));
const { pass, fail, step, header, summary } = require('./lib/helpers');

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

function openBreaker(key) {
  const { breaker } = getScraper(key);
  for (let i = 0; i < breaker.failureThreshold; i++) {
    scraperHealth.recordFailure(key, breaker);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  header('Launch scope — national + NSW + ACT only');

  const inScopeKeys = SCRAPERS.filter((s) => s.inScope).map((s) => s.key);
  const outOfScopeKeys = SCRAPERS.filter((s) => !s.inScope).map((s) => s.key);

  check(
    'default-scope-matches-launch-plan',
    inScopeKeys.length === 16 && outOfScopeKeys.length === 13,
    `${inScopeKeys.length} in-scope / ${outOfScopeKeys.length} out-of-scope keys under the default ENABLED_JURISDICTIONS (expected 16/13 — see CLAUDE.md "Launch scope")`,
    { inScopeKeys, outOfScopeKeys }
  );

  step('Forcing every in-scope mvpScope key\'s breaker open, then running the real pipeline...');
  scraperHealth._resetAll();
  for (const key of inScopeKeys) {
    if (getScraper(key).mvpScope) openBreaker(key);
  }

  const seen = new Map(); // key -> events[]
  const send = (r) => {
    if (!seen.has(r.key)) seen.set(r.key, []);
    seen.get(r.key).push(r);
  };

  runSearchRequest(
    { abn: '98078297748', companyName: 'Universal Property Group Pty Limited', directors: [] },
    { send }
  ).catch((err) => {
    fail('runSearchRequest', 'rejected — every scraper path must catch its own errors', err);
    failed++;
  });
  await wait(4_000);

  const leaked = outOfScopeKeys.filter((k) => seen.has(k));
  check(
    'no-out-of-scope-key-ever-sent',
    leaked.length === 0,
    leaked.length === 0
      ? 'none of the 13 out-of-scope keys ever received a send() call'
      : `${leaked.length} out-of-scope key(s) were sent: ${leaked.join(', ')} — the scope filter is not excluding them from invocation`,
    leaked
  );

  const missingInScope = inScopeKeys.filter((k) => !seen.has(k));
  check(
    'every-in-scope-key-still-reports',
    missingInScope.length === 0,
    missingInScope.length === 0
      ? 'all 16 in-scope keys reported at least one event within 4s of an open circuit'
      : `${missingInScope.length} in-scope key(s) never reported: ${missingInScope.join(', ')}`,
    missingInScope
  );

  scraperHealth._resetAll();
  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
}

main();
