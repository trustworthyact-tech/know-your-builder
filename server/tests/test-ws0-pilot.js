/**
 * TEST: WS0 pilot integration (reliability plan)
 *
 * PURPOSE
 *   Proves the WS0 foundations (manifest, result contract, Postgres-backed dataset
 *   store, circuit breaker/timeout wrapper) work end-to-end against two real,
 *   already-existing scrapers — one per bucket — before WS1/WS2 commit ~15 more
 *   scrapers to the same machinery. Runs standalone from server/index.js's live
 *   /api/search route; nothing here changes production request behaviour (that
 *   cutover is WS4 activity 4.1).
 *
 *   Pilot 1 (bucket 1, dataset): asicDisqualified, now backed by datasetStore.js
 *     (Postgres, with a disk-JSON fallback baked into that module — no DATABASE_URL
 *     is required for this test to pass, since it exercises the fallback path in
 *     any environment without one configured).
 *   Pilot 2 (bucket 2, live API): nswFairTrading, run through runScraper.js so its
 *     timeout + breaker wiring is exercised on a real live call.
 *   Pilot 3 (mechanism proof, no network): a synthetic always-hanging scraper run
 *     through runScraper.js with a short timeout, proving the timeout fires and the
 *     breaker opens on repeated failure — the full state-machine behaviour is
 *     already covered by scrapers/runScraper.test.js's unit tests; this just proves
 *     it wired correctly through a real manifest entry end-to-end.
 *
 * FIXTURE
 *   CONSTRUCTION VICTORIA PROPRIETARY LIMITED / director Veronica Roberts — the
 *   same fixture used throughout CLAUDE.md's ASIC DPN incident history (5 known
 *   register entries). Universal Property Group Pty Limited / licence 85273C — the
 *   fixture from CLAUDE.md's NSW Fair Trading migration entry.
 *
 * USAGE
 *   node server/tests/test-ws0-pilot.js
 *
 * EXIT CODE
 *   0 — all pilots passed   1 — any pilot failed
 */

'use strict';

const path = require('path');
const { getScraper } = require(path.join(__dirname, '../scrapers/manifest'));
const { runScraper } = require(path.join(__dirname, '../scrapers/runScraper'));
const { searchASICDisqualifiedFromDataset } = require(path.join(__dirname, '../scrapers/asicDpnMatch'));
const { searchNSWFairTrading } = require(path.join(__dirname, '../scrapers/nswFairTrading'));
const { pass, fail, step, header, summary } = require('./lib/helpers');

function collector() {
  const sent = [];
  return { sent, send: (r) => sent.push(r) };
}

(async () => {
  header('WS0 Pilot Integration — manifest + runScraper + datasetStore');
  let passed = 0;
  let failed = 0;

  // ── Pilot 1: asicDisqualified through datasetStore.js (bucket 1) ─────────────
  step('Pilot 1: asicDisqualified for director "Veronica Roberts" via runScraper + datasetStore...');
  {
    const entry = getScraper('asicDisqualified');
    const { sent, send } = collector();
    await runScraper(entry, () => searchASICDisqualifiedFromDataset(['Veronica Roberts']), { send });

    const done = sent.find((s) => s.status === 'done');
    if (!done) {
      fail('Pilot 1', 'Expected a done result', sent);
      failed++;
    } else if (!done.results || done.results.length === 0) {
      fail('Pilot 1', 'Expected at least one disqualification record for this known fixture', done);
      failed++;
    } else {
      pass('Pilot 1', `Found ${done.results.length} disqualification record(s) via runScraper + datasetStore`);
      step(`  summary: "${done.summary}"`);
      passed++;
    }
  }

  // ── Pilot 2: nswFairTrading through runScraper.js (bucket 2, live API) ───────
  step('Pilot 2: nswFairTrading for "Universal Property Group Pty Limited" via runScraper...');
  {
    const entry = getScraper('nswFairTrading');
    const { sent, send } = collector();
    await runScraper(entry, () => searchNSWFairTrading('Universal Property Group Pty Limited', '98078297748', []), { send });

    const done = sent.find((s) => s.status === 'done');
    if (!done) {
      fail('Pilot 2', 'Expected a done result (live NSW Fair Trading call)', sent);
      failed++;
    } else if (!done.results || done.results.length === 0) {
      fail('Pilot 2', 'Expected licence 85273C for this known fixture', done);
      failed++;
    } else {
      pass('Pilot 2', `Found ${done.results.length} licence result(s) via runScraper`);
      step(`  summary: "${done.summary}"`);
      passed++;
    }
  }

  // ── Pilot 3: timeout + breaker fire through a real manifest entry ────────────
  step('Pilot 3: a hanging scraper is cut off by its manifest timeout and opens the breaker...');
  {
    const entry = { ...getScraper('nswFairTrading'), key: 'ws0_pilot_synthetic', timeoutMs: 30, breaker: { failureThreshold: 1, cooldownMs: 5_000 } };
    const hang = () => new Promise(() => {});

    const { sent: firstAttempt, send: send1 } = collector();
    await runScraper(entry, hang, { send: send1 });
    const timedOut = firstAttempt.find((s) => s.status === 'error');

    const { sent: secondAttempt, send: send2 } = collector();
    let hangCalledAgain = false;
    await runScraper(entry, () => { hangCalledAgain = true; return hang(); }, { send: send2 });

    if (!timedOut) {
      fail('Pilot 3', 'Expected the hanging call to time out and send an error result', firstAttempt);
      failed++;
    } else if (hangCalledAgain) {
      fail('Pilot 3', 'Circuit should have been open on the second call — fn should not have been invoked');
      failed++;
    } else if (secondAttempt[0]?.status !== 'error') {
      fail('Pilot 3', 'Expected the open circuit to short-circuit with an error result', secondAttempt);
      failed++;
    } else {
      pass('Pilot 3', 'Timeout fired on call 1, breaker opened and short-circuited call 2 without invoking fn');
      passed++;
    }
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
