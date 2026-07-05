/**
 * TEST: SA Consumer & Business Services — Occupational Licence Register
 *
 * PURPOSE
 *   Verifies that searchSALicenceRegister() behaves correctly under two scenarios:
 *     1. No CAPTCHA_API_KEY: function returns gracefully with "unavailable" summary
 *        (no throw, no crash) — exit 0.
 *     2. CAPTCHA_API_KEY present: full end-to-end test through Puppeteer + 2captcha,
 *        validating site reachability, return shape, and result item structure.
 *
 *   The scraper uses Puppeteer + 2captcha to pass a reCAPTCHA v2 gate at
 *   https://secure.cbs.sa.gov.au/OccLicPubReg/ before interacting with the
 *   Vue SPA search form.
 *   SA sitekey: 6LeEr5ksAAAAABaJwLcxw3ongWxfDq9gzoKk3OXr
 *
 * REQUIREMENTS
 *   - CAPTCHA_API_KEY in server/.env (or environment) for the full test.
 *   - Without the key, only graceful-degradation is verified (still a PASS).
 *   - Puppeteer and 2captcha may take 60–120 s — allow adequate timeout.
 *
 * USAGE
 *   node server/tests/test-sa-licence-register.js
 *   node server/tests/test-sa-licence-register.js --name "Multiplex"
 *
 * EXIT CODE
 *   0 — all steps passed (or graceful-degradation confirmed when key absent)
 *   1 — any step failed
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 0 FAIL: graceful-degradation check threw"
 *     → The scraper threw instead of returning the "unavailable" summary.
 *       Check the !captchaApiKey guard at the top of searchSALicenceRegister().
 *   "Step 0 FAIL: wrong summary for missing key"
 *     → Summary text changed. Update this test or the scraper guard.
 *   "Step 1 FAIL: site not reachable"
 *     → https://secure.cbs.sa.gov.au/OccLicPubReg/ returned an error or timed out.
 *       Check network access or whether the URL has changed.
 *   "Step 2 FAIL: scraper threw"
 *     → Puppeteer or 2captcha integration failed. Check CAPTCHA_API_KEY balance,
 *       SA sitekey, and Puppeteer/Chromium installation.
 *   "Step 3 FAIL: missing field"
 *     → The returned object is missing a required top-level field. Check the
 *       BASE_RESULT shape in server/scrapers/saLicenceRegister.js.
 *   "Step 4 FAIL: malformed result item"
 *     → A result item is missing a required field (title/url/status/description/
 *       jurisdiction/metadata). Check parseResults() in saLicenceRegister.js.
 */

'use strict';

const path  = require('path');
const axios = require('axios');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { searchSALicenceRegister } = require(path.join(__dirname, '../scrapers/saLicenceRegister'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

const REGISTER_URL = 'https://secure.cbs.sa.gov.au/OccLicPubReg/';

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const nameIdx     = args.indexOf('--name');
const searchName  = nameIdx !== -1 ? args[nameIdx + 1] : 'building';

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('SA Consumer & Business Services — Licence Register Test');
  let passed = 0;
  let failed = 0;

  const captchaApiKey = process.env.CAPTCHA_API_KEY || '';

  // ── Step 0: Check CAPTCHA key — verify graceful degradation if absent ────
  step('Step 0: Checking CAPTCHA_API_KEY...');

  if (!captchaApiKey) {
    warn('CAPTCHA_API_KEY not set — testing graceful degradation only.');
    warn('Set CAPTCHA_API_KEY in server/.env to run the full test.');
    step('Step 0: Calling scraper without key to verify graceful return...');

    let degradedResult;
    try {
      degradedResult = await searchSALicenceRegister('building', '', [], undefined);
    } catch (e) {
      fail('Step 0', `graceful-degradation check threw: ${e.message}`, e.stack);
      summary(passed, 1);
      process.exit(1);
    }

    if (!degradedResult || typeof degradedResult.summary !== 'string') {
      fail('Step 0', 'scraper returned no object or no summary field when key is absent');
      summary(passed, 1);
      process.exit(1);
    }

    if (!degradedResult.summary.toLowerCase().includes('unavailable')) {
      fail('Step 0',
        `Expected summary to contain "unavailable" but got: "${degradedResult.summary}"`);
      summary(passed, 1);
      process.exit(1);
    }

    pass('Step 0', `Graceful degradation confirmed — summary: "${degradedResult.summary}"`);
    passed++;

    step('');
    step('To run the full test, add CAPTCHA_API_KEY to server/.env:');
    step('  echo "CAPTCHA_API_KEY=your_2captcha_key" >> server/.env');
    step('NOTE: 2captcha CAPTCHA solves take 30–120 s and cost ~$0.003 each.');

    summary(passed, failed);
    process.exit(0);
  }

  pass('Step 0', 'CAPTCHA_API_KEY is set — proceeding with full test');
  passed++;

  // ── Step 1: Verify site is reachable ─────────────────────────────────────
  step(`Step 1: Verifying site reachable at ${REGISTER_URL}...`);

  try {
    const response = await axios.get(REGISTER_URL, {
      timeout: 20_000,
      maxRedirects: 5,
      validateStatus: (s) => s < 500,
    });
    step(`  HTTP status: ${response.status}`);
    if (response.status >= 400) {
      fail('Step 1', `Site returned HTTP ${response.status} — may be down or URL changed`);
      failed++;
      summary(passed, failed);
      process.exit(1);
    }
    pass('Step 1', `Site reachable (HTTP ${response.status})`);
    passed++;
  } catch (e) {
    fail('Step 1',
      `Site not reachable: ${e.message}\n` +
      `URL: ${REGISTER_URL}\n` +
      'Check network access or whether the CBS SA URL has changed.');
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  // ── Step 2: Call the scraper ──────────────────────────────────────────────
  const t0 = Date.now();
  step(`Step 2: Calling searchSALicenceRegister("${searchName}", "", [], key)...`);
  step('  NOTE: Puppeteer + 2captcha may take 60–120 s. Please wait...');

  let result;
  try {
    result = await searchSALicenceRegister(searchName, '', [], captchaApiKey);
  } catch (e) {
    fail('Step 2', `searchSALicenceRegister threw: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  pass('Step 2', `Scraper returned without throwing (${elapsed}s)`);
  step(`  Summary: "${result.summary}"`);
  step(`  Results count: ${(result.results || []).length}`);
  passed++;

  // ── Step 3: Validate return shape ─────────────────────────────────────────
  step('Step 3: Validating return shape...');

  const REQUIRED_FIELDS = ['source', 'jurisdiction', 'category', 'results', 'searchUrl', 'summary'];
  let shapeFailed = false;

  for (const field of REQUIRED_FIELDS) {
    if (!(field in result)) {
      fail('Step 3', `missing field: "${field}"`);
      shapeFailed = true;
      failed++;
    }
  }

  if (!shapeFailed) {
    // Spot-check field values
    if (result.jurisdiction !== 'SA') {
      fail('Step 3', `Expected jurisdiction "SA" but got "${result.jurisdiction}"`);
      shapeFailed = true;
      failed++;
    }
    if (result.category !== 'license') {
      fail('Step 3', `Expected category "license" but got "${result.category}"`);
      shapeFailed = true;
      failed++;
    }
    if (!Array.isArray(result.results)) {
      fail('Step 3', `"results" should be an Array but got ${typeof result.results}`);
      shapeFailed = true;
      failed++;
    }
  }

  if (!shapeFailed) {
    pass('Step 3', 'Return shape is valid');
    passed++;
  }

  // ── Step 4: Validate result items ─────────────────────────────────────────
  step('Step 4: Validating result items...');

  const items = result.results || [];

  if (items.length === 0) {
    warn(`Step 4: 0 results returned for search "${searchName}".`);
    warn('  This may be correct if no SA licences match the search term.');
    warn('  Re-run with --name "Multiplex" or another known SA licensee to verify.');
    pass('Step 4', 'Shape is correct; 0 results is acceptable for this search term');
    passed++;
  } else {
    const ITEM_FIELDS = ['title', 'url', 'status', 'description', 'jurisdiction', 'metadata'];
    let itemFailed = false;

    items.slice(0, 5).forEach((item, i) => {
      for (const field of ITEM_FIELDS) {
        if (!(field in item)) {
          fail('Step 4', `Result item ${i} missing field "${field}"`);
          itemFailed = true;
          failed++;
        }
      }
    });

    if (!itemFailed) {
      pass('Step 4', `${items.length} result item(s) have valid shape`);
      passed++;
      items.slice(0, 3).forEach((r, i) =>
        dump(`Result ${i + 1}`, {
          title: r.title,
          status: r.status,
          description: r.description,
          jurisdiction: r.jurisdiction,
          licenceNumber: r.metadata && r.metadata.LicenceNumber,
        })
      );
    }
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
