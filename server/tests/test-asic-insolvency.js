/**
 * TEST: ASIC Published Notices — Insolvency / Winding-Up Notices
 *
 * PURPOSE
 *   Verifies that searchAsicInsolvency() returns a result when given an entity
 *   name confirmed to appear in an ASIC Published Notices insolvency/winding-up
 *   listing. The test self-discovers a fixture by fetching the initial page HTML
 *   with axios, then calls the full scraper (which uses Puppeteer + form
 *   submission) and confirms the same entity comes back.
 *
 *   NOTE: If both test-asic-insolvency and test-ato-debt fail simultaneously,
 *   the ASIC Published Notices site is likely down or has changed structure.
 *
 *   Two-layer comparison isolates failures:
 *     • Raw GET has article-blocks but scraper misses them
 *       → Puppeteer form submission broken, or __doPostBack target changed
 *     • Raw GET has no article-blocks on initial load
 *       → Site may render all listings only after a form post; fixture discovery
 *         falls back to a broad browse URL — check BROWSE_URL in this file
 *     • Raw GET has articles but entity name cannot be extracted
 *       → Entity name <p> pattern changed in parseResults (asicInsolvency.js)
 *     • Scraper returns results but fixture name not in them
 *       → ACN/ABN lookup path returned a different entity, or nameMatchesEntity
 *         is too strict for the extracted name
 *
 * REQUIREMENTS
 *   Puppeteer (installed in server/node_modules) — used for both fixture discovery
 *   (Steps 1–2, via fetchWithBrowser) and the scraper itself (Step 3).
 *   The site uses Cloudflare bot protection; axios cannot retrieve content.
 *
 * USAGE
 *   node server/tests/test-asic-insolvency.js
 *   node server/tests/test-asic-insolvency.js --name "Acme Constructions Pty Ltd"
 *
 * EXIT CODE
 *   0 — fixture entity found by scraper
 *   1 — not found or error at any layer
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: HTTP error fetching ASIC Published Notices"
 *     → The site is down or the URL has changed; verify:
 *         https://publishednotices.asic.gov.au/browsesearch-notices
 *   "Step 1 FAIL: no div.article-block elements on initial page load"
 *     → The site returns an empty listing until a form POST is made, OR the
 *       div.article-block selector changed; run with --name to skip discovery
 *   "Step 2 FAIL: could not extract entity name from article blocks"
 *     → The <p> pattern for entity name inside div.article-block changed;
 *       check parseResults in server/scrapers/asicInsolvency.js
 *   "Step 3 FAIL: 0 results from scraper"
 *     → Puppeteer may be blocked by WAF/Cloudflare, or __doPostBack target
 *       changed, or the fieldId selector changed; check asicInsolvency.js
 *   "Step 4 FAIL: fixture not in results"
 *     → The scraper searched by company name but the notice uses a slightly
 *       different name; significant-word matching may be too strict, or the
 *       entity was only found via ACN and the title was different
 */

'use strict';

const path    = require('path');
const cheerio = require('cheerio');
const { searchAsicInsolvency } = require(path.join(__dirname, '../scrapers/asicInsolvency'));
const { fetchWithBrowser }     = require(path.join(__dirname, '../scrapers/browser'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

const BASE       = 'https://publishednotices.asic.gov.au';
const SEARCH_URL = `${BASE}/browsesearch-notices`;

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// ── Utilities ─────────────────────────────────────────────────────────────────

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function sigWords(name) {
  return normalise(name)
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/^(pty|ltd|limited|the|and|of|a|in|at|for|by|its)$/.test(w));
}

// Extract entity name from a div.article-block using the same logic as parseResults
// in server/scrapers/asicInsolvency.js: first non-empty <p> text.
function extractEntityFromBlock($block, $) {
  return $block.find('p').toArray()
    .map((el) => $(el).text().trim())
    .find((t) => t.length > 0) || null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('ASIC Published Notices — Insolvency / Winding-Up Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Load ASIC Published Notices page via Puppeteer (Cloudflare bypass) ──
  // The site uses Cloudflare bot protection — axios returns empty body.
  // fetchWithBrowser uses the same stealth Puppeteer instance as the scraper.
  step('Step 1: Loading ASIC Published Notices page via Puppeteer (allow ~30 s)...');
  step(`  URL: ${SEARCH_URL}`);

  let $page;
  let articleBlocks;

  try {
    const html = await fetchWithBrowser(SEARCH_URL);
    $page = cheerio.load(html);
    articleBlocks = $page('div.article-block');
    step(`  Page loaded (${html.length} bytes) — div.article-block elements: ${articleBlocks.length}`);
  } catch (e) {
    fail('Step 1',
      `Puppeteer failed to load ${SEARCH_URL}: ${e.message}\n` +
      'Possible causes:\n' +
      '  • publishednotices.asic.gov.au is down or URL has changed\n' +
      '  • Chromium could not launch (check PUPPETEER_HEADLESS and server/node_modules/puppeteer)\n' +
      '  • Cloudflare challenge did not clear within 15 s\n' +
      'If both test-asic-insolvency and test-ato-debt fail simultaneously, the ASIC\n' +
      'Published Notices site is likely down or has changed structure.');
    summary(0, 1);
    process.exit(1);
  }

  if (articleBlocks.length === 0 && !suppliedName) {
    fail('Step 1',
      'No div.article-block elements found after Puppeteer render.\n' +
      'Possible causes:\n' +
      '  • The page requires a form POST before listing notices (page arrived at initial empty state)\n' +
      '  • The div.article-block selector changed — check parseResults in asicInsolvency.js\n' +
      'Run with --name "Entity Name" to skip auto-discovery and test the scraper directly.');
    summary(0, 1);
    process.exit(1);
  }

  if (articleBlocks.length > 0) {
    pass('Step 1', `Site reachable — found ${articleBlocks.length} div.article-block element(s)`);
  } else {
    pass('Step 1', `Site reachable (Puppeteer); --name supplied, skipping article-block check`);
  }
  passed++;

  // ── Step 2: Extract entity name from first article block ──────────────────
  step('Step 2: Extracting entity name from first article block...');

  let fixtureName = suppliedName;

  if (!fixtureName) {
    for (let i = 0; i < articleBlocks.length; i++) {
      const $block = $page(articleBlocks.get(i));
      const name = extractEntityFromBlock($block, $page);
      if (name && name.length > 2) {
        fixtureName = name;
        const noticeType = $block.find('h3').text().replace(/\s+/g, ' ').trim();
        step(`  Extracted from block ${i + 1}: "${fixtureName}" (notice type: "${noticeType}")`);
        break;
      }
    }

    if (!fixtureName) {
      fail('Step 2',
        'Could not extract an entity name from any div.article-block <p> element.\n' +
        'The entity name pattern inside article blocks may have changed.\n' +
        'Check parseResults in server/scrapers/asicInsolvency.js — it reads the first\n' +
        'non-empty <p> inside each div.article-block.\n' +
        `URL used for discovery: ${usedUrl}\n` +
        'Run with --name "Entity Name" to skip auto-discovery.');
      failed++;
      summary(passed, failed);
      process.exit(1);
    }
  }

  pass('Step 2', `Test fixture: "${fixtureName}"`);
  passed++;

  // ── Step 3: Call searchAsicInsolvency (Puppeteer) ─────────────────────────
  step(`Step 3: Calling searchAsicInsolvency("${fixtureName}", "", "")...`);
  step('  (Puppeteer will load the ASIC Published Notices page and submit the form — allow ~60s)');

  let result;
  try {
    result = await searchAsicInsolvency(fixtureName, '', '');
  } catch (e) {
    fail('Step 3', `searchAsicInsolvency threw: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 3', 'scraper returned without throwing');
  step(`  Summary: "${result.summary}"`);
  step(`  Results count: ${result.results.length}`);
  step(`  Search URL: ${result.searchUrl}`);

  if (result.results.length > 0) {
    result.results.slice(0, 3).forEach((r, i) =>
      dump(`Result ${i + 1}`, {
        title: r.title,
        date: r.date,
        status: r.status,
        'metadata.Entity': r.metadata && r.metadata.Entity,
      }));
  }

  if (result.results.length === 0) {
    fail('Step 3',
      `Scraper returned 0 results for "${fixtureName}".\n` +
      'Possible causes:\n' +
      '  • Puppeteer/Chromium is being blocked by a WAF or Cloudflare challenge\n' +
      '  • The __doPostBack target ID changed in server/scrapers/asicInsolvency.js\n' +
      '    (check ContentPlaceHolderDefault...searchButton)\n' +
      '  • The form field selector (#ContentPlaceHolder...txtCompanyNameOrACN) changed\n' +
      '  • waitUntil:"networkidle2" timed out before results rendered\n' +
      '  • The entity may be in the archived notices only; check "Load older data" button\n' +
      `  URL: ${SEARCH_URL}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  passed++;

  // ── Step 4: Verify fixture name appears in results ────────────────────────
  step(`Step 4: Checking if "${fixtureName}" (or significant words) appears in results...`);

  const words = sigWords(fixtureName);
  step(`  Significant words (>3 chars, non-stopword): ${JSON.stringify(words)}`);

  const found = result.results.some((r) => {
    const text = normalise(
      (r.title || '') + ' ' +
      (r.description || '') + ' ' +
      (r.metadata && r.metadata.Entity ? r.metadata.Entity : '')
    );
    return words.length > 0 && words.every((w) => text.includes(w));
  });

  if (!found) {
    fail('Step 4',
      `"${fixtureName}" not found in scraper results.\n` +
      `Significant words matched against: ${JSON.stringify(words)}\n` +
      'This usually means the scraper searched by company name but ASIC stored a\n' +
      'slightly different trading name, or the ACN-based search returned a different\n' +
      'entity. Check result titles below:',
      result.results.map((r) => ({ title: r.title, entity: r.metadata && r.metadata.Entity })));
    failed++;
  } else {
    pass('Step 4', `"${fixtureName}" confirmed in scraper results`);
    passed++;
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
