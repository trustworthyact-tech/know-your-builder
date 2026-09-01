/**
 * TEST: NSW Fair Trading — Building & Contractor Licence Register
 *
 * PURPOSE
 *   Probes the NSW Fair Trading licence search (via the Verify NSW JSON API) to
 *   confirm:
 *     1. The API endpoint is accessible and returns results
 *     2. Searching by name returns a parseable JSON structure
 *     3. A discovered entity can be found again by re-searching its name
 *
 *   There is now an automated scraper for this register — see
 *   server/scrapers/nswFairTrading.js and test-nsw-fairtrading.js, which tests
 *   the scraper function itself. This file remains as a raw-API probe.
 *
 * BACKGROUND
 *   The old domain (onlineservices.fairtrading.nsw.gov.au) is defunct (NXDOMAIN).
 *   The OneGov Public Register SPA that superseded it
 *   (https://www.onegov.nsw.gov.au/publicregister/) has itself since been
 *   retired — it now redirects straight to the Verify NSW homepage instead of
 *   any deep-linked record. The register is now the Verify NSW SPA at:
 *     https://verify.licence.nsw.gov.au/
 *   which calls a JSON REST API at:
 *     https://verify.licence.nsw.gov.au/publicregisterapi/api/v1/licence/search/advQuery
 *   with a JSON POST body:
 *     { licenceGroup, search, autoComplete, pageNumber, pageSize, licenceTypes }
 *
 *   Discovered group codes (building-relevant):
 *     "Trades" — contractor licences (Home Building Act), includes builders/contractors
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
 *   "Step 2 FAIL: no results found"  → licenceGroup changed or JSON shape changed
 *   "Step 3 FAIL: fixture not found" → search non-deterministic or name extraction broke
 *
 * SCRAPER NOTES
 *   API base: https://verify.licence.nsw.gov.au/publicregisterapi/api/v1/licence
 *   POST /search/advQuery
 *     body: { licenceGroup: "Trades", search: string, autoComplete: false, pageNumber: 0, pageSize: 20, licenceTypes: [] }
 *   Response: { pagingInfo: {...}, results: [...] }
 *   Each result: { licenceId, licenceNumber, licenceType, licenceTypeFriendly, status,
 *                  suburb, postcode, expires, ABN, ACN }
 *   No auth required. Requires Origin + Referer headers from verify.licence.nsw.gov.au.
 *   Per-licence compliance history (penalty notices, disciplinary action, etc — not
 *   present on the search response) is on the details endpoint:
 *     GET /search/details/{encodeURIComponent(licenceType)}/{encodeURIComponent(licenceId)}
 *     → { componentData: { notifications: [...], compliances: [...], complianceSummary: [...] } }
 *   Direct link: https://verify.licence.nsw.gov.au/details/{licenceType}/{licenceId}
 */

'use strict';

const axios = require('axios');
const { pass, fail, step, warn, header, summary } = require('./lib/helpers');

// Production Verify NSW public register API
const API_BASE = 'https://verify.licence.nsw.gov.au/publicregisterapi/api/v1/licence';
const SEARCH_URL = `${API_BASE}/search/advQuery`;
// Deep link to a specific result on the public register SPA
const REGISTER_BASE = 'https://verify.licence.nsw.gov.au';

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: 'https://verify.licence.nsw.gov.au',
  Referer: 'https://verify.licence.nsw.gov.au/',
};

// Building-relevant group codes discovered by JS analysis of the OneGov SPA bundle
const BUILDING_GROUP = 'Trades'; // Home Building Act contractor licences
const BROAD_TERMS = ['multiplex', 'constructions', 'building'];

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

async function searchLicences(query, groupCode = BUILDING_GROUP) {
  const { data } = await axios.post(SEARCH_URL, {
    licenceGroup: groupCode,
    search: query,
    autoComplete: false,
    pageNumber: 0,
    pageSize: 20,
    licenceTypes: [],
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
      if (data && Array.isArray(data.results) && data.results.length > 0) {
        results = data;
        usedTerm = term;
        step(`  Got ${data.results.length} result(s) for term "${term}"`);
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
      `Body shape: { licenceGroup: "${BUILDING_GROUP}", search, autoComplete: false, pageNumber: 0, pageSize: 20, licenceTypes: [] }\n` +
      'Check if the licenceGroup or API URL changed.');
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 1', `API reachable (search term: "${usedTerm}"). totalRecords=${results.pagingInfo?.totalRecords}`);
  passed++;

  // Step 2: Parse and validate JSON structure
  step('Step 2: Validating JSON result structure...');
  const firstResult = results.results[0];
  const requiredFields = ['licenceId', 'licensee', 'licenceNumber', 'status', 'licenceType'];
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

  const names = results.results.map((r) => r.licensee).filter(Boolean);
  const fixtureName = suppliedName || names[0];
  pass('Step 2',
    `Found ${results.results.length} result(s) with all required fields.\n` +
    `  Fixture: "${fixtureName}"\n` +
    `  Sample: ${names.slice(0, 3).join(', ')}`);
  passed++;
  step(`  First result: licensee="${firstResult.licensee}", licence=${firstResult.licenceNumber}, status=${firstResult.status}, abn=${firstResult.ABN}`);

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

  const reNames = (reData.results || []).map((r) => r.licensee).filter(Boolean);
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
    step('SCRAPER NOTE: NSW Fair Trading (Verify NSW) results are scrapeable via JSON API.');
    step(`  API endpoint: POST ${SEARCH_URL}`);
    step(`  Licence group for builders/contractors: licenceGroup="${BUILDING_GROUP}"`);
    step(`  Response key: results[] with fields: licensee, licenceNumber, status, ABN, ACN, expires`);
    step(`  Compliance history (not in the search response): GET ${API_BASE}/search/details/{licenceType}/{licenceId}`);
    step(`  Deep link: ${REGISTER_BASE}/details/{licenceType}/{licenceId}`);
    step(`  Search URL for links.js: ${REGISTER_BASE}/home/${BUILDING_GROUP.toLowerCase()}`);
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
