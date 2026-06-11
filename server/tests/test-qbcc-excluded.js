/**
 * TEST: QBCC Excluded Individual Register — Live Integration Test
 *
 * PURPOSE
 *   Verifies that searchQBCC() returns an excluded individual when a director
 *   name that is confirmed to be on the QBCC Excluded Individual Register is
 *   passed in the directors array. The test self-discovers a fixture by loading
 *   the Salesforce SPA and searching for a common Australian surname before
 *   running the assertion.
 *
 * REQUIREMENTS
 *   Puppeteer (installed in server/node_modules) — no API keys needed.
 *   A headless Chromium launch takes ~15s cold. Allow 3–5 min total run time.
 *
 * USAGE
 *   # Auto-discover fixture:
 *   node server/tests/test-qbcc-excluded.js
 *
 *   # Provide known director name (skips discovery, faster):
 *   node server/tests/test-qbcc-excluded.js --name "John Smith"
 *
 * EXIT CODE
 *   0 — fixture director found in excludedResults
 *   1 — not found or error at any layer
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: SPA did not load"
 *     → QBCC Salesforce site is down or URL changed
 *   "Step 2 FAIL: no entries found for surname X"
 *     → SPA loaded but results area empty — shadow DOM selectors may have
 *       changed; check EXCLUDED_REGISTER_URL and slds-combobox selector in
 *       server/scrapers/qbcc.js (searchQBCCExcluded function)
 *   "Step 3 FAIL: 0 excluded results returned by searchQBCC"
 *     → The scraper's Puppeteer flow or parseExcludedResults parser is broken;
 *       compare Step 2 raw text with what the parser expects
 *   "Step 4 FAIL: fixture name not in results"
 *     → parseExcludedResults is not finding the name; check the
 *       "name\nIndividual Info" block structure assumption in qbcc.js
 */

'use strict';

const path    = require('path');
const cheerio = require('cheerio');
const { getBrowser } = require(path.join(__dirname, '../scrapers/browser'));
const { searchQBCC }  = require(path.join(__dirname, '../scrapers/qbcc'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

const EXCLUDED_REGISTER_URL = 'https://my.qbcc.qld.gov.au/myQBCC/s/excluded-individual-register';

// Common Australian surnames to try in fixture discovery
const CANDIDATE_SURNAMES = ['Smith', 'Jones', 'Williams', 'Brown', 'Taylor', 'Wilson'];

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// ── Shadow DOM helpers (duplicated from qbcc.js for the discovery phase) ─────

async function pierceCoords(page, selector) {
  return page.evaluate((sel) => {
    function pq(root) {
      const f = root.querySelector(sel);
      if (f) return f;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { const r = pq(el.shadowRoot); if (r) return r; }
      }
      return null;
    }
    const el = pq(document);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
}

async function pierceClick(page, selector) {
  const coords = await pierceCoords(page, selector);
  if (coords) await page.mouse.click(coords.x, coords.y);
  return !!coords;
}

async function pierceClear(page, selector) {
  await page.evaluate((sel) => {
    function pq(root) {
      const f = root.querySelector(sel); if (f) return f;
      for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const r = pq(el.shadowRoot); if (r) return r; } }
      return null;
    }
    const el = pq(document);
    if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, selector);
}

async function getResultsText(page) {
  return page.evaluate(() => {
    function pq(root, sel) {
      const f = root.querySelector(sel); if (f) return f;
      for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const r = pq(el.shadowRoot, sel); if (r) return r; } }
      return null;
    }
    const grid = pq(document, 'div.slds-grid.results');
    return grid ? (grid.innerText || '') : '';
  });
}

// ── Fixture discovery ─────────────────────────────────────────────────────────
// Loads the QBCC SPA and searches for common surnames until a result is found.
// Returns a full name string like "John Smith", or null.

async function discoverQbccFixture() {
  step('Fixture discovery: launching Puppeteer to load QBCC excluded register SPA...');
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(EXCLUDED_REGISTER_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 8000)); // LWC hydration

    const title = await page.title();
    step(`Page title: "${title}"`);

    for (const lastName of CANDIDATE_SURNAMES) {
      step(`Trying last name "${lastName}"...`);

      try {
        // Open combobox and select Individual Name search type
        await pierceClick(page, 'button[class*="slds-combobox__input"]');
        await new Promise((r) => setTimeout(r, 1000));
        await pierceClick(page, '[data-value="INDIVIDUAL_NAME"]');
        await new Promise((r) => setTimeout(r, 1500));

        // Fill last name only (first name left empty)
        await pierceClear(page, 'input[placeholder="Type first name here"]');
        await pierceClear(page, 'input[placeholder="Type last name here"]');
        const lnCoords = await pierceCoords(page, 'input[placeholder="Type last name here"]');
        if (lnCoords) {
          await page.mouse.click(lnCoords.x, lnCoords.y);
          await page.keyboard.type(lastName, { delay: 50 });
        }

        await pierceClick(page, 'button[type="submit"]');
        await page.waitForNetworkIdle({ timeout: 15000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 3000));

        const text = await getResultsText(page);
        if (text && text.includes('Individual Info')) {
          // Extract the first name from the text (first non-empty line before "Individual Info")
          const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
          const infoIdx = lines.indexOf('Individual Info');
          if (infoIdx > 0) {
            const name = lines[infoIdx - 1];
            step(`Found entry: "${name}"`);
            await page.close().catch(() => {});
            return name;
          }
        }
        step(`No results for "${lastName}"`);
      } catch (e) {
        warn(`Error searching for "${lastName}": ${e.message}`);
      }
    }

    await page.close().catch(() => {});
    return null;
  } catch (e) {
    await page.close().catch(() => {});
    throw e;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('QBCC Excluded Individual Register — Live Integration Test');

  // Step 1: Determine fixture name
  step('Step 1: Resolving test fixture...');
  let directorName = suppliedName;

  if (!directorName) {
    try {
      directorName = await discoverQbccFixture();
    } catch (e) {
      fail('Step 1', `Fixture discovery threw: ${e.message}`, e.stack);
      summary(0, 1);
      process.exit(1);
    }
  }

  if (!directorName) {
    fail('Step 1',
      'Could not find any entry in the QBCC excluded register.\n' +
      'Either the SPA selectors changed or no entries exist for the candidate surnames.\n' +
      'Manually browse https://my.qbcc.qld.gov.au/myQBCC/s/excluded-individual-register\n' +
      'then re-run with: --name "First Last"');
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 1', `Test fixture: "${directorName}"`);

  // Step 2: Call searchQBCC with the fixture name in the directors array
  // Use a dummy company name — the excluded search only uses directors.
  step(`Step 2: Calling searchQBCC("__test__", "", ["${directorName}"])...`);
  step('  (Puppeteer will load the SPA again — allow ~60s)');

  let result;
  try {
    result = await searchQBCC('__test__', '', [directorName]);
  } catch (e) {
    fail('Step 2', `searchQBCC threw: ${e.message}`, e.stack);
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 2', `scraper returned without throwing`);
  step(`  Summary: "${result.summary}"`);
  step(`  Excluded results count: ${result.enforcementResults.length}`);

  if (result.enforcementResults.length > 0) {
    step('  Excluded results:');
    result.enforcementResults.forEach((r, i) => dump(`Excluded ${i + 1}`, { title: r.title, status: r.status }));
  }

  // Step 3: Verify fixture appears in enforcementResults (the excluded individuals array)
  step(`Step 3: Checking if "${directorName}" appears in enforcementResults...`);

  function normalise(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(); }
  const qWords = normalise(directorName).split(/\s+/).filter(Boolean);

  const found = result.enforcementResults.some((r) => {
    const rWords = new Set(normalise(r.title).split(/\s+/));
    return qWords.every((w) => rWords.has(w));
  });

  if (!found) {
    fail('Step 3',
      `"${directorName}" not found in enforcementResults.\n` +
      'Possible causes:\n' +
      '  • searchQBCCExcluded Puppeteer flow failed silently (check for shadow DOM changes)\n' +
      '  • parseExcludedResults block detection broken — look for "Individual Info" in raw text\n' +
      '  • Director name format mismatch (compare what discovery found vs what scraper returns)\n' +
      `  • Deduplication removed the entry (seen.has check in searchQBCCExcluded)`,
      { returned: result.enforcementResults.map((r) => r.title) });
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 3', `"${directorName}" confirmed in enforcementResults`);

  summary(3, 0);
  process.exit(0);
})();
