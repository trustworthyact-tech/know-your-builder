/**
 * TEST: Victorian Building Authority — Licence Check Register
 *
 * PURPOSE
 *   Probes the VBA licence search (separate from the disciplinary register
 *   tested in test-vicbpc.js) to confirm:
 *     1. The register URL is reachable
 *     2. Searching by name returns parseable results
 *     3. A discovered entity can be found again by re-searching its name
 *
 *   There is no automated scraper for this licence database yet.
 *
 * FINDINGS (2026-06-11)
 *   - /check/licence and /find-a-practitioner both return 404.
 *   - The actual practitioner search is a Salesforce Experience Cloud (BAMS) app:
 *       https://bams.vba.vic.gov.au/bams/s/practitioner-search
 *   - The app uses the Aura ApexAction API:
 *       POST /bams/s/sfsites/aura?aura.ApexAction.execute=1
 *       classname: "PractitionerSearchUtil", method: "getPractitioners"
 *       params: { searchParamWrapper: { practitionerName, registrationCategory,
 *                 registrationClass, accreditationType } }
 *   - Inputs are inside Salesforce LWC shadow DOM — not reachable via standard
 *     CSS selectors. They ARE reachable as page.$$('input[type="text"]')[0].
 *   - Results shape: PractitionerDetailList[].{
 *       practitionerName, practitionerId, registrationCategoryWithClass,
 *       registrationNumber, status, phoneNumber, registrationType, detailURL }
 *
 * REQUIREMENTS
 *   No API keys. Uses Puppeteer (BAMS requires JavaScript rendering).
 *
 * USAGE
 *   node server/tests/test-vic-vba-licence.js
 *   node server/tests/test-vic-vba-licence.js --name "Multiplex"
 *
 * EXIT CODE
 *   0 — register accessible, fixture entity found
 *   1 — any step failed
 */

'use strict';

const path    = require('path');
const { getBrowser } = require(path.join(__dirname, '../scrapers/browser'));
const { pass, fail, step, warn, header, summary } = require('./lib/helpers');

const BAMS_SEARCH_URL = 'https://bams.vba.vic.gov.au/bams/s/practitioner-search';
const DEFAULT_SEARCH_TERM = 'multiplex';

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;
const searchTerm = suppliedName || DEFAULT_SEARCH_TERM;

/**
 * Load the BAMS page, type into the practitioner name field and click Search.
 * Returns the parsed PractitionerDetailList from the Aura API response.
 */
async function searchBAMS(query) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  let results = null;

  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('aura') && url.includes('ApexAction')) {
      try {
        const text = await resp.text().catch(() => '');
        const data = JSON.parse(text);
        const action = data.actions && data.actions[0];
        if (
          action &&
          action.returnValue &&
          action.returnValue.returnValue &&
          action.returnValue.returnValue.PractitionerDetailList
        ) {
          results = action.returnValue.returnValue;
        }
      } catch (e) { /* ignore non-JSON or other aura calls */ }
    }
  });

  try {
    await page.goto(BAMS_SEARCH_URL, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 5000));

    // Inputs are inside Salesforce LWC shadow DOM — page.$$('input[type="text"]')
    // reaches them because Puppeteer pierces shadow DOM.
    const inputs = await page.$$('input[type="text"]');
    if (inputs.length === 0) throw new Error('No text inputs found on BAMS page');

    // inputs[0] = Practitioner name, inputs[1] = Registration number,
    // inputs[2] = Suburb, inputs[3] = Postcode
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(query);
    await new Promise((r) => setTimeout(r, 500));

    // Find the Search button
    const buttons = await page.$$('button');
    let clicked = false;
    for (const btn of buttons) {
      const txt = await page.evaluate((b) => b.innerText.trim(), btn);
      if (txt === 'Search') {
        await btn.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error('Search button not found');

    // Wait for the Aura response
    await new Promise((r) => setTimeout(r, 6000));
    await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});

    return results;
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

(async () => {
  header('VIC VBA — Licence Check Register Probe');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Reachability ─────────────────────────────────────────────────────
  step('Step 1: Probing BAMS practitioner search...');
  step(`  URL: ${BAMS_SEARCH_URL}`);
  step(`  Search term: "${searchTerm}"`);

  let searchData = null;
  try {
    searchData = await searchBAMS(searchTerm);
  } catch (e) {
    fail('Step 1', `BAMS search failed: ${e.message}`);
    summary(0, 1);
    process.exit(1);
  }

  if (!searchData) {
    fail('Step 1', 'No Aura ApexAction response captured — search may have failed silently.');
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 1', `BAMS reachable via Puppeteer. API responded (recordCount=${searchData.recordCount})`);
  passed++;

  // ── Step 2: Parse results ────────────────────────────────────────────────────
  step('Step 2: Parsing results from Aura API response...');

  const list = searchData.PractitionerDetailList || [];
  if (list.length === 0) {
    fail('Step 2',
      `No results for "${searchTerm}". Try a different search term.\n` +
      'Results shape: PractitionerDetailList[].{ practitionerName, registrationNumber, status, registrationCategoryWithClass }');
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  const fixtureName = list[0].practitionerName;
  pass('Step 2', `Found ${list.length} result(s). Fixture: "${fixtureName}"`);
  passed++;
  step('  Sample results:');
  list.slice(0, 3).forEach((p) => {
    step(`    - ${p.practitionerName} | ${p.registrationNumber} | ${p.status} | ${p.registrationCategoryWithClass}`);
  });

  // ── Step 3: Re-search with fixture name ──────────────────────────────────────
  step(`Step 3: Re-searching for "${fixtureName}"...`);
  let reData = null;
  try {
    reData = await searchBAMS(fixtureName);
  } catch (e) {
    fail('Step 3', `Re-search failed: ${e.message}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  if (!reData || !reData.PractitionerDetailList) {
    fail('Step 3', 'Re-search returned no API response.');
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  const term0 = fixtureName.split(/\s+/)[0].toLowerCase();
  const found = reData.PractitionerDetailList.some(
    (p) => p.practitionerName.toLowerCase().includes(term0)
  );

  if (!found) {
    fail('Step 3',
      `"${fixtureName}" not found in re-search.\n` +
      `Re-search returned ${reData.recordCount} result(s): ` +
      reData.PractitionerDetailList.slice(0, 3).map((p) => p.practitionerName).join(', '));
    failed++;
  } else {
    pass('Step 3', `"${fixtureName}" confirmed in re-search (${reData.recordCount} result(s))`);
    passed++;
    step('');
    step('SCRAPER NOTE: VBA licence check is accessible via Puppeteer + Aura API.');
    step(`  Working URL: ${BAMS_SEARCH_URL}`);
    step('  API endpoint: POST /bams/s/sfsites/aura?aura.ApexAction.execute=1');
    step('  Apex class: PractitionerSearchUtil, method: getPractitioners');
    step('  Search param: searchParamWrapper.practitionerName');
    step('  Result key: PractitionerDetailList[].practitionerName / registrationNumber / status');
    step('  Inputs selector: page.$$("input[type=text]")[0] (LWC shadow DOM)');
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
