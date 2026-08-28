/**
 * TEST: Victorian Building Authority — Licence Register (scraper function)
 *
 * PURPOSE
 *   Verifies that searchVicVbaLicence() returns a well-formed response when
 *   given a known entity. The scraper queries Victoria's open-data portal
 *   (CKAN datastore_search API) for the same register previously scraped live
 *   via Puppeteer against the BAMS Salesforce SPA — no browser required.
 *
 *   Fixture: "Arena Construction Group Pty Ltd" — confirmed present in the
 *   open-data VBA licence register dataset (live-verified 2026-08-28,
 *   ACN 687010251, Accreditation CDB-L 100246, status Current).
 *
 *   Two-layer check:
 *     • scraper returns wrong shape → test fails on shape check
 *     • scraper returns 0 results  → WARN with diagnostic (not a FAIL — the
 *       fixture entity's accreditation status may have changed)
 *     • scraper throws             → FAIL
 *
 * REQUIREMENTS
 *   axios only (already a dependency). No API keys, no CAPTCHA, no browser.
 *   Should complete in a few seconds.
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
 *     → axios/network issue, or the CKAN API shape changed.
 *   "Step 2 FAIL: missing field"
 *     → Shape contract changed in vicVbaLicence.js or the datastore_search response shape changed.
 *   "Step 3 WARN: 0 results"
 *     → Fixture entity may no longer be in the register, or nameMatchesEntity filtered it out.
 *       Run: node server/tests/test-vic-vba-licence-scraper.js --name "Known Licensee"
 *       or visit https://www.vba.vic.gov.au/tools/find-practitioner
 */

'use strict';

const path = require('path');
const axios = require('axios');

const { searchVicVbaLicence } = require(path.join(__dirname, '../scrapers/vicVbaLicence'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

const DATASTORE_URL = 'https://discover.data.vic.gov.au/api/3/action/datastore_search';
const RESOURCE_ID = '3599fa1f-29f3-417e-8679-1842e2e6e2df';
const DEFAULT_FIXTURE = 'Arena Construction Group Pty Ltd';

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const fixtureName = nameIdx !== -1 ? args[nameIdx + 1] : DEFAULT_FIXTURE;

(async () => {
  header('VIC Building Authority — Licence Register Scraper Test');
  let passed = 0;
  let failed = 0;

  step(`Fixture: "${fixtureName}"`);
  step('Note: this test queries the public open-data CKAN API directly — should be quick.');

  // ── Step 1: Call scraper ───────────────────────────────────────────────────
  step(`Step 1: Calling searchVicVbaLicence("${fixtureName}", "", [])...`);

  let result;
  try {
    result = await searchVicVbaLicence(fixtureName, '', []);
  } catch (e) {
    fail('Step 1', `searchVicVbaLicence threw: ${e.message}`, e.stack);
    step('');
    step('Diagnostic: check if the open-data API is reachable...');
    try {
      const { status } = await axios.get(DATASTORE_URL, {
        params: { resource_id: RESOURCE_ID, q: fixtureName, limit: 1 },
        timeout: 10000,
      });
      step(`  datastore_search returned HTTP ${status} — API is up; issue is likely scraper logic`);
    } catch (axErr) {
      step(`  datastore_search unreachable: ${axErr.message} — possible network issue`);
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
    warn('  - the fixture entity is no longer registered with VBA');
    warn('  - nameMatchesEntity filtered out results (check significant words)');
    warn(`  - Browse manually: https://www.vba.vic.gov.au/tools/find-practitioner`);
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
