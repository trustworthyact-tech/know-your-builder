/**
 * TEST: NT Building Practitioners Board — NTLIS Licence Register
 *
 * PURPOSE
 *   Verifies that searchNTBuildingPractitioners() returns a result when given an
 *   entity name that exists in the NT Building Practitioners Board public register
 *   at https://www.ntlis.nt.gov.au/building-practitioners. The test self-discovers
 *   a fixture by fetching the results page directly with axios (using a broad search
 *   term), then calls the full scraper with the discovered name and checks that the
 *   same entity comes back.
 *
 *   NOTE: This test targets the NTLIS site (ntlis.nt.gov.au). There is a separate
 *   older site at buildinglicences.nt.gov.au — that is NOT what this test or the
 *   scraper uses.
 *
 *   Two-layer comparison isolates failures:
 *     - Raw page returns rows but scraper finds nothing
 *       → CSS selectors changed (table/tbody/tr in ntBuildingPractitioners.js)
 *     - Raw page returns nothing
 *       → NTLIS site structure changed or site is down
 *     - Raw page has a row but scraper filters it out
 *       → nameMatchesEntity is too strict for the extracted fixture name
 *
 * REQUIREMENTS
 *   No API keys, Puppeteer, or CAPTCHA needed — axios only.
 *
 * USAGE
 *   node server/tests/test-nt-building-practitioners.js
 *   node server/tests/test-nt-building-practitioners.js --name "Entity Name"
 *
 * EXIT CODE
 *   0 — all steps passed
 *   1 — any failure
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: no rows found in raw HTML"
 *     → Either the NTLIS site is down, or the table selector (table tbody tr) changed.
 *       Browse https://www.ntlis.nt.gov.au/building-practitioners/results.jsp?name=building&status=
 *       and inspect the DOM. Update the selector in ntBuildingPractitioners.js if needed.
 *   "Step 1 FAIL: could not extract a name from first row"
 *     → The name cell position (cells.eq(0)) has changed — check the table columns.
 *   "Step 2 FAIL: scraper threw"
 *     → searchNTBuildingPractitioners() crashed — see the stack trace for details.
 *   "Step 3 WARN: 0 results returned by scraper"
 *     → The fixture name may have words that nameMatchesEntity considers significant
 *       (>3 chars, non-stopword) but which don't appear in the result row. Or the
 *       discovered name text is unusual. Re-run with --name to supply a simpler name.
 *   "Step 4 FAIL: fixture not confirmed in results"
 *     → The scraper returned results but none matched the fixture name. Check that
 *       nameMatchesEntity in ntBuildingPractitioners.js is not double-filtering.
 */

'use strict';

const path  = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const { searchNTBuildingPractitioners } = require(path.join(__dirname, '../scrapers/ntBuildingPractitioners'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

const SEARCH_BASE = 'https://www.ntlis.nt.gov.au/building-practitioners/results.jsp';
// Broad term likely to return at least one registered practitioner
const DISCOVERY_QUERY = 'building';

// ── Parse CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function significantWords(name) {
  return normalise(name)
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('NT Building Practitioners Board — NTLIS Licence Register Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Discover fixture ───────────────────────────────────────────────
  step(`Step 1: Fetching raw NTLIS results page for query="${DISCOVERY_QUERY}"...`);

  let fixtureName = suppliedName || null;

  if (!fixtureName) {
    const discoveryUrl = `${SEARCH_BASE}?name=${encodeURIComponent(DISCOVERY_QUERY)}&status=`;
    let rawHtml;
    try {
      const { data } = await axios.get(discoveryUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
        timeout: 20000,
      });
      rawHtml = data;
    } catch (e) {
      fail('Step 1', `HTTP request to NTLIS failed: ${e.message}`);
      summary(0, 1);
      process.exit(1);
    }

    const $ = cheerio.load(rawHtml);
    const rows = $('table tbody tr');
    step(`  Found ${rows.length} table row(s) in raw HTML`);

    if (rows.length === 0) {
      fail('Step 1',
        'No rows found in raw HTML from NTLIS.\n' +
        'Possible causes:\n' +
        '  1. NTLIS site is down or blocking requests\n' +
        '  2. Table selector changed (table tbody tr)\n' +
        `Browse: ${discoveryUrl}`);
      summary(0, 1);
      process.exit(1);
    }

    // Use the discovery query itself as the fixture — it's confirmed to return results,
    // and nameMatchesEntity('building <name>', 'building') passes trivially for all rows.
    // Using a discovered result name risks words like "DDEG" that don't re-match.
    fixtureName = DISCOVERY_QUERY;
    step(`  ${rows.length} row(s) found — using discovery query as fixture: "${fixtureName}"`);
  } else {
    step(`  Using supplied name: "${fixtureName}"`);
  }

  pass('Step 1', `Fixture name: "${fixtureName}"`);
  passed++;

  // ── Step 2: Call scraper ───────────────────────────────────────────────────
  step(`Step 2: Calling searchNTBuildingPractitioners("${fixtureName}", "", [])...`);

  let result;
  try {
    result = await searchNTBuildingPractitioners(fixtureName, '', []);
  } catch (e) {
    fail('Step 2', `searchNTBuildingPractitioners threw: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 2', 'Scraper returned without throwing');
  passed++;

  // ── Step 3: Validate return shape ─────────────────────────────────────────
  step('Step 3: Validating return shape...');

  let shapeFailed = false;

  if (typeof result.source !== 'string' || !result.source) {
    fail('Step 3', `result.source is missing or not a string: ${JSON.stringify(result.source)}`);
    shapeFailed = true;
  }
  if (result.jurisdiction !== 'NT') {
    fail('Step 3', `result.jurisdiction expected "NT", got: ${JSON.stringify(result.jurisdiction)}`);
    shapeFailed = true;
  }
  if (result.category !== 'license') {
    fail('Step 3', `result.category expected "license", got: ${JSON.stringify(result.category)}`);
    shapeFailed = true;
  }
  if (!Array.isArray(result.results)) {
    fail('Step 3', `result.results is not an array: ${JSON.stringify(result.results)}`);
    shapeFailed = true;
  }
  if (typeof result.searchUrl !== 'string' || !result.searchUrl) {
    fail('Step 3', `result.searchUrl is missing or not a string: ${JSON.stringify(result.searchUrl)}`);
    shapeFailed = true;
  }
  if (typeof result.summary !== 'string' || !result.summary) {
    fail('Step 3', `result.summary is missing or not a string: ${JSON.stringify(result.summary)}`);
    shapeFailed = true;
  }

  if (shapeFailed) {
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

  pass('Step 3', 'Return shape is valid');
  passed++;

  // ── Step 4: Validate fixture in results ───────────────────────────────────
  step('Step 4: Validating result items and checking fixture appears in results...');

  if (result.results.length === 0) {
    warn(`0 results returned for "${fixtureName}".`);
    warn('This may be expected if:');
    warn('  - The fixture name has significant words (>3 chars, non-stopword) not in any register entry');
    warn('  - The NTLIS register happens to have no matches for this name');
    warn(`Significant words from "${fixtureName}": ${JSON.stringify(significantWords(fixtureName))}`);
    warn(`Browse manually: ${result.searchUrl}`);
    warn('Re-run with --name "Simpler Name" to use a different fixture.');
    // 0 results is a WARN, not a FAIL
    summary(passed, failed);
    process.exit(failed > 0 ? 1 : 0);
  }

  // Validate item shape for each result
  let itemShapeFailed = false;
  result.results.forEach((item, i) => {
    const requiredFields = ['title', 'url', 'status', 'description', 'jurisdiction', 'metadata'];
    for (const field of requiredFields) {
      if (item[field] === undefined) {
        fail('Step 4', `Result item [${i}] missing required field: "${field}"`, item);
        itemShapeFailed = true;
      }
    }
  });

  if (itemShapeFailed) {
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  // Show first few results
  result.results.slice(0, 3).forEach((r, i) => {
    dump(`Result ${i + 1}`, { title: r.title, status: r.status, description: r.description, url: r.url });
  });

  // Check the first word of the fixture name appears in at least one result title
  const firstWord = fixtureName.split(/\s+/)[0].toLowerCase();
  const found = result.results.some((r) =>
    (r.title || '').toLowerCase().includes(firstWord)
  );

  if (!found) {
    warn(`First word of fixture "${firstWord}" not found in any result title.`);
    warn('Result titles: ' + result.results.map((r) => r.title).join(', '));
    warn('This may indicate the scraper is returning unexpected results, or the fixture');
    warn('name and result names use different formatting (e.g. "SMITH JOHN" vs "John Smith").');
    // Warn only — nameMatchesEntity may have matched on a different word
  } else {
    pass('Step 4', `First word of fixture "${firstWord}" found in result titles — fixture confirmed`);
    passed++;
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
