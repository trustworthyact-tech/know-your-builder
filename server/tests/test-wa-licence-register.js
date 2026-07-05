/**
 * TEST: WA Building Services — Contractor Licence Register
 *
 * PURPOSE
 *   Verifies that searchWALicenceRegister() returns a well-formed response when
 *   given 'Multiplex' — a large building contractor confirmed to be in the WA
 *   Building Services licence register. The scraper uses Puppeteer to drive an
 *   Angular 17 SPA (https://ols.demirs.wa.gov.au) because direct axios calls to
 *   the underlying API return HTTP 500; the SPA must bootstrap a session first.
 *
 *   IMPORTANT: This test may take 30-60 seconds due to Puppeteer browser
 *   initialisation and Angular form interaction.
 *
 *   If 0 results are returned the test diagnoses whether the WA OLS site is
 *   reachable. 0 results is a WARN, not a FAIL — Multiplex may not appear in the
 *   register at time of running, or the scraper's Angular form interaction may
 *   have broken.
 *
 * REQUIREMENTS
 *   Puppeteer must be installed (server/node_modules/puppeteer).
 *   No API keys or CAPTCHA solving needed.
 *
 * USAGE
 *   node server/tests/test-wa-licence-register.js
 *   node server/tests/test-wa-licence-register.js --name "Entity Name"
 *
 * EXIT CODE
 *   0 — all steps passed (shape valid, site reachable)
 *   1 — shape invalid or scraper threw
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: searchWALicenceRegister threw"
 *     → Puppeteer crashed or the Angular form interaction failed. Check that
 *       Puppeteer is installed and that the OLS site is reachable. The Angular
 *       selector paths (mat-select, mat-option, #mat-input-2) may have changed.
 *   "Step 2 FAIL: shape invalid"
 *     → The scraper returned an unexpected shape. Check that searchWALicenceRegister
 *       in server/scrapers/waLicenceRegister.js still returns:
 *       { source, jurisdiction: 'WA', category: 'license', results, searchUrl, summary }
 *   "Step 3 WARN: 0 results + site is reachable"
 *     → The API session establishment or Angular form interaction likely broke.
 *       Possible causes:
 *         1. mat-select / mat-option selector changed
 *         2. #mat-input-2 field ID changed
 *         3. API path changed (/api/Search/licence/licenceType)
 *         4. 'Multiplex' is genuinely not in the WA register right now
 *       Run debug-wa-licence.js and inspect the Puppeteer page manually.
 *   "Step 3 WARN: 0 results + site NOT reachable"
 *     → Connectivity issue. The OLS site may be down or behind a firewall.
 *       Try: curl -I https://ols.demirs.wa.gov.au
 *   "Step 3 FAIL: result item missing required field"
 *     → A result item was returned but is missing one of:
 *       title, url, status, description, jurisdiction, metadata
 */

'use strict';

const path  = require('path');
const axios = require('axios');

const { searchWALicenceRegister } = require(path.join(__dirname, '../scrapers/waLicenceRegister'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

const OLS_URL = 'https://ols.demirs.wa.gov.au';
// 90-second overall timeout — Puppeteer startup + Angular form interaction is slow
const OVERALL_TIMEOUT_MS = 90_000;

// ── Parse CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
// 'Multiplex' is confirmed working by debug-wa-licence.js
const fixtureName = (nameIdx !== -1 && args[nameIdx + 1]) ? args[nameIdx + 1] : 'Multiplex';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function isSiteReachable() {
  try {
    await axios.get(OLS_URL, { timeout: 15000 });
    return true;
  } catch (e) {
    // A non-2xx response (e.g. redirect, 403) still means the site is up
    if (e.response) return true;
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('WA Building Services — Contractor Licence Register Test');
  let passed = 0;
  let failed = 0;

  step(`Fixture name: "${fixtureName}"`);
  step('Note: this test takes 30-60 seconds due to Puppeteer + Angular form interaction.');

  // Overall timeout guard
  const timeoutHandle = setTimeout(() => {
    fail('Timeout', `Test exceeded ${OVERALL_TIMEOUT_MS / 1000}s overall timeout.`);
    fail('Timeout', 'Puppeteer may have stalled waiting for the Angular SPA to load.');
    fail('Timeout', `Check that ${OLS_URL} is reachable and responsive.`);
    summary(passed, 1);
    process.exit(1);
  }, OVERALL_TIMEOUT_MS);
  timeoutHandle.unref(); // don't prevent normal exit

  // ── Step 1: Call scraper ───────────────────────────────────────────────────
  step(`Step 1: Calling searchWALicenceRegister("${fixtureName}", "", [])...`);

  let result;
  try {
    result = await searchWALicenceRegister(fixtureName, '', []);
  } catch (e) {
    clearTimeout(timeoutHandle);
    fail('Step 1', `searchWALicenceRegister threw: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 1', 'Scraper returned without throwing');
  passed++;

  // ── Step 2: Validate return shape ─────────────────────────────────────────
  step('Step 2: Validating return shape...');

  let shapeFailed = false;

  if (typeof result.source !== 'string' || !result.source) {
    fail('Step 2', `result.source is missing or not a string: ${JSON.stringify(result.source)}`);
    shapeFailed = true;
  }
  if (result.jurisdiction !== 'WA') {
    fail('Step 2', `result.jurisdiction expected "WA", got: ${JSON.stringify(result.jurisdiction)}`);
    shapeFailed = true;
  }
  if (result.category !== 'license') {
    fail('Step 2', `result.category expected "license", got: ${JSON.stringify(result.category)}`);
    shapeFailed = true;
  }
  if (!Array.isArray(result.results)) {
    fail('Step 2', `result.results is not an array: ${JSON.stringify(result.results)}`);
    shapeFailed = true;
  }
  if (typeof result.searchUrl !== 'string' || !result.searchUrl) {
    fail('Step 2', `result.searchUrl is missing or not a string: ${JSON.stringify(result.searchUrl)}`);
    shapeFailed = true;
  }
  if (typeof result.summary !== 'string' || !result.summary) {
    fail('Step 2', `result.summary is missing or not a string: ${JSON.stringify(result.summary)}`);
    shapeFailed = true;
  }

  if (shapeFailed) {
    clearTimeout(timeoutHandle);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  step(`  source:      "${result.source}"`);
  step(`  jurisdiction: ${result.jurisdiction}`);
  step(`  category:    ${result.category}`);
  step(`  searchUrl:   ${result.searchUrl}`);
  step(`  summary:     "${result.summary}"`);
  step(`  results:     ${result.results.length} item(s)`);

  pass('Step 2', 'Return shape is valid');
  passed++;

  // ── Step 3: Validate result items or diagnose 0 results ───────────────────
  step('Step 3: Validating result items...');

  if (result.results.length === 0) {
    warn(`0 results returned for "${fixtureName}".`);
    warn('Diagnosing: checking if the WA OLS site is reachable...');

    const reachable = await isSiteReachable();

    if (reachable) {
      warn(`Site ${OLS_URL} is reachable (HTTP response received).`);
      warn('This is likely a scraper logic issue. Possible causes:');
      warn('  1. Angular form selector changed (mat-select, mat-option, #mat-input-2)');
      warn('  2. API path changed: /api/Search/licence/licenceType');
      warn('  3. The session is not being established before the API call');
      warn(`  4. "${fixtureName}" is genuinely not in the WA Building Services register`);
      warn('  5. nameMatchesEntity is filtering out results');
      warn('Next steps:');
      warn('  - Run: node server/tests/debug-wa-licence.js');
      warn(`  - Browse: ${OLS_URL}`);
    } else {
      warn(`Site ${OLS_URL} is NOT reachable.`);
      warn('This is a connectivity issue, not a scraper bug.');
      warn(`  - Check: curl -I ${OLS_URL}`);
      warn('  - The site may be down or behind a corporate firewall/VPN.');
    }

    // 0 results is a WARN, not a FAIL
    clearTimeout(timeoutHandle);
    summary(passed, failed);
    process.exit(failed > 0 ? 1 : 0);
  }

  // Validate item shape for each result
  let itemShapeFailed = false;
  result.results.forEach((item, i) => {
    const requiredFields = ['title', 'url', 'status', 'description', 'jurisdiction', 'metadata'];
    for (const field of requiredFields) {
      if (item[field] === undefined) {
        fail('Step 3', `Result item [${i}] missing required field: "${field}"`, item);
        itemShapeFailed = true;
      }
    }
  });

  if (itemShapeFailed) {
    clearTimeout(timeoutHandle);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  // Show first few results
  result.results.slice(0, 3).forEach((r, i) => {
    dump(`Result ${i + 1}`, {
      title: r.title,
      status: r.status,
      description: r.description,
      url: r.url,
      metadata: r.metadata,
    });
  });

  pass('Step 3', `${result.results.length} result item(s) validated — all have required fields`);
  passed++;

  clearTimeout(timeoutHandle);
  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
