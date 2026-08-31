/**
 * TEST: VIC Building and Plumbing Commission — Compliance and Enforcement Register
 *
 * PURPOSE
 *   Verifies that searchVicBpc() returns a result for a practitioner confirmed
 *   to be on the BPC compliance-and-enforcement register.
 *
 *   The VBA (Victorian Building Authority) rebranded to the Building and
 *   Plumbing Commission and its old prosecution & disciplinary register
 *   (vba.vic.gov.au/tools/prosecution-and-disciplinary-register, List.js
 *   search + .accordion__block markup) now redirects to a completely
 *   different SPA at bpc.vic.gov.au/compliance-and-enforcement-register. That
 *   page fetches its whole ~943-record dataset from a backend API up front and
 *   filters client-side — the API ignores query strings entirely, so there is
 *   no server-side search left to drive. vicBpcDataset.js fetches the full
 *   register once (via a Puppeteer page, since the API is Cloudflare-gated)
 *   and caches it; vicBpc.js matches names against that cached list locally.
 *
 *   This test fetches the dataset directly first to discover/confirm a live
 *   fixture, then calls the full scraper and confirms the same entry comes
 *   back through it.
 *
 *     • Dataset fetch returns 0 records        → API/pagination broken, or
 *       Cloudflare is blocking the headless browser (check vicBpcDataset.js)
 *     • Dataset has records but scraper misses → name-matching or mapping
 *       logic broken (check vicBpc.js)
 *     • Dataset has records and scraper finds  → PASS
 *
 * REQUIREMENTS
 *   Puppeteer (installed in server/node_modules) — no API keys needed.
 *
 * USAGE
 *   node server/tests/test-vicbpc.js
 *   node server/tests/test-vicbpc.js --name "Paul Matei"
 *
 * EXIT CODE
 *   0 — fixture practitioner found by scraper
 *   1 — not found or error at any layer
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: dataset fetch returned 0 records"
 *     → BPC changed their API shape/pagination, or Cloudflare is blocking the
 *       headless browser (check fetchVbaBpcRecords in vicBpcDataset.js)
 *   "Step 3 FAIL: scraper returned 0 results"
 *     → nameMatchesEntity is filtering out the fixture, or the mapping in
 *       vicBpc.js's mapRecordToResult broke
 *   "Step 4 FAIL: fixture not in results"
 *     → nameMatchesEntity filter is too strict; check the significant-word
 *       threshold (> 3 chars, not stopwords) in server/scrapers/vicBpc.js
 */

'use strict';

const path = require('path');
const { searchVicBpc } = require(path.join(__dirname, '../scrapers/vicBpc'));
const { fetchVbaBpcRecords, REGISTER_PAGE_URL } = require(path.join(__dirname, '../scrapers/vicBpcDataset'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('VIC Building and Plumbing Commission — Compliance and Enforcement Register Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Fetch the dataset directly (Puppeteer + Cloudflare bypass) ─────
  step('Step 1: Fetching BPC compliance-and-enforcement dataset via fetchVbaBpcRecords()...');
  step(`  (Loads ${REGISTER_PAGE_URL} in Puppeteer, then paginates the backend API from inside the page — allow ~10-30s)`);

  let records;
  try {
    const result = await fetchVbaBpcRecords();
    records = result.records;
    if (result.stale) {
      warn(`Dataset came from stale cache (cachedAt: ${result.cachedAt.toISOString()}) — live fetch failed.`);
    }
  } catch (e) {
    fail('Step 1', `fetchVbaBpcRecords threw: ${e.message}`, e.stack);
    warn('  Check whether the BPC site is accessible and the API/pagination shape is unchanged.');
    summary(0, 1);
    process.exit(1);
  }

  if (!Array.isArray(records) || records.length === 0) {
    fail('Step 1',
      'Dataset fetch returned 0 records.\n' +
      'BPC may have changed their API shape or pagination, or Cloudflare is blocking the headless browser.\n' +
      `Register page: ${REGISTER_PAGE_URL}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 1', `Fetched ${records.length} records from the BPC register`);
  passed++;

  // ── Step 2: Pick a fixture name ─────────────────────────────────────────────
  step('Step 2: Selecting a fixture name from the fetched dataset...');

  let fixtureName = suppliedName;

  if (!fixtureName) {
    const first = records.find((r) => r.title && r.title.trim().length > 0);
    if (!first) {
      fail('Step 2', 'No record in the dataset has a usable "title" field.',
        records.slice(0, 2));
      failed++;
      summary(passed, failed);
      process.exit(1);
    }
    fixtureName = first.title.trim();
  }

  pass('Step 2', `Test fixture: "${fixtureName}"`);
  passed++;

  const fixtureInDataset = records.some((r) => (r.title || '').trim() === fixtureName);
  if (!fixtureInDataset && !suppliedName) {
    warn('Fixture name not found by exact match in dataset titles — proceeding anyway.');
  }

  // ── Step 3: Call searchVicBpc ────────────────────────────────────────────────
  step(`Step 3: Calling searchVicBpc("${fixtureName}", "", ["${fixtureName}"])...`);

  let result;
  try {
    result = await searchVicBpc(fixtureName, '', [fixtureName]);
  } catch (e) {
    fail('Step 3', `searchVicBpc threw: ${e.message}`, e.stack);
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
      '    record.title (see nameMatchesEntity in server/scrapers/vicBpc.js)\n' +
      '  • mapRecordToResult or the fetchVbaBpcRecords cache is out of sync');
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
    fakeResult = await searchVicBpc('Zzqxv Nonexistentium Corporation Pty Ltd', '', []);
  } catch (e) {
    fail('Step 5', `searchVicBpc threw for a fake name: ${e.message}`, e.stack);
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
