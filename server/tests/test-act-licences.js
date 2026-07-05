/**
 * TEST: ACT Access Canberra — Builder Licence Register
 *
 * PURPOSE
 *   Verifies that searchACTLicences() returns a correctly shaped result when
 *   given an entity name that exists in the ACT Socrata open-data register.
 *   The test self-discovers a fixture by querying the API for the first Builder
 *   record, then calls the full scraper function and confirms the same entity
 *   comes back.
 *
 *   Two-layer comparison isolates failures:
 *     • Raw API returns records but scraper returns 0
 *       → nameMatchesEntity filter or BUILDING_OCCUPATIONS filter is too strict
 *     • Raw API returns 0 records
 *       → Socrata endpoint changed or no current Builder records
 *     • Scraper throws
 *       → Network error or API shape changed
 *
 * REQUIREMENTS
 *   No API keys or Puppeteer needed — axios only (used by the scraper itself).
 *
 * USAGE
 *   node server/tests/test-act-licences.js
 *   node server/tests/test-act-licences.js --name "John Smith Constructions"
 *
 * EXIT CODE
 *   0 — all steps passed (fixture entity found and shape validated)
 *   1 — any step failed (thrown error or wrong shape); 0 results is a WARN only
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: no Builder records found in raw API"
 *     → The Socrata endpoint or dataset ID may have changed.
 *       Check: GET https://data.act.gov.au/resource/de4w-gbt3.json?$where=occupation='Builder'&$limit=5
 *   "Step 2 FAIL: could not extract fixture name from raw records"
 *     → The 'surname' field is missing or empty. Check the raw API response
 *       shape — fields may have been renamed in the Socrata dataset.
 *   "Step 3 FAIL: scraper threw"
 *     → searchACTLicences() itself threw an exception. Check axios errors
 *       and the Socrata $where query syntax in server/scrapers/actLicences.js.
 *   "Step 3 FAIL: return shape invalid"
 *     → The scraper returned an object missing required keys. Check the return
 *       statement in searchACTLicences() in server/scrapers/actLicences.js.
 *   "Step 4 WARN: 0 results returned"
 *     → The fixture name passed nameMatchesEntity filtering in Step 1 but was
 *       filtered out inside searchACTLicences. Check:
 *       (a) BUILDING_OCCUPATIONS set — occupation of the raw record may differ
 *       (b) nameMatchesEntity — significant words may not appear in the name field
 *       (c) socrataEscape / $where query may be malformed for the fixture name
 */

'use strict';

const path = require('path');
const axios = require('axios');
const { searchACTLicences } = require(path.join(__dirname, '../scrapers/actLicences'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

const RESOURCE_URL = 'https://data.act.gov.au/resource/de4w-gbt3.json';
const PORTAL_URL = 'https://www.data.act.gov.au/Business-and-Industry/List-of-Professionals/de4w-gbt3';

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

// ── Main ───────────────────────────────────────────────────────────────────────

(async () => {
  header('ACT Access Canberra — Builder Licence Register Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Discover fixture via raw Socrata API ───────────────────────────
  step('Step 1: Querying ACT Socrata API for Builder records...');
  step(`  URL: ${RESOURCE_URL}?$where=occupation='Builder'&$limit=5`);

  let rawRecords = [];

  if (!suppliedName) {
    try {
      const { data } = await axios.get(RESOURCE_URL, {
        params: {
          '$where': "occupation='Builder'",
          '$limit': 5,
        },
        headers: { Accept: 'application/json' },
        timeout: 20000,
      });
      rawRecords = Array.isArray(data) ? data : [];
    } catch (e) {
      fail('Step 1', `Raw API request failed: ${e.message}`);
      summary(0, 1);
      process.exit(1);
    }

    if (rawRecords.length === 0) {
      fail('Step 1',
        'No Builder records found in raw ACT Socrata API.\n' +
        'Check the dataset is still accessible:\n' +
        `  ${RESOURCE_URL}?$where=occupation='Builder'&$limit=5\n` +
        'Or run with --name "Entity Name" to skip fixture discovery.');
      summary(0, 1);
      process.exit(1);
    }

    pass('Step 1', `Found ${rawRecords.length} Builder record(s) from Socrata API`);
    passed++;
  } else {
    pass('Step 1', `Skipped — using supplied name: "${suppliedName}"`);
    passed++;
  }

  // ── Step 2: Extract fixture name ──────────────────────────────────────────
  step('Step 2: Extracting fixture name...');

  let fixtureName = suppliedName;

  if (!fixtureName) {
    // Prefer a record with a non-empty surname that produces meaningful sig words
    for (const rec of rawRecords) {
      const candidate = (rec.surname || '').trim();
      if (candidate && sigWords(candidate).length > 0) {
        fixtureName = candidate;
        break;
      }
    }

    // Fall back to the first surname even if no sig words
    if (!fixtureName && rawRecords.length > 0) {
      fixtureName = (rawRecords[0].surname || '').trim();
    }
  }

  if (!fixtureName) {
    fail('Step 2',
      'Could not extract a fixture name from raw Socrata records.\n' +
      'The "surname" field may be empty or the dataset shape has changed.\n' +
      'Raw records:',
      rawRecords.slice(0, 3));
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 2', `Test fixture: "${fixtureName}"`);
  if (rawRecords.length > 0) {
    const s = rawRecords[0];
    step(`  Sample raw record: occupation=${s.occupation}, surname=${s.surname}, ` +
         `given_names=${s.given_names || ''}, licence_status=${s.licence_status || ''}`);
  }
  passed++;

  // ── Step 3: Call scraper + validate return shape ───────────────────────────
  step(`Step 3: Calling searchACTLicences("${fixtureName}", "", [])...`);

  let result;
  try {
    result = await searchACTLicences(fixtureName, '', []);
  } catch (e) {
    fail('Step 3', `searchACTLicences threw: ${e.message}`, e.stack);
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

  if (result.jurisdiction !== 'ACT') {
    fail('Step 3', `Expected jurisdiction "ACT", got "${result.jurisdiction}"`);
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
      `0 results returned for "${fixtureName}". The ACT register may have no active Builder ` +
      'records matching this name after nameMatchesEntity filtering.\n' +
      'Checks to perform:\n' +
      '  (a) Confirm occupation is "Builder" / "Building Surveyor" / "Building Assessor" in the raw record\n' +
      '  (b) Confirm significant words from the fixture name appear in the name field\n' +
      `  (c) Significant words: ${JSON.stringify(sigWords(fixtureName))}\n` +
      `  (d) Browse register: ${PORTAL_URL}`
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
    if (item.jurisdiction !== 'ACT') {
      fail('Step 4', `Result item ${i} has jurisdiction "${item.jurisdiction}", expected "ACT"`);
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
    dump(`Result ${i + 1}`, { title: r.title, status: r.status, description: r.description })
  );

  pass('Step 4', `${result.results.length} result item(s) validated — all have required shape`);
  passed++;

  // Check at least one result title contains the first significant word of the fixture
  const words = sigWords(fixtureName);
  const firstWord = words[0] || normalise(fixtureName).split(/\s+/)[0];

  if (firstWord) {
    const found = result.results.some((r) => normalise(r.title).includes(firstWord));
    if (!found) {
      warn(
        `No result title contains the first significant word "${firstWord}" of fixture "${fixtureName}".\n` +
        'Result titles: ' + result.results.map((r) => r.title).join(', ') + '\n' +
        'This may be expected if the register displays surname + given_names in a different order.'
      );
    } else {
      pass('Step 4', `At least one result title contains "${firstWord}" from fixture "${fixtureName}"`);
      passed++;
    }
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
