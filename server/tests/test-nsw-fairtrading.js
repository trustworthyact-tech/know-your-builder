/**
 * TEST: NSW Fair Trading — Contractor Licence Register (scraper function)
 *
 * PURPOSE
 *   Verifies that searchNSWFairTrading() returns a correctly shaped result when
 *   given an entity name that exists in the OneGov NSW licence register.
 *   The test self-discovers a fixture by POSTing to the OneGov API with a
 *   broad search term ("constructions"), then calls the full scraper function
 *   and confirms the same entity comes back.
 *
 *   This test is complementary to test-nsw-fairtrading-licence.js, which probes
 *   the raw API directly. This test focuses on the scraper FUNCTION — it ensures
 *   the return shape and nameMatchesEntity filtering work correctly end-to-end.
 *
 *   Two-layer comparison isolates failures:
 *     • Raw API returns licensees but scraper returns 0
 *       → nameMatchesEntity filter in searchNSWFairTrading is too strict,
 *         or the fixture name contains only short/stopword tokens
 *     • Raw API returns 0 results
 *       → OneGov endpoint or request format changed
 *     • Scraper throws
 *       → Network error, header rejection, or API shape changed
 *
 * REQUIREMENTS
 *   No API keys or Puppeteer needed — axios only (used by the scraper itself).
 *   OneGov requires Origin/Referer headers matching www.onegov.nsw.gov.au.
 *
 * USAGE
 *   node server/tests/test-nsw-fairtrading.js
 *   node server/tests/test-nsw-fairtrading.js --name "Lendlease Building"
 *
 * EXIT CODE
 *   0 — all steps passed (fixture entity found and shape validated)
 *   1 — any step failed (thrown error or wrong shape); 0 results is a WARN only
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: raw API returned 0 results"
 *     → The OneGov endpoint or POST body format may have changed.
 *       Check: POST https://api.onegov.nsw.gov.au/LicenceCheckService/api/Search/PerformSearch
 *       with { searchCriteria: "constructions", licenceGroupCode: "Trades", searchType: "fulltext" }
 *       Required headers: Origin/Referer from onegov.nsw.gov.au
 *   "Step 2 FAIL: could not extract licensee name from raw results"
 *     → The 'licensee' field is missing or empty. Check the raw API response
 *       shape — the field name may have changed in the OneGov API.
 *   "Step 3 FAIL: scraper threw"
 *     → searchNSWFairTrading() itself threw an exception. Check axios headers
 *       and POST body in server/scrapers/nswFairTrading.js.
 *   "Step 3 FAIL: return shape invalid"
 *     → The scraper returned an object missing required keys. Check the return
 *       statement in searchNSWFairTrading() in server/scrapers/nswFairTrading.js.
 *   "Step 4 WARN: 0 results returned"
 *     → The fixture name was returned by the raw API but filtered out by
 *       nameMatchesEntity inside searchNSWFairTrading. Check:
 *       (a) Significant words from the fixture name (>3 chars, non-stopword)
 *       (b) Whether those words appear verbatim in the 'licensee' field value
 *       (c) nameMatchesEntity in server/scrapers/nswFairTrading.js
 */

'use strict';

const path = require('path');
const axios = require('axios');
const { searchNSWFairTrading } = require(path.join(__dirname, '../scrapers/nswFairTrading'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

const SEARCH_URL = 'https://api.onegov.nsw.gov.au/LicenceCheckService/api/Search/PerformSearch';
const REGISTER_BASE = 'https://www.onegov.nsw.gov.au/publicregister';

const RAW_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: 'https://www.onegov.nsw.gov.au',
  Referer: 'https://www.onegov.nsw.gov.au/publicregister/',
};

// ── Parse CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// ── Utilities ──────────────────────────────────────────────────────────────────

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function sigWords(name) {
  return normalise(name)
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
}

// Return the first significant word of a name (>3 chars, non-stopword),
// or the first token if none qualify.
function firstSigWord(name) {
  const words = sigWords(name);
  return words[0] || normalise(name).split(/\s+/)[0] || '';
}

// ── Main ───────────────────────────────────────────────────────────────────────

(async () => {
  header('NSW Fair Trading — Contractor Licence Register Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Discover fixture via raw OneGov API ───────────────────────────
  step('Step 1: Querying OneGov NSW API for contractor licences...');
  step(`  URL: POST ${SEARCH_URL}`);
  step('  Body: { searchCriteria: "constructions", licenceGroupCode: "Trades", searchType: "fulltext" }');

  let rawHits = [];

  if (!suppliedName) {
    try {
      const { data } = await axios.post(
        SEARCH_URL,
        {
          searchCriteria: 'constructions',
          licenceGroupCode: 'Trades',
          searchType: 'fulltext',
          rowsPerPage: 10,
        },
        { headers: RAW_HEADERS, timeout: 20000 }
      );
      rawHits = Array.isArray(data?.licenceSearchResults) ? data.licenceSearchResults : [];
    } catch (e) {
      fail('Step 1', `Raw API request failed: ${e.message}`);
      summary(0, 1);
      process.exit(1);
    }

    if (rawHits.length === 0) {
      fail('Step 1',
        'Raw OneGov API returned 0 results for searchCriteria="constructions".\n' +
        'The endpoint or POST body format may have changed.\n' +
        `Check: POST ${SEARCH_URL}\n` +
        'Or run with --name "Entity Name" to skip fixture discovery.');
      summary(0, 1);
      process.exit(1);
    }

    pass('Step 1', `Found ${rawHits.length} raw result(s) from OneGov API`);
    passed++;
  } else {
    pass('Step 1', `Skipped — using supplied name: "${suppliedName}"`);
    passed++;
  }

  // ── Step 2: Extract fixture name ──────────────────────────────────────────
  step('Step 2: Extracting fixture name...');

  let fixtureName = suppliedName;

  if (!fixtureName) {
    // Prefer a licensee name that has at least one significant word so that
    // nameMatchesEntity inside the scraper has something to match against.
    for (const hit of rawHits) {
      const candidate = (hit.licensee || '').trim();
      if (candidate && sigWords(candidate).length > 0) {
        fixtureName = candidate;
        break;
      }
    }

    // Fall back to the first licensee name even if no sig words
    if (!fixtureName && rawHits.length > 0) {
      fixtureName = (rawHits[0].licensee || '').trim();
    }
  }

  if (!fixtureName) {
    fail('Step 2',
      'Could not extract a fixture name from raw OneGov results.\n' +
      'The "licensee" field may be empty or the API shape has changed.\n' +
      'Raw hits:',
      rawHits.slice(0, 3));
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 2', `Test fixture: "${fixtureName}"`);
  if (rawHits.length > 0) {
    const s = rawHits[0];
    step(`  Sample raw hit: licensee=${s.licensee}, licenceNumber=${s.licenceNumber}, ` +
         `status=${s.status || ''}, licenceType=${s.licenceType || ''}`);
  }
  passed++;

  // ── Step 3: Call scraper + validate return shape ───────────────────────────
  step(`Step 3: Calling searchNSWFairTrading("${fixtureName}", "", [])...`);

  let result;
  try {
    result = await searchNSWFairTrading(fixtureName, '', []);
  } catch (e) {
    fail('Step 3', `searchNSWFairTrading threw: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  // Validate return shape
  const REQUIRED_KEYS = ['source', 'jurisdiction', 'category', 'results', 'searchUrl', 'summary'];
  const missingKeys = REQUIRED_KEYS.filter((k) => !(k in result));
  if (missingKeys.length > 0) {
    fail('Step 3', `Return value missing required keys: ${missingKeys.join(', ')}`, result);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  if (result.jurisdiction !== 'NSW') {
    fail('Step 3', `Expected jurisdiction "NSW", got "${result.jurisdiction}"`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  if (result.category !== 'license') {
    fail('Step 3', `Expected category "license", got "${result.category}"`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  if (!Array.isArray(result.results)) {
    fail('Step 3', `Expected results to be an array, got ${typeof result.results}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 3', 'Scraper returned valid shape');
  step(`  source: "${result.source}"`);
  step(`  jurisdiction: "${result.jurisdiction}", category: "${result.category}"`);
  step(`  summary: "${result.summary}"`);
  step(`  results.length: ${result.results.length}`);
  step(`  searchUrl: "${result.searchUrl}"`);
  passed++;

  // ── Step 4: Validate result items and fixture presence ────────────────────
  step(`Step 4: Validating result items and checking fixture "${fixtureName}" in results...`);

  if (result.results.length === 0) {
    warn(
      `0 results returned for "${fixtureName}". The NSW Fair Trading scraper may have ` +
      'filtered out this licensee via nameMatchesEntity.\n' +
      'Checks to perform:\n' +
      `  (a) Significant words from fixture: ${JSON.stringify(sigWords(fixtureName))}\n` +
      '  (b) nameMatchesEntity requires every sig word to appear in hit.licensee verbatim\n' +
      '  (c) Check server/scrapers/nswFairTrading.js nameMatchesEntity function\n' +
      `  (d) Browse register: ${REGISTER_BASE}/#/publicregister/search/Trades`
    );
    // 0 results is a WARN, not a FAIL
    summary(passed, failed);
    process.exit(failed > 0 ? 1 : 0);
  }

  // Validate each result item has required fields
  const ITEM_KEYS = ['title', 'url', 'status', 'description', 'jurisdiction', 'metadata'];
  let itemShapeOk = true;
  for (let i = 0; i < result.results.length; i++) {
    const item = result.results[i];
    const missing = ITEM_KEYS.filter((k) => !(k in item));
    if (missing.length > 0) {
      fail('Step 4', `Result item ${i} missing keys: ${missing.join(', ')}`, item);
      failed++;
      itemShapeOk = false;
      break;
    }
    if (item.jurisdiction !== 'NSW') {
      fail('Step 4', `Result item ${i} has jurisdiction "${item.jurisdiction}", expected "NSW"`);
      failed++;
      itemShapeOk = false;
      break;
    }
  }

  if (!itemShapeOk) {
    summary(passed, failed);
    process.exit(1);
  }

  // Show sample results
  result.results.slice(0, 3).forEach((r, i) =>
    dump(`Result ${i + 1}`, { title: r.title, status: r.status, description: r.description, url: r.url })
  );

  pass('Step 4', `${result.results.length} result item(s) validated — all have required shape`);
  passed++;

  // Check at least one result title contains the first significant word of the fixture
  const word = firstSigWord(fixtureName);

  if (word) {
    const found = result.results.some((r) => normalise(r.title).includes(word));
    if (!found) {
      warn(
        `No result title contains the first significant word "${word}" of fixture "${fixtureName}".\n` +
        'Result titles: ' + result.results.map((r) => r.title).join(', ') + '\n' +
        'This is unexpected because nameMatchesEntity should have required this word to be present.'
      );
    } else {
      pass('Step 4', `At least one result title contains "${word}" from fixture "${fixtureName}"`);
      passed++;
    }
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
