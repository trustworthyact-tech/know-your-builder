/**
 * TEST: ASIC — Court Enforceable Undertakings Register
 *
 * PURPOSE
 *   Verifies that searchAsicEnforceableUndertakings() returns a result for a
 *   party confirmed to be on ASIC's Court Enforceable Undertakings register.
 *
 *   Unlike most ASIC registers, this one has no bulk/open-data API (confirmed
 *   by querying data.gov.au's CKAN Action API for ASIC's organization — it
 *   publishes only 12 unrelated datasets). It IS, however, a single fully
 *   public, unauthenticated static HTML page listing every undertaking since
 *   1998 (~500 records) with no pagination and no JS rendering required.
 *   asicEnforceableUndertakingsDataset.js fetches and caches that whole page
 *   once; asicEnforceableUndertakings.js matches names against the cached
 *   list locally — same shape as vicBpc.js/vicBpcDataset.js.
 *
 *   This test fetches the dataset directly first to discover/confirm a live
 *   fixture, then calls the full scraper and confirms the same entry comes
 *   back through it.
 *
 *     • Dataset fetch returns 0 records        → page markup changed (check
 *       asicEnforceableUndertakingsDataset.js's table.asic-table selector)
 *     • Dataset has records but scraper misses → name-matching or mapping
 *       logic broken (check asicEnforceableUndertakings.js)
 *     • Dataset has records and scraper finds  → PASS
 *
 * REQUIREMENTS
 *   None — plain axios/cheerio, no Puppeteer, no API keys.
 *
 * USAGE
 *   node server/tests/test-asic-eu.js
 *   node server/tests/test-asic-eu.js --name "Sandeep Kumar"
 *
 * EXIT CODE
 *   0 — fixture party found by scraper
 *   1 — not found or error at any layer
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: dataset fetch returned 0 records"
 *     → ASIC changed the register page's markup (check parseRecords in
 *       asicEnforceableUndertakingsDataset.js — table.asic-table selector,
 *       or the 4-column td layout)
 *   "Step 3 FAIL: scraper returned 0 results"
 *     → nameMatchesEntity is filtering out the fixture, or mapRecordToResult
 *       broke in asicEnforceableUndertakings.js
 *   "Step 4 FAIL: fixture not in results"
 *     → nameMatchesEntity filter is too strict; check the significant-word
 *       threshold (> 3 chars, not stopwords) in the same file
 */

'use strict';

const path = require('path');
const { searchAsicEnforceableUndertakings } = require(path.join(__dirname, '../scrapers/asicEnforceableUndertakings'));
const { fetchAsicEuRecords, REGISTER_URL } = require(path.join(__dirname, '../scrapers/asicEnforceableUndertakingsDataset'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('ASIC — Court Enforceable Undertakings Register Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Fetch the dataset directly ─────────────────────────────────────
  step('Step 1: Fetching the CEU register via fetchAsicEuRecords()...');
  step(`  (Plain GET of ${REGISTER_URL} — allow ~5-15s)`);

  let records;
  try {
    const result = await fetchAsicEuRecords();
    records = result.records;
    if (result.stale) {
      warn(`Dataset came from stale cache (cachedAt: ${result.cachedAt.toISOString()}) — live fetch failed.`);
    }
  } catch (e) {
    fail('Step 1', `fetchAsicEuRecords threw: ${e.message}`, e.stack);
    warn('  Check whether the register page is reachable and its markup is unchanged.');
    summary(0, 1);
    process.exit(1);
  }

  if (!Array.isArray(records) || records.length === 0) {
    fail('Step 1',
      'Dataset fetch returned 0 records.\n' +
      'ASIC may have changed the register page markup.\n' +
      `Register page: ${REGISTER_URL}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 1', `Fetched ${records.length} records from the CEU register`);
  passed++;

  // ── Step 2: Pick a fixture name ─────────────────────────────────────────────
  step('Step 2: Selecting a fixture name from the fetched dataset...');

  let fixtureName = suppliedName;

  if (!fixtureName) {
    const first = records.find((r) => r.partyText && r.partyText.trim().length > 0);
    if (!first) {
      fail('Step 2', 'No record in the dataset has a usable "partyText" field.',
        records.slice(0, 2));
      failed++;
      summary(passed, failed);
      process.exit(1);
    }
    // Take the first semicolon-separated party name only (partyText can list
    // multiple parties, e.g. "X Pty Ltd and Y Limited") for a clean query.
    fixtureName = first.partyText.split(/\s+and\s+|;/i)[0].trim();
  }

  pass('Step 2', `Test fixture: "${fixtureName}"`);
  passed++;

  // ── Step 3: Call searchAsicEnforceableUndertakings ─────────────────────────
  step(`Step 3: Calling searchAsicEnforceableUndertakings("${fixtureName}", ["${fixtureName}"])...`);

  let result;
  try {
    result = await searchAsicEnforceableUndertakings(fixtureName, [fixtureName]);
  } catch (e) {
    fail('Step 3', `searchAsicEnforceableUndertakings threw: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 3', 'scraper returned without throwing');
  step(`  Summary: "${result.summary}"`);
  step(`  Results count: ${result.results.length}`);

  if (result.status === 'error') {
    fail('Step 3', `Scraper returned status: 'error' — ${result.summary}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  if (result.results.length === 0) {
    fail('Step 3',
      'Scraper returned 0 results even though the entry exists in the fetched dataset.\n' +
      'Possible causes:\n' +
      '  • nameMatchesEntity filtering too strict — all significant words must appear in\n' +
      '    record.partyText (see nameMatchesEntity in server/scrapers/asicEnforceableUndertakings.js)\n' +
      '  • mapRecordToResult or the fetchAsicEuRecords cache is out of sync');
    failed++;
    summary(passed, failed);
    process.exit(1);
  }
  passed++;

  step('  Sample results:');
  result.results.slice(0, 3).forEach((r, i) =>
    dump(`Result ${i + 1}`, { title: r.title, date: r.date, status: r.status, description: r.description?.slice(0, 120) }));

  // ── Step 4: Verify fixture appears in results ──────────────────────────────
  step(`Step 4: Checking if "${fixtureName}" appears in results...`);

  function normalise(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(); }
  const qWords = normalise(fixtureName).split(/\s+/).filter((w) => w.length > 3 && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));

  const found = result.results.some((r) => {
    const text = normalise(r.title + ' ' + (r.description || ''));
    return qWords.length > 0 && qWords.every((w) => text.includes(w));
  });

  if (!found) {
    fail('Step 4',
      `"${fixtureName}" not found in scraper results.\n` +
      `Significant words being matched (>3 chars, non-stopword): ${JSON.stringify(qWords)}\n` +
      'Returned titles:',
      result.results.map((r) => r.title));
    failed++;
  } else {
    pass('Step 4', `"${fixtureName}" confirmed in scraper results`);
    passed++;
  }

  // ── Step 5: Sanity check — a clearly-fake name yields an empty, non-error result
  step('Step 5: Checking a clearly-fake name returns an empty (not error) result...');

  let fakeResult;
  try {
    fakeResult = await searchAsicEnforceableUndertakings('Zzqxv Nonexistentium Corporation Pty Ltd', []);
  } catch (e) {
    fail('Step 5', `searchAsicEnforceableUndertakings threw for a fake name: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  if (fakeResult.status === 'error') {
    fail('Step 5', `Fake-name search unexpectedly returned status: 'error' — ${fakeResult.summary}`);
    failed++;
  } else if (fakeResult.results.length !== 0) {
    fail('Step 5', `Fake-name search unexpectedly returned ${fakeResult.results.length} result(s)`,
      fakeResult.results.map((r) => r.title));
    failed++;
  } else {
    pass('Step 5', 'Fake name correctly returned 0 results, no error');
    passed++;
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
