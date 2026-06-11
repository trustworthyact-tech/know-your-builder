/**
 * TEST: VIC Building Practitioners Board — Disciplinary Register
 *
 * PURPOSE
 *   Verifies that searchVicBpc() returns a result for a practitioner confirmed
 *   to be on the VBA prosecution & disciplinary register. The test fetches the
 *   raw HTML with axios first (no browser) to discover a live fixture, then
 *   calls the full scraper (which uses Puppeteer + List.js search) and confirms
 *   the same entry is returned.
 *
 *   Comparing the two layers pinpoints where the failure is:
 *     • Raw HTML has entry but scraper misses it → browser automation broken
 *     • Raw HTML has entry and scraper finds it   → PASS
 *     • Raw HTML has no entries                  → VBA changed page structure
 *
 * REQUIREMENTS
 *   Puppeteer (installed in server/node_modules) — no API keys needed.
 *
 * USAGE
 *   node server/tests/test-vicbpc.js
 *   node server/tests/test-vicbpc.js --name "Richard Jones"
 *
 * EXIT CODE
 *   0 — fixture practitioner found by scraper
 *   1 — not found or error at any layer
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: no accordion blocks found"
 *     → VBA changed their HTML structure (check .accordion__block selector)
 *   "Step 2 FAIL: no .da_name found"
 *     → VBA changed the practitioner name element (check .da_name selector)
 *   "Step 3 FAIL: scraper returned 0 results"
 *     → Puppeteer could not load the page, or List.js search input (#listjs-search)
 *       selector is wrong, or the accordion parsing logic broke after the fixture
 *       was found in raw HTML — compare accordion structure in the raw HTML
 *   "Step 4 FAIL: fixture not in results"
 *     → nameMatchesEntity filter is too strict; check the significant-word
 *       threshold (> 3 chars, not stopwords) in server/scrapers/vicBpc.js
 */

'use strict';

const path    = require('path');
const cheerio = require('cheerio');
const { searchVicBpc } = require(path.join(__dirname, '../scrapers/vicBpc'));
const { getBrowser } = require(path.join(__dirname, '../scrapers/browser'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

const PROSECUTION_URL = 'https://www.vba.vic.gov.au/tools/prosecution-and-disciplinary-register';

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('VIC Building Practitioners Board — Disciplinary Register Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Fetch raw HTML via Puppeteer (Cloudflare blocks plain axios) ────
  step('Step 1: Fetching VBA prosecution register via Puppeteer (Cloudflare bypass)...');

  let rawHtml;
  let _cfPage;
  try {
    const _browser = await getBrowser();
    _cfPage = await _browser.newPage();
    await _cfPage.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await _cfPage.goto(PROSECUTION_URL, { waitUntil: 'networkidle2', timeout: 45000 });

    // Poll until the Cloudflare "Just a moment..." challenge clears
    const cfDeadline = Date.now() + 15000;
    while (Date.now() < cfDeadline) {
      const title = await _cfPage.title();
      if (!/just a moment|cloudflare|checking your browser/i.test(title)) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    rawHtml = await _cfPage.content();
  } catch (e) {
    fail('Step 1', `Puppeteer page load failed: ${e.message}`);
    warn('  Check whether the VBA site is accessible and the URL is still valid.');
    if (_cfPage) await _cfPage.close().catch(() => {});
    summary(0, 1);
    process.exit(1);
  }
  await _cfPage.close().catch(() => {});

  const $raw = cheerio.load(rawHtml);
  const accordionBlocks = $raw('.accordion__block');

  if (accordionBlocks.length === 0) {
    fail('Step 1',
      'No .accordion__block elements found in raw HTML.\n' +
      'The VBA may have changed their page structure, or the page is behind Cloudflare.\n' +
      `URL: ${PROSECUTION_URL}\n` +
      'Raw HTML snippet (first 500 chars):',
      rawHtml.slice(0, 500));
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 1', `Found ${accordionBlocks.length} accordion blocks in raw HTML`);
  passed++;

  // ── Step 2: Extract fixture name ───────────────────────────────────────────
  step('Step 2: Extracting practitioner name from first accordion block...');

  let fixtureName = suppliedName;

  if (!fixtureName) {
    const firstName = $raw(accordionBlocks.first()).find('.da_name').text().trim();
    if (!firstName) {
      fail('Step 2',
        'First accordion block has no .da_name element.\n' +
        'The VBA may have changed the practitioner name element class.\n' +
        'Raw block HTML:',
        $raw(accordionBlocks.first()).html()?.slice(0, 600));
      failed++;
      summary(passed, failed);
      process.exit(1);
    }
    fixtureName = firstName;
  }

  pass('Step 2', `Test fixture: "${fixtureName}"`);
  passed++;

  // Sanity check: confirm the fixture name actually appears in raw HTML
  const fixtureInRaw = (() => {
    let found = false;
    accordionBlocks.each((_, block) => {
      if ($raw(block).find('.da_name').text().trim() === fixtureName) found = true;
    });
    return found;
  })();

  if (!fixtureInRaw && !suppliedName) {
    warn('Fixture name not found in .da_name elements after extraction — proceeding anyway.');
  }

  // ── Step 3: Call searchVicBpc ──────────────────────────────────────────────
  // searchVicBpc takes (companyName, abn, directors). We pass the fixture name
  // as companyName (after stripping any Pty Ltd suffix the scraper would strip).
  // If the fixture is a personal name we also pass it as a director.
  step(`Step 3: Calling searchVicBpc("${fixtureName}", "", ["${fixtureName}"])...`);
  step('  (Puppeteer will load the VBA page and type into #listjs-search — allow ~30s)');

  let result;
  try {
    result = await searchVicBpc(fixtureName, '', [fixtureName]);
  } catch (e) {
    fail('Step 3', `searchVicBpc threw: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 3', `scraper returned without throwing`);
  step(`  Summary: "${result.summary}"`);
  step(`  Results count: ${result.results.length}`);

  if (result.results.length === 0) {
    fail('Step 3',
      'Scraper returned 0 results even though the entry exists in raw HTML.\n' +
      'Possible causes:\n' +
      '  • #listjs-search selector not found → VBA changed the search input ID\n' +
      '  • Browser automation failed silently → check fetchWithBrowserSearch in browser.js\n' +
      '  • Cloudflare is blocking the headless browser (axois works but Puppeteer blocked)\n' +
      '  • nameMatchesEntity filtering too strict — all significant words must appear in\n' +
      '    the accordion block text (see nameMatchesEntity in server/scrapers/vicBpc.js)');
    failed++;
    summary(passed, failed);
    process.exit(1);
  }
  passed++;

  if (result.results.length > 0) {
    step('  Sample results:');
    result.results.slice(0, 3).forEach((r, i) =>
      dump(`Result ${i + 1}`, { title: r.title, date: r.date, status: r.status?.slice(0, 80) }));
  }

  // ── Step 4: Verify fixture appears in results ──────────────────────────────
  step(`Step 4: Checking if "${fixtureName}" appears in results...`);

  function normalise(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(); }
  const qWords = normalise(fixtureName).split(/\s+/).filter((w) => w.length > 3 && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));

  const found = result.results.some((r) => {
    const text = normalise(r.title + ' ' + (r.description || ''));
    return qWords.length > 0 && qWords.every((w) => text.includes(w));
  });

  if (!found) {
    fail('Step 4',
      `"${fixtureName}" not found in scraper results.\n` +
      `Significant words being matched (>3 chars, non-stopword): ${JSON.stringify(qWords)}\n` +
      'Returned titles:',
      result.results.map((r) => r.title));
    failed++;
  } else {
    pass('Step 4', `"${fixtureName}" confirmed in scraper results`);
    passed++;
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
