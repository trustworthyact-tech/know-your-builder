/**
 * TEST: Payment Times Reporting Register
 *
 * PURPOSE
 *   Verifies that searchPaymentTimes() returns a result when given an entity
 *   name confirmed to appear in the Payment Times Reporting Register (PTRR).
 *   The test confirms the register is reachable via update.js, then calls the
 *   full scraper and checks that a known large entity comes back.
 *
 *   The PTRR was migrated from paymenttimes.gov.au (API) to
 *   register.paymenttimes.gov.au (Excel download). The scraper downloads the
 *   register Excel and searches it locally.
 *
 *   Two-layer comparison isolates failures:
 *     • Step 1 FAIL: register.paymenttimes.gov.au is down or update.js changed
 *       → The download URL structure changed; inspect update.js manually
 *     • Step 3 FAIL: 0 results from scraper
 *       → The Excel structure changed, or the entity is no longer a reporter
 *     • Step 4 FAIL: fixture name not found in results
 *       → Field name mapping changed in the Excel column definitions
 *
 * REQUIREMENTS
 *   No API keys or Puppeteer — axios only (scraper downloads Excel locally).
 *   First run downloads the register file (~30–120 s depending on file size).
 *   Subsequent runs use the cached copy from /tmp.
 *
 * USAGE
 *   node server/tests/test-payment-times.js
 *   node server/tests/test-payment-times.js --name "Acme Pty Ltd"
 *
 * EXIT CODE
 *   0 — fixture entity found by scraper
 *   1 — not found or error at any layer
 */

'use strict';

const path  = require('path');
const axios = require('axios');
const { searchPaymentTimes } = require(path.join(__dirname, '../scrapers/paymentTimes'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

const UPDATE_JS_URL = 'https://register.paymenttimes.gov.au/files/js/update.js';
const REGISTER_URL  = 'https://register.paymenttimes.gov.au/dashboard.html';

// Well-known large Australian companies that report to PTRR (>$100M turnover threshold).
// Used as fallback fixture if --name is not supplied.
const KNOWN_REPORTERS = ['BHP', 'Rio Tinto', 'Multiplex', 'Lendlease', 'Woolworths'];

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/javascript, */*',
};

// ── Parse CLI args ─────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const nameIdx     = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// ── Utilities ──────────────────────────────────────────────────────────────────

function sigWords(name) {
  const STOP = new Set(['pty', 'ltd', 'limited', 'the', 'and', 'of', 'a', 'an', 'for', 'in']);
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
}

// ── Main ───────────────────────────────────────────────────────────────────────

(async () => {
  header('Payment Times Reporting Register — Integration Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Confirm register is reachable via update.js ──────────────────────
  step('Step 1: Checking register.paymenttimes.gov.au/files/js/update.js...');
  step(`  GET ${UPDATE_JS_URL}`);

  let registerFileName = null;

  try {
    const { data } = await axios.get(UPDATE_JS_URL, {
      headers: HEADERS,
      timeout: 15000,
    });
    const m = String(data).match(/let\s+fileName\s*=\s*"([^"]+)"/);
    registerFileName = m ? m[1] : null;

    if (!registerFileName) {
      fail(
        'Step 1',
        'update.js is reachable but no fileName assignment found.\n' +
        'The register filename extraction pattern may have changed.\n' +
        `Expected: let fileName = "..."\n` +
        `First 300 chars of response: ${String(data).slice(0, 300)}`
      );
      failed++;
      summary(passed, failed);
      process.exit(1);
    }
  } catch (e) {
    fail(
      'Step 1',
      `Failed to fetch update.js: ${e.message}\n` +
      'Possible causes:\n' +
      '  • register.paymenttimes.gov.au is down or the /files/js/update.js path changed\n' +
      `  • Network/DNS issue\n` +
      `URL: ${UPDATE_JS_URL}`,
      e.code || ''
    );
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 1', `Register reachable — current file: ${registerFileName}`);
  passed++;

  // ── Step 2: Determine fixture entity name ─────────────────────────────────────
  step('Step 2: Determining fixture entity name...');

  let fixtureName = suppliedName;

  if (!fixtureName) {
    // Use a well-known large Australian company that reports to PTRR.
    // BHP Group Ltd is consistently one of Australia's largest companies.
    fixtureName = KNOWN_REPORTERS[0];
    warn(
      `No --name supplied. Using "${fixtureName}" as fixture.\n` +
      'If this fails, supply a different entity with --name "Company Name".\n' +
      `Known reporters to try: ${KNOWN_REPORTERS.join(', ')}`
    );
  }

  pass('Step 2', `Test fixture: "${fixtureName}"`);
  passed++;

  // ── Step 3: Call searchPaymentTimes; assert >= 1 result ───────────────────────
  step(`Step 3: Calling searchPaymentTimes("${fixtureName}", "", "")...`);
  step('  (First run downloads the register Excel — allow 30–120 s; subsequent runs use cache)');

  let result;
  try {
    result = await searchPaymentTimes(fixtureName, '', '');
  } catch (e) {
    fail('Step 3', `searchPaymentTimes threw an exception: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  step(`  Summary: "${result.summary}"`);
  step(`  Results count: ${result.results.length}`);
  step(`  Search URL: ${result.searchUrl}`);

  if (result.results.length > 0) {
    result.results.slice(0, 3).forEach((r, i) =>
      dump(`Result ${i + 1}`, {
        title: r.title,
        url: r.url,
        description: r.description,
        metadata: r.metadata,
      })
    );
  }

  if (result.results.length === 0) {
    fail(
      'Step 3',
      `Scraper returned 0 results for "${fixtureName}".\n` +
      'Possible causes:\n' +
      '  • The register Excel structure changed (sheet column mapping)\n' +
      '  • The entity is no longer in the register or uses a different name\n' +
      '  • update.js filename changed but the cache still holds an old file\n' +
      `  • Try deleting /tmp/ptrr_register.xlsx and re-running\n` +
      `  • Or try a different entity: --name "Rio Tinto"`,
    );
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 3', `Scraper returned ${result.results.length} result(s) without throwing`);
  passed++;

  // ── Step 4: Assert the fixture name appears in at least one result ────────────
  step(`Step 4: Checking if "${fixtureName}" appears in scraper results...`);

  const words = sigWords(fixtureName);
  step(`  Significant words to match: ${JSON.stringify(words)}`);

  const matched = result.results.some((r) => {
    const text = (r.title + ' ' + (r.description || ''))
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '');
    if (words.length === 0) return text.includes(fixtureName.toLowerCase());
    return words.every((w) => text.includes(w));
  });

  if (!matched) {
    fail(
      'Step 4',
      `"${fixtureName}" (significant words: ${JSON.stringify(words)}) was not found in\n` +
      'any result title or description returned by the scraper.\n' +
      'The entity name field mapping (column B in the Excel) may have changed.\n' +
      'Result titles returned:',
      result.results.map((r) => r.title)
    );
    failed++;
  } else {
    pass('Step 4', `"${fixtureName}" confirmed in scraper results`);
    passed++;
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
