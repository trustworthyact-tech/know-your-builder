/**
 * TEST: AustLII — Court and Tribunal Cases
 *
 * PURPOSE
 *   Verifies that searchAustLII() returns results when given an entity name
 *   known to appear in AustLII case listings. The test self-discovers a fixture
 *   by fetching AustLII's search results page directly with axios (Step 1), then
 *   calls the full scraper and checks the same jurisdiction returns matching cases
 *   (Step 2), and finally spot-checks two additional jurisdictions for correct
 *   shape and connectivity (Step 3).
 *
 *   Three-layer structure isolates failures:
 *     • Step 1 fails (AustLII unreachable or no case listings returned)
 *       → AustLII may be down, blocking with Cloudflare, or the li/a[href*="/cases/"]
 *         selector no longer matches the search results HTML structure
 *     • Step 2 fails (scraper returns 0 results for a known fixture)
 *       → The post-filter logic (URL prefix or titleMatchesTerm) is too strict,
 *         or JURISDICTION_PATH['federal'] changed; the scraper's cheerio selectors
 *         also match Step 1's selectors, so a discrepancy here points to filtering
 *     • Step 3 fails (incorrect jurisdiction label on results)
 *       → JURISDICTION_LABELS mapping changed, or results from one jurisdiction
 *         are leaking into another (prefix filter broken)
 *       → results.length === 0 is acceptable for qld/nsw — the fixture may genuinely
 *         not appear in those databases; this only checks shape and no-throw
 *
 * NOTE ON ARCHITECTURE
 *   AustLII does a single global search and post-filters by URL prefix per jurisdiction.
 *   The pendingFetches cache in austlii.js means concurrent calls for the same term
 *   share one HTTP request. Step 3's Promise.all exercises this deduplication path.
 *
 * REQUIREMENTS
 *   No API keys or Puppeteer needed — axios + cheerio only.
 *   Set SCRAPERAPI_KEY in server/.env to route through ScraperAPI if AustLII blocks.
 *
 * USAGE
 *   node server/tests/test-austlii.js
 *   node server/tests/test-austlii.js --name "Building Contractor"
 *   node server/tests/test-austlii.js --jurisdiction qld,nsw,vic
 *
 * EXIT CODE
 *   0 — all assertions passed
 *   1 — any step failed or threw
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: AustLII returned no case listings"
 *     → The li > a[href*="/cases/"] selector no longer matches AustLII HTML;
 *       open https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?query=building+contractor
 *       and inspect the result list markup
 *   "Step 1 FAIL: could not reach AustLII"
 *     → Network / Cloudflare block; try setting SCRAPERAPI_KEY in server/.env
 *   "Step 2 FAIL: 0 results from scraper for federal jurisdiction"
 *     → JURISDICTION_PATH['federal'] changed, or titleMatchesTerm is over-filtering;
 *       check that JURISDICTION_PATH['federal'] === '/au/cases/cth' in austlii.js
 *   "Step 2 FAIL: result missing jurisdiction field"
 *     → searchAustLII no longer sets result.jurisdiction; check the return shape
 *   "Step 3 FAIL: incorrect jurisdiction label"
 *     → JURISDICTION_LABELS mapping changed; verify 'qld' → 'QLD', 'nsw' → 'NSW'
 */

'use strict';

const path    = require('path');
const axios   = require('axios');
const cheerio = require('cheerio');
const { searchAustLII } = require(path.join(__dirname, '../scrapers/austlii'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

// ── Configuration ─────────────────────────────────────────────────────────────

// AustLII search endpoint — same one the scraper uses internally
const AUSTLII_SEARCH_URL = 'https://www.austlii.edu.au/cgi-bin/sinosrch.cgi';

// Company name used as discovery query — must return case results (not just journals).
// "Multiplex" is the CLAUDE.md performance baseline entity and reliably yields
// li > a[href*="/cases/"] links. Generic phrases like "building contractor" return
// journals/other documents in the top 20 and fail the selector.
const DISCOVERY_QUERY = 'Multiplex';

// Expected jurisdiction label returned by the scraper for 'federal'
const FEDERAL_LABEL = 'Federal';

// Jurisdiction labels for spot-check jurisdictions
const SPOT_CHECK_LABELS = { qld: 'QLD', nsw: 'NSW' };

// Axios timeout — ScraperAPI adds latency on top of AustLII's own response time
const AXIOS_TIMEOUT = 40000;

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

// --name "Some Entity" overrides fixture discovery
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// --jurisdiction qld,nsw,vic overrides which jurisdictions are spot-checked in Step 3
// Defaults to 'qld' and 'nsw' if not supplied
const jurisdictionIdx = args.indexOf('--jurisdiction');
const spotCheckJurisdictions = jurisdictionIdx !== -1
  ? args[jurisdictionIdx + 1].split(',').map((j) => j.trim().toLowerCase())
  : ['qld', 'nsw'];

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Extract a party/entity name from an AustLII case title.
 * Common AustLII title formats:
 *   "Smith v Jones [2023] FCA 123"
 *   "ABC Building Pty Ltd v Commissioner [2022] QCA 45"
 *   "Director of Public Prosecutions v Williams [2021] NSWSC 99"
 *
 * We extract the first party (before " v ") and prefer names that look like
 * a company (contains "Pty", "Ltd", numbers, or multiple capitalised words)
 * over generic role descriptions.
 */
function extractPartyName(title) {
  if (!title) return null;

  // Strip citation suffix like "[2023] FCA 123"
  const withoutCitation = title.replace(/\s*\[\d{4}\]\s+\w+\s+\d+.*$/, '').trim();

  // Split on " v " or " v. " (case insensitive, various spacing)
  const parts = withoutCitation.split(/\s+v\.?\s+/i);
  if (parts.length < 2) return null;

  const firstParty = parts[0].trim();
  if (!firstParty || firstParty.length < 3) return null;

  // Reject overly generic single-word entries
  const genericSingle = /^(the|a|re|in|director|commissioner|minister|secretary|council|state|commonwealth|corporation|company|builder|contractor|trustee|receiver)$/i;
  const words = firstParty.split(/\s+/);
  if (words.length === 1 && genericSingle.test(words[0])) return null;

  return firstParty;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('AustLII — Court and Tribunal Cases Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Fetch AustLII search page directly to confirm reachability ───────
  // This step bypasses the scraper entirely. It confirms AustLII is up and that
  // the raw search results HTML contains parseable case listings before we rely
  // on the scraper's own HTTP call in Step 2.
  step(`Step 1: Fetching AustLII search page directly (query="${DISCOVERY_QUERY}")...`);
  step(`  URL: ${AUSTLII_SEARCH_URL}?method=auto&query=${encodeURIComponent(DISCOVERY_QUERY)}&results=20`);

  let rawCaseTitles = [];
  let rawCaseUrls   = [];

  // AustLII blocks direct requests with 403 — route through ScraperAPI exactly as
  // the scraper does in fetchTermResults (server/scrapers/austlii.js).
  const scraperApiKey = process.env.SCRAPERAPI_KEY;
  if (scraperApiKey) {
    step('  Routing through ScraperAPI (SCRAPERAPI_KEY set)');
  } else {
    warn('  SCRAPERAPI_KEY not set — direct request to AustLII will likely return 403');
  }

  const directUrl = `${AUSTLII_SEARCH_URL}?method=auto&query=${encodeURIComponent(DISCOVERY_QUERY)}&results=20`;
  const reqUrl = scraperApiKey
    ? `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(directUrl)}`
    : directUrl;

  try {
    const { data } = await axios.get(reqUrl, {
      timeout: AXIOS_TIMEOUT,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; know-your-builder-test/1.0)' },
    });

    const $ = cheerio.load(data);

    // Primary selector: same as the scraper uses in fetchTermResults
    $('li').each((_, el) => {
      const link = $(el).find('a').first();
      const href = link.attr('href');
      const title = link.text().trim();
      if (!href || !title || !href.includes('/cases/')) return;
      rawCaseTitles.push(title);
      rawCaseUrls.push(href.startsWith('http') ? href : `https://www.austlii.edu.au${href}`);
    });

    // Fallback: older numbered-list format (mirrors scraper fallback)
    if (rawCaseTitles.length === 0) {
      $('ol li').each((_, el) => {
        const link = $(el).find('a').first();
        const href = link.attr('href');
        const title = link.text().trim();
        if (!href || !title) return;
        rawCaseTitles.push(title);
        rawCaseUrls.push(href.startsWith('http') ? href : `https://www.austlii.edu.au${href}`);
      });
    }

    step(`  Raw HTML parsed — found ${rawCaseTitles.length} case listing(s)`);
    if (rawCaseTitles.length > 0) {
      step(`  First case title: "${rawCaseTitles[0]}"`);
    }
  } catch (e) {
    fail('Step 1',
      `Could not reach AustLII: ${e.message}\n` +
      'Possible causes:\n' +
      `  • ${scraperApiKey ? 'ScraperAPI request failed — check SCRAPERAPI_KEY validity or quota' : 'SCRAPERAPI_KEY not set — AustLII blocks direct requests with 403'}\n` +
      '  • AustLII may be down or the search endpoint URL changed\n' +
      `  • Direct URL: ${directUrl}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  if (rawCaseTitles.length === 0) {
    fail('Step 1',
      'AustLII returned no case listings in the raw HTML.\n' +
      'Possible causes:\n' +
      '  • AustLII changed its result list markup (li > a[href*="/cases/"] no longer matches)\n' +
      '  • The query returned zero results (unlikely for "building contractor")\n' +
      '  • Cloudflare returned an error/challenge page instead of search results\n' +
      `Browse manually: ${AUSTLII_SEARCH_URL}?method=auto&query=${encodeURIComponent(DISCOVERY_QUERY)}&results=20`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 1', `AustLII reachable — ${rawCaseTitles.length} case listing(s) found in raw HTML`);
  passed++;

  // ── Determine fixture name ────────────────────────────────────────────────────
  // Use supplied name if provided, otherwise extract from the first raw case title
  // whose first party looks like a named entity (not a generic role).
  step('  Selecting fixture name from raw case listings...');

  let fixtureName = suppliedName;

  if (!fixtureName) {
    for (let i = 0; i < rawCaseTitles.length; i++) {
      const candidate = extractPartyName(rawCaseTitles[i]);
      if (candidate) {
        fixtureName = candidate;
        step(`  Fixture extracted from title: "${rawCaseTitles[i]}"`);
        break;
      }
    }
  }

  if (!fixtureName) {
    // Last resort: use first two capitalised words from the first title
    const capWords = (rawCaseTitles[0] || '').match(/\b[A-Z][a-z]{2,}/g);
    if (capWords && capWords.length >= 2) {
      fixtureName = capWords.slice(0, 2).join(' ');
      warn(`Could not extract a clean party name — falling back to: "${fixtureName}"`);
    } else {
      fail('Step 1',
        'Could not extract any usable entity name from AustLII case titles.\n' +
        'Re-run with --name "Entity Name" to supply a fixture manually.\n' +
        'Titles found:',
        rawCaseTitles.slice(0, 5));
      failed++;
      summary(passed, failed);
      process.exit(1);
    }
  }

  step(`  Fixture name: "${fixtureName}"`);

  // ── Step 2: Call scraper for the federal jurisdiction ─────────────────────────
  // This is the primary assertion: given a name known to appear in AustLII results
  // (from Step 1), the scraper must return at least one result and each result must
  // carry the correct jurisdiction label.
  //
  // Diagnostic: if Step 1 found case listings but Step 2 returns 0, the most likely
  // cause is that the federal jurisdiction path post-filter (/au/cases/cth) is
  // excluding the results, or titleMatchesTerm is filtering out every case.
  step(`\nStep 2: Calling searchAustLII("${fixtureName}", [], "federal")...`);
  step('  (post-filter: only results with URL prefix /au/cases/cth will be kept)');

  let federalResult;
  try {
    federalResult = await searchAustLII(fixtureName, [], 'federal');
  } catch (e) {
    fail('Step 2', `searchAustLII threw for jurisdiction "federal": ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  step(`  Summary: "${federalResult.summary}"`);
  step(`  Results count: ${federalResult.results.length}`);
  step(`  Jurisdiction label: "${federalResult.jurisdiction}"`);

  if (federalResult.results.length > 0) {
    federalResult.results.slice(0, 3).forEach((r, i) =>
      dump(`Federal result ${i + 1}`, { title: r.title, url: r.url }));
  }

  // Assert: scraper must return at least one result for the federal jurisdiction
  if (federalResult.results.length < 1) {
    fail('Step 2',
      `0 results from scraper for jurisdiction "federal" using fixture "${fixtureName}".\n` +
      'Possible causes:\n' +
      '  • The fixture name extracted in Step 1 does not appear in federal court cases\n' +
      '    (AustLII returned raw results for "building contractor" but none are federal)\n' +
      '  • JURISDICTION_PATH["federal"] !== "/au/cases/cth" (check austlii.js)\n' +
      '  • titleMatchesTerm is over-filtering — check that at least one word in\n' +
      `    "${fixtureName}" is longer than 3 chars and not in COMMON_WORDS\n` +
      'Diagnostic: raw federal-prefix URLs from Step 1:',
      rawCaseUrls.filter((u) => u.includes('/au/cases/cth')).slice(0, 5));
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  // Assert: jurisdiction field must equal "Federal"
  if (federalResult.jurisdiction !== FEDERAL_LABEL) {
    fail('Step 2',
      `Expected jurisdiction "${FEDERAL_LABEL}" but got "${federalResult.jurisdiction}".\n` +
      'Check JURISDICTION_LABELS["federal"] in server/scrapers/austlii.js.');
    failed++;
  } else {
    pass('Step 2',
      `searchAustLII returned ${federalResult.results.length} result(s) with jurisdiction "${federalResult.jurisdiction}"`);
    passed++;
  }

  // Assert: every result must carry the correct jurisdiction label
  const wrongJurisdiction = federalResult.results.filter(
    (r) => r.jurisdiction !== undefined && r.jurisdiction !== FEDERAL_LABEL
  );
  if (wrongJurisdiction.length > 0) {
    warn(`${wrongJurisdiction.length} result(s) have unexpected jurisdiction values:`);
    wrongJurisdiction.slice(0, 3).forEach((r) =>
      warn(`  title="${r.title}" jurisdiction="${r.jurisdiction}"`));
  }

  // ── Step 3: Spot-check additional jurisdictions via Promise.all ───────────────
  // These calls use the SAME fixture name as Step 2. They may return 0 results —
  // that is acceptable, since the fixture entity may not appear in QLD or NSW courts.
  // The goal is:
  //   (a) scraper does not throw
  //   (b) returned jurisdiction label matches the expected label for each jurisdiction
  //   (c) if results are returned, their URLs start with the correct jurisdiction prefix
  //
  // Running via Promise.all also exercises the pendingFetches deduplication cache in
  // austlii.js: concurrent calls for the same term share a single HTTP request.
  const spotCheckList = spotCheckJurisdictions.filter((j) => j !== 'federal');
  step(`\nStep 3: Spot-checking jurisdictions [${spotCheckList.join(', ')}] via Promise.all...`);
  step(`  Note: results.length === 0 is acceptable — fixture may not appear in all jurisdictions`);
  step(`  Failures here indicate: label mapping changed, or URL prefix post-filter is broken`);

  let spotResults;
  try {
    spotResults = await Promise.all(
      spotCheckList.map((jur) => {
        step(`  Calling searchAustLII("${fixtureName}", [], "${jur}")...`);
        return searchAustLII(fixtureName, [], jur).then((res) => ({ jur, res, error: null }))
          .catch((err) => ({ jur, res: null, error: err }));
      })
    );
  } catch (e) {
    // Promise.all itself should not throw since individual errors are caught above
    fail('Step 3', `Unexpected error in Promise.all: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  for (const { jur, res, error } of spotResults) {
    const expectedLabel = SPOT_CHECK_LABELS[jur] || jur.toUpperCase();
    const expectedPrefix = `/au/cases/${jur}`;

    if (error) {
      fail(`Step 3 [${jur}]`,
        `searchAustLII threw for jurisdiction "${jur}": ${error.message}\n` +
        'AustLII may be rate-limiting or the network timed out.');
      failed++;
      continue;
    }

    step(`  [${jur}] summary: "${res.summary}" | results: ${res.results.length} | label: "${res.jurisdiction}"`);

    // Assert: jurisdiction label must be correct regardless of result count
    if (res.jurisdiction !== expectedLabel) {
      fail(`Step 3 [${jur}]`,
        `Expected jurisdiction label "${expectedLabel}" but got "${res.jurisdiction}".\n` +
        `Check JURISDICTION_LABELS["${jur}"] in server/scrapers/austlii.js.`);
      failed++;
      continue;
    }

    // Assert: if results were returned, their URLs must be prefixed with the correct path
    // A mismatch here means the post-filter (r.url.includes(pathPrefix)) is not working
    const wrongPrefix = res.results.filter((r) => !r.url.includes(expectedPrefix));
    if (wrongPrefix.length > 0) {
      fail(`Step 3 [${jur}]`,
        `${wrongPrefix.length} result(s) have URLs not under "${expectedPrefix}":\n` +
        wrongPrefix.slice(0, 3).map((r) => `  ${r.url}`).join('\n') + '\n' +
        `Check JURISDICTION_PATH["${jur}"] and the post-filter in searchAustLII().`);
      failed++;
      continue;
    }

    if (res.results.length > 0) {
      res.results.slice(0, 2).forEach((r, i) =>
        dump(`[${jur}] result ${i + 1}`, { title: r.title, url: r.url }));
    } else {
      step(`  [${jur}] 0 results — acceptable (fixture may not appear in ${expectedLabel} courts)`);
    }

    pass(`Step 3 [${jur}]`,
      `jurisdiction="${res.jurisdiction}" correct; ${res.results.length} result(s); URL prefixes valid`);
    passed++;
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
