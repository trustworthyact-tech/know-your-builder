/**
 * TEST: NSW Fair Trading — Building & Contractor Licence Register
 *
 * PURPOSE
 *   Probes the NSW Fair Trading licence search (via OneGov JSON API) to confirm:
 *     1. The API endpoint is accessible and returns results
 *     2. Searching by name returns a parseable JSON structure
 *     3. A discovered entity can be found again by re-searching its name
 *
 *   There is no automated scraper for this register yet. This test establishes
 *   that it CAN be scraped and documents the API shape needed.
 *
 * BACKGROUND
 *   The old domain (onlineservices.fairtrading.nsw.gov.au) is defunct (NXDOMAIN).
 *   The register is now the OneGov Public Register SPA at:
 *     https://www.onegov.nsw.gov.au/publicregister/
 *   which calls a JSON REST API at:
 *     https://api.onegov.nsw.gov.au/LicenceCheckService/api/Search/PerformSearch
 *   with a JSON POST body:
 *     { searchCriteria, licenceGroupCode, searchType, rowsPerPage }
 *
 *   Discovered group codes (building-relevant):
 *     "Trades"   — contractor licences (Home Building Act), includes builders/contractors
 *     "Property" — property/real estate agents
 *
 *   The link on fairtrading.nsw.gov.au redirects to nsw.gov.au content; the
 *   actual searchable register lives on onegov.nsw.gov.au.
 *
 * REQUIREMENTS
 *   No API keys or Puppeteer — axios only.
 *
 * USAGE
 *   node server/tests/test-nsw-fairtrading-licence.js
 *   node server/tests/test-nsw-fairtrading-licence.js --name "Acme Constructions"
 *
 * EXIT CODE
 *   0 — register accessible, fixture entity found by re-search
 *   1 — any step failed
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: request failed"    → API URL changed or site blocked bots
 *   "Step 2 FAIL: no results found"  → licenceGroupCode changed or JSON shape changed
 *   "Step 3 FAIL: fixture not found" → search non-deterministic or name extraction broke
 *
 * SCRAPER NOTES (for future implementation)
 *   API base: https://api.onegov.nsw.gov.au/LicenceCheckService
 *   POST /api/Search/PerformSearch
 *     body: { searchCriteria: string, licenceGroupCode: "Trades", searchType: "fulltext", rowsPerPage: 20 }
 *   Response: { licenceSearchResults: [...], hasMoreRows: bool, searchId: string }
 *   Each result: { licensee, licenceNumber, licenceType, status, suburb, postcode,
 *                  expiryDate, abn, acn, licenceID }
 *   Pagination: POST /api/Search/ScrollLicenceResults with { searchId, endPageNumber, rowsPerPage }
 *   No auth required. Requires Origin + Referer headers from onegov.nsw.gov.au.
 *   Direct link: https://www.onegov.nsw.gov.au/publicregister/#/publicregister/result/{licenceID}
 */

'use strict';

const axios = require('axios');
const { pass, fail, step, warn, header, summary } = require('./lib/helpers');

// Production OneGov LicenceCheckService API
const API_BASE = 'https://api.onegov.nsw.gov.au/LicenceCheckService';
const SEARCH_URL = `${API_BASE}/api/Search/PerformSearch`;
// Deep link to a specific result on the public register SPA
const REGISTER_BASE = 'https://www.onegov.nsw.gov.au/publicregister';

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: 'https://www.onegov.nsw.gov.au',
  Referer: 'https://www.onegov.nsw.gov.au/publicregister/',
};

// Building-relevant group codes discovered by JS analysis of the OneGov SPA bundle
const BUILDING_GROUP = 'Trades'; // Home Building Act contractor licences
const BROAD_TERMS = ['multiplex', 'constructions', 'building'];

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

async function searchLicences(query, groupCode = BUILDING_GROUP) {
  const { data } = await axios.post(SEARCH_URL, {
    searchCriteria: query,
    licenceGroupCode: groupCode,
    searchType: 'fulltext',
    rowsPerPage: 20,
  }, { headers: HEADERS, timeout: 20000 });
  return data;
}

(async () => {
  header('NSW Fair Trading — Building Licence Register Probe');
  let passed = 0;
  let failed = 0;

  // Step 1: Reachability probe — try broad terms until we get results
  step('Step 1: Probing NSW Fair Trading / OneGov licence API...');
  let results = null;
  let usedTerm = null;

  for (const term of (suppliedName ? [suppliedName] : BROAD_TERMS)) {
    try {
      const data = await searchLicences(term);
      if (data && Array.isArray(data.licenceSearchResults) && data.licenceSearchResults.length > 0) {
        results = data;
        usedTerm = term;
        step(`  Got ${data.licenceSearchResults.length} result(s) for term "${term}"`);
        break;
      } else {
        warn(`  Search "${term}" returned 0 results`);
      }
    } catch (e) {
      warn(`  Search "${term}" failed: ${e.message}`);
    }
  }

  if (!results) {
    fail('Step 1', 'All search attempts failed.\n' +
      `Target API: POST ${SEARCH_URL}\n` +
      `Body shape: { searchCriteria, licenceGroupCode: "${BUILDING_GROUP}", searchType: "fulltext", rowsPerPage: 20 }\n` +
      'Check if the licenceGroupCode or API URL changed.');
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 1', `API reachable (search term: "${usedTerm}"). hasMoreRows=${results.hasMoreRows}`);
  passed++;

  // Step 2: Parse and validate JSON structure
  step('Step 2: Validating JSON result structure...');
  const firstResult = results.licenceSearchResults[0];
  const requiredFields = ['licenceID', 'licensee', 'licenceNumber', 'status', 'licenceType'];
  const missingFields = requiredFields.filter((f) => !(f in firstResult));

  if (missingFields.length > 0) {
    fail('Step 2',
      `Result is missing expected fields: ${missingFields.join(', ')}\n` +
      `Actual fields: ${Object.keys(firstResult).join(', ')}\n` +
      `First result: ${JSON.stringify(firstResult, null, 2).slice(0, 500)}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  const names = results.licenceSearchResults.map((r) => r.licensee).filter(Boolean);
  const fixtureName = suppliedName || names[0];
  pass('Step 2',
    `Found ${results.licenceSearchResults.length} result(s) with all required fields.\n` +
    `  Fixture: "${fixtureName}"\n` +
    `  Sample: ${names.slice(0, 3).join(', ')}`);
  passed++;
  step(`  First result: licensee="${firstResult.licensee}", licence=${firstResult.licenceNumber}, status=${firstResult.status}, abn=${firstResult.abn}`);

  // Step 3: Re-search with the fixture name to confirm consistency
  step(`Step 3: Re-searching for "${fixtureName}" to verify search is consistent...`);

  let reData;
  try {
    reData = await searchLicences(fixtureName);
  } catch (e) {
    fail('Step 3', `Re-search request failed: ${e.message}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  const reNames = (reData.licenceSearchResults || []).map((r) => r.licensee).filter(Boolean);
  // Match on the first significant word of the fixture name
  const firstWord = fixtureName.split(' ')[0].toLowerCase();
  const found = reNames.some((n) => n.toLowerCase().includes(firstWord));

  if (!found) {
    fail('Step 3',
      `"${fixtureName}" not found in re-search results.\n` +
      `Re-search returned ${reNames.length} name(s): ${reNames.slice(0, 5).join(', ')}`);
    failed++;
  } else {
    pass('Step 3', `"${fixtureName}" confirmed in re-search results (${reNames.length} total)`);
    passed++;
    step('');
    step('SCRAPER NOTE: NSW Fair Trading (OneGov) results are scrapeable via JSON API.');
    step(`  API endpoint: POST ${SEARCH_URL}`);
    step(`  Licence group for builders/contractors: licenceGroupCode="${BUILDING_GROUP}"`);
    step(`  Response key: licenceSearchResults[] with fields: licensee, licenceNumber, status, abn, acn, expiryDate`);
    step(`  Pagination: searchId returned, use ScrollLicenceResults for page 2+`);
    step(`  Deep link: ${REGISTER_BASE}/#/publicregisterdetails/{licenceID}`);
    step(`  Search URL for links.js: ${REGISTER_BASE}/#/publicregister/search/${BUILDING_GROUP}`);
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
