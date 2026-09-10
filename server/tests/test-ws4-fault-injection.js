/**
 * TEST: WS4.2 — End-to-end + fault injection (reliability plan)
 *
 * PURPOSE
 *   Regression coverage for the actual `runSearchRequest()` entry point added in WS4.1 —
 *   not the individual scrapers (already covered by test-ws2-live-hardening.js /
 *   test-ws3-director-discovery.js), but the pipeline wiring itself: does every mvpScope
 *   key really route through the circuit breaker, does an open circuit degrade honestly on
 *   every one of the 16 keys (never a false "complete"/"clean" result — the exact failure
 *   shape this whole reliability plan exists to prevent), and does courts_act really take
 *   its manual-fallback branch instead of the generic message.
 *
 *   Section A (the core of this file) forces every mvpScope key's breaker open *before*
 *   calling runSearchRequest, so none of the 16 wrapped keys ever reach their real fetch —
 *   runScraper's isOpen() check short-circuits first. That makes this section fast and
 *   network-independent, and it's the part that matters most: it proves the wiring, not
 *   any individual site's uptime.
 *
 *   Section B runs the real pipeline once against a fictitious entity, live, to check the
 *   "not found" case doesn't crash or fabricate results — this needs the network, so
 *   results are bounded to a fixed window and treated as informational if a particular
 *   external site happens to be flaky/blocked in the environment running this file, rather
 *   than failing the whole suite over a live-site or sandbox-network issue unrelated to the
 *   code under test (see CLAUDE.md's own "IP-reputation noise" caveat for the same class of
 *   thing in the GitHub Actions health check).
 *
 * USAGE
 *   node server/tests/test-ws4-fault-injection.js
 *
 * EXIT CODE
 *   0 — all hard assertions (Section A) passed   1 — any hard assertion failed
 *   Section B failures are logged as WARN, not counted against the exit code — see above.
 */

'use strict';

const path = require('path');
const { SCRAPERS, getScraper } = require(path.join(__dirname, '../scrapers/manifest'));
const scraperHealth = require(path.join(__dirname, '../scrapers/scraperHealth'));
const { runSearchRequest } = require(path.join(__dirname, '../searchOrchestrator'));
const { pass, fail, warn, step, header, summary } = require('./lib/helpers');

const MVP_KEYS = SCRAPERS.filter((s) => s.mvpScope).map((s) => s.key);

function collector() {
  const byKey = new Map();
  const send = (r) => {
    // Last write wins per key, matching how the real NDJSON stream is consumed client-side
    // (each key's UI row shows its latest status) — but keep every event too, since Section
    // A's "never a false-complete while open" assertion needs to check *all* events sent
    // for a key, not just the final one.
    if (!byKey.has(r.key)) byKey.set(r.key, []);
    byKey.get(r.key).push(r);
  };
  return { byKey, send };
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

async function sectionA() {
  step('Section A: force every mvpScope key\'s circuit breaker open, then run the real pipeline...');
  scraperHealth._resetAll();
  for (const key of MVP_KEYS) openBreaker(key);

  const { byKey, send } = collector();
  // Fire and forget — the 13 non-mvp keys still make real (possibly slow or hung, per
  // CLAUDE.md's documented history) network calls, but every mvpScope key should short-
  // circuit near-instantly since its breaker is already open, so we don't need to wait for
  // runSearchRequest's own returned promise (which only resolves once *all* 29 keys are
  // done) — just wait long enough for the 16 fast ones to have reported in.
  runSearchRequest(
    { abn: '98078297748', companyName: 'Universal Property Group Pty Limited', directors: [] },
    { send }
  ).catch((err) => {
    fail('Section A', 'runSearchRequest rejected — every scraper path must catch its own errors', err);
    failed++;
  });
  await wait(3_000);

  for (const key of MVP_KEYS) {
    const events = byKey.get(key) ?? [];
    const terminal = events.find((e) => e.status !== 'searching');

    check(
      `A:${key}:reached-terminal`,
      !!terminal,
      terminal ? `reported in (status=${terminal.status})` : 'never sent a non-"searching" event within 3s of an open circuit — should be near-instant',
      events
    );
    if (!terminal) continue;

    check(
      `A:${key}:unavailable`,
      terminal.completeness === 'unavailable',
      `completeness="${terminal.completeness}" (must be "unavailable" while the circuit is open)`,
      terminal
    );

    // The one invariant that matters most in this whole file: an open circuit must never
    // look like a clean, complete, checked result.
    const looksClean = terminal.status === 'done' || terminal.completeness === 'complete';
    check(
      `A:${key}:never-false-complete`,
      !looksClean,
      looksClean
        ? `FALSE-COMPLETE: status="${terminal.status}" completeness="${terminal.completeness}" — this is the exact silent-false-negative shape the reliability plan exists to prevent`
        : 'correctly did not present as complete/clean',
      terminal
    );
  }

  const actEvents = byKey.get('courts_act') ?? [];
  const actTerminal = actEvents.find((e) => e.status !== 'searching');
  check(
    'A:courts_act:manual-fallback-shape',
    !!actTerminal &&
      actTerminal.error === 'No automated source' &&
      typeof actTerminal.searchUrl === 'string' &&
      typeof actTerminal.acatSearchUrl === 'string',
    actTerminal
      ? `error="${actTerminal.error}", searchUrl set=${!!actTerminal.searchUrl}, acatSearchUrl set=${!!actTerminal.acatSearchUrl} — courts_act's open-circuit branch should degrade to buildManualFallback('act') (both links), not the generic "Temporarily unavailable" message`
      : 'courts_act never reported',
    actTerminal
  );

  scraperHealth._resetAll();
}

async function sectionB() {
  step('Section B (informational, live network): fictitious entity through the full pipeline...');
  const { byKey, send } = collector();
  runSearchRequest(
    { companyName: 'Zzyzx Nonexistent Construction Pty Ltd 999123', directors: [] },
    { send }
  ).catch(() => {});
  // Bounded to the longest mvpScope timeout (45s for courts_federal/courts_act) plus a
  // margin — non-mvp keys may still be running after this and that's fine, we only read
  // what's in `byKey` at the deadline.
  await wait(50_000);

  let allClean = true;
  for (const key of MVP_KEYS) {
    const events = byKey.get(key) ?? [];
    const terminal = events.find((e) => e.status !== 'searching');
    if (!terminal) {
      warn(`Section B: "${key}" never reached a terminal state within 50s (live network — informational, not counted against exit code)`);
      allClean = false;
      continue;
    }
    const resultCount =
      (terminal.results?.length ?? 0) +
      (terminal.licenceResults?.length ?? 0) +
      (terminal.adjudicationResults?.length ?? 0) +
      (terminal.enforcementResults?.length ?? 0);
    if (resultCount > 0) {
      warn(`Section B: "${key}" returned ${resultCount} result(s) for a fictitious entity — expected 0. Live-network result, not counted against exit code: ${JSON.stringify(terminal.summary)}`);
      allClean = false;
    }
  }
  if (allClean) {
    pass('Section B', 'every mvpScope key reached a terminal state with zero results for a fictitious entity (live network)');
  } else {
    warn('Section B: one or more keys above didn\'t behave as expected — re-run on a real network / with real credentials before treating this as a genuine regression (see file header).');
  }
}

async function main() {
  header('WS4.2 — End-to-end + fault injection');
  await sectionA();
  await sectionB();
  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
}

main();
