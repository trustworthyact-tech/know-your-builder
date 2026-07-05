/**
 * TEST: Victorian Building Authority — Licence Register (scraper function)
 *
 * PURPOSE
 *   Verifies that searchVicVbaLicence() returns a well-formed response when
 *   given a known entity. The scraper uses Puppeteer to interact with the VBA
 *   BAMS Salesforce LWC SPA, intercepting the Aura API response to extract
 *   practitioner records.
 *
 *   Fixture: "Multiplex" — confirmed present in the BAMS register by
 *   test-vic-vba-licence.js (probe test, 2026-06-11).
 *
 *   Two-layer check:
 *     • scraper returns wrong shape → test fails on shape check
 *     • scraper returns 0 results  → WARN with diagnostic (not a FAIL — Multiplex
 *       may have changed registration status)
 *     • scraper throws             → FAIL
 *
 * REQUIREMENTS
 *   Puppeteer (installed in server/node_modules). No API keys, no CAPTCHA.
 *   Expect ~30-60 seconds for the test to complete.
 *
 * USAGE
 *   node server/tests/test-vic-vba-licence-scraper.js
 *   node server/tests/test-vic-vba-licence-scraper.js --name "Entity Name"
 *
 * EXIT CODE
 *   0 — all steps passed (shape valid; 0 results is a WARN not a FAIL)
 *   1 — scraper threw or return shape is invalid
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: scraper threw"
 *     → Puppeteer or BAMS SPA issue. Run the probe test for more detail:
 *       node server/tests/test-vic-vba-licence.js --name "Multiplex"
 *   "Step 2 FAIL: missing field"
 *     → Shape contract changed in vicVbaLicence.js or the Aura response shape changed.
 *   "Step 3 WARN: 0 results"
 *     → Multiplex may not be in the register, or nameMatchesEntity filtered it out.
 *       Run: node server/tests/test-vic-vba-licence-scraper.js --name "Multiplex"
 *       or visit https://bams.vba.vic.gov.au/bams/s/practitioner-search
 */

'use strict';

const path = require('path');
const axios = require('axios');

const { searchVicVbaLicence } = require(path.join(__dirname, '../scrapers/vicVbaLicence'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

const BAMS_URL = 'https://bams.vba.vic.gov.au/bams/s/practitioner-search';
const DEFAULT_FIXTURE = 'Multiplex';

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const fixtureName = nameIdx !== -1 ? args[nameIdx + 1] : DEFAULT_FIXTURE;

(async () => {
  header('VIC Building Authority — Licence Register Scraper Test');
  let passed = 0;
  let failed = 0;

  step(`Fixture: "${fixtureName}"`);
  step('Note: this test takes 30-60 seconds due to Puppeteer + BAMS SPA interaction.');

  // ── Step 1: Call scraper ───────────────────────────────────────────────────
  step(`Step 1: Calling searchVicVbaLicence("${fixtureName}", "", [])...`);

  let result;
  try {
    result = await searchVicVbaLicence(fixtureName, '', []);
  } catch (e) {
    fail('Step 1', `searchVicVbaLicence threw: ${e.message}`, e.stack);
    step('');
    step('Diagnostic: check if BAMS is reachable...');
    try {
      const { status } = await axios.get(BAMS_URL, { timeout: 10000 });
      step(`  BAMS returned HTTP ${status} — site is up; issue is likely scraper logic`);
    } catch (axErr) {
      step(`  BAMS unreachable: ${axErr.message} — possible network issue`);
    }
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 1', 'Scraper returned without throwing');
  passed++;

  // ── Step 2: Validate return shape ─────────────────────────────────────────
  step('Step 2: Validating return shape...');

  step(`  source:      "${result.source}"`);
  step(`  jurisdiction: ${result.jurisdiction}`);
  step(`  category:    ${result.category}`);
  step(`  searchUrl:   ${result.searchUrl}`);
  step(`  summary:     "${result.summary}"`);
  step(`  results:     ${Array.isArray(result.results) ? result.results.length : 'NOT AN ARRAY'} item(s)`);

  const shapeFields = ['source', 'jurisdiction', 'category', 'results', 'searchUrl', 'summary'];
  const missingShape = shapeFields.filter((f) => !(f in result));
  if (missingShape.length > 0) {
    fail('Step 2', `Return value missing fields: ${missingShape.join(', ')}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }
  if (!Array.isArray(result.results)) {
    fail('Step 2', `results is not an array: ${typeof result.results}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }
  if (result.jurisdiction !== 'VIC') {
    fail('Step 2', `jurisdiction should be "VIC", got "${result.jurisdiction}"`);
    failed++;
  }
  if (result.category !== 'license') {
    fail('Step 2', `category should be "license", got "${result.category}"`);
    failed++;
  }

  if (failed > 0) { summary(passed, failed); process.exit(1); }

  pass('Step 2', 'Return shape is valid');
  passed++;

  // ── Step 3: Validate result items ─────────────────────────────────────────
  step('Step 3: Validating result items...');

  if (result.results.length === 0) {
    warn(`0 results returned for "${fixtureName}".`);
    warn('This may be expected if:');
    warn('  - Multiplex is no longer registered with VBA');
    warn('  - nameMatchesEntity filtered out results (check significant words)');
    warn(`  - Browse manually: ${BAMS_URL}`);
    warn(`Re-run with --name "Known Licensee" to test with a different fixture.`);
    pass('Step 3', '0 results — shape is valid, scraper did not error (WARN only)');
    passed++;
  } else {
    const itemFields = ['title', 'url', 'status', 'description', 'jurisdiction', 'metadata'];
    let itemsFailed = 0;
    for (let i = 0; i < result.results.length; i++) {
      const item = result.results[i];
      const missing = itemFields.filter((f) => !(f in item));
      if (missing.length > 0) {
        fail(`Step 3 item[${i}]`, `Missing fields: ${missing.join(', ')}`);
        itemsFailed++;
      }
    }
    if (itemsFailed > 0) {
      failed += itemsFailed;
    } else {
      pass('Step 3', `${result.results.length} result item(s) validated — all have required fields`);
      passed++;
      result.results.slice(0, 3).forEach((r, i) =>
        dump(`Result ${i + 1}`, {
          title: r.title,
          status: r.status,
          description: r.description,
          url: r.url,
        })
      );
    }
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
