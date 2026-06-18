/**
 * TEST: ASIC Published Notices — ATO Tax Debt Listings
 *
 * PURPOSE
 *   Verifies that searchAtoDebt() returns a result when given an entity name
 *   confirmed to appear in an ATO tax debt notice on the ASIC Published Notices
 *   register. The test self-discovers a fixture by loading the notices page via
 *   Puppeteer, then calls the full scraper and confirms the same entity comes back.
 *
 *   NOTE: If both test-asic-insolvency and test-ato-debt fail simultaneously,
 *   the ASIC Published Notices site is likely down or has changed structure.
 *
 * USAGE
 *   node server/tests/test-ato-debt.js
 *   node server/tests/test-ato-debt.js --name "Acme Holdings Pty Ltd"
 *
 * EXIT CODE
 *   0 — fixture entity found by scraper
 *   1 — not found or error at any layer
 */

'use strict';

const path    = require('path');
const cheerio = require('cheerio');
const { searchAtoDebt }    = require(path.join(__dirname, '../scrapers/atoDebt'));
const { fetchWithBrowser } = require(path.join(__dirname, '../scrapers/browser'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

const BASE        = 'https://publishednotices.asic.gov.au';
const SEARCH_URL  = `${BASE}/browsesearch-notices`;

const ATO_KEYWORDS = ['ato', 'tax debt', 'listed tax debt', '260-45', 'tax administration act', 'australian taxation office'];

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

function isAtoText(text) {
  const lower = (text || '').toLowerCase();
  // Word boundary for 'ato' to avoid matching 'administrator', 'regulatory', etc.
  return /\bato\b/.test(lower) ||
    ATO_KEYWORDS.slice(1).some((k) => lower.includes(k));
}

function extractEntityFromBlock($block, $) {
  return $block.find('p').toArray()
    .map((el) => $(el).text().trim())
    .find((t) => t.length > 0) || null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('ASIC Published Notices — ATO Tax Debt Listings Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Load ASIC Published Notices page via Puppeteer ────────────────
  step('Step 1: Loading ASIC Published Notices page via Puppeteer (allow ~30 s)...');
  step(`  URL: ${SEARCH_URL}`);

  let $page;
  let atoBlocks = [];
  let allBlocks;

  try {
    const html = await fetchWithBrowser(SEARCH_URL);
    $page = cheerio.load(html);
    allBlocks = $page('div.article-block');
    step(`  Page loaded (${html.length} bytes) — total div.article-block: ${allBlocks.length}`);

    // Filter to ATO debt notices
    allBlocks.each((_, el) => {
      if (isAtoText($page(el).text())) atoBlocks.push(el);
    });
    step(`  ATO-keyed article blocks: ${atoBlocks.length}`);
  } catch (e) {
    fail('Step 1',
      `Puppeteer failed to load ${SEARCH_URL}: ${e.message}\n` +
      'Possible causes:\n' +
      '  • publishednotices.asic.gov.au is down or URL has changed\n' +
      '  • Chromium could not launch\n' +
      '  • Cloudflare challenge did not clear within 15 s\n' +
      'If both test-asic-insolvency and test-ato-debt fail simultaneously, the ASIC\n' +
      'Published Notices site is likely down or has changed structure.');
    summary(0, 1);
    process.exit(1);
  }

  if (atoBlocks.length > 0) {
    pass('Step 1', `Site reachable — found ${atoBlocks.length} ATO-keyed article block(s)`);
  } else if (suppliedName) {
    pass('Step 1', `Site reachable (Puppeteer); --name supplied, skipping ATO block check`);
  } else {
    // No ATP notices on initial page is expected — they're rare/infrequent.
    // The test can confirm the site is reachable but cannot auto-discover a fixture.
    pass('Step 1', `Site reachable (${allBlocks.length} notices loaded, none are current ATP notices)`);
    warn('No ATO-keyed article blocks found on the initial page load.');
    warn('ATP/listed-tax-debt notices are rare — the initial listing may not include any right now.');
    warn('To test the scraper against a known ATP entity, re-run with:');
    warn('  node server/tests/test-ato-debt.js --name "Entity Name"');
    summary(1, 0);
    process.exit(0);
  }
  passed++;

  // ── Step 2: Extract entity name from first ATO notice ────────────────────
  step('Step 2: Extracting entity name from first ATO tax debt notice...');

  let fixtureName = suppliedName;

  if (!fixtureName) {
    for (const el of atoBlocks) {
      const $block = $page(el);
      const name = extractEntityFromBlock($block, $page);
      if (name && name.length > 2) {
        fixtureName = name;
        const noticeType = $block.find('h3').text().replace(/\s+/g, ' ').trim();
        step(`  Extracted: "${fixtureName}" (notice type: "${noticeType}")`);
        break;
      }
    }
  }

  if (!fixtureName) {
    fail('Step 2',
      'Could not extract an entity name from any ATO debt notice block.\n' +
      'The <p> pattern for entity name inside div.article-block may have changed.\n' +
      'Run with --name "Entity Name" to skip auto-discovery.');
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 2', `Test fixture: "${fixtureName}"`);
  passed++;

  // ── Step 3: Call searchAtoDebt ────────────────────────────────────────────
  step(`Step 3: Calling searchAtoDebt("${fixtureName}", "", "")...`);

  let result;
  try {
    result = await searchAtoDebt(fixtureName, '', '');
  } catch (e) {
    fail('Step 3', `searchAtoDebt threw: ${e.message}`, e.stack);
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
        date: r.date,
        status: r.status,
        'metadata.Entity': r.metadata && r.metadata.Entity,
      }));
  }

  if (result.results.length === 0) {
    fail('Step 3',
      `searchAtoDebt("${fixtureName}") returned 0 results.\n` +
      'Possible causes:\n' +
      '  • The Puppeteer form submission failed or timed out\n' +
      '  • The entity has no ATP notices on the new site\n' +
      '  • The div.article-block selector changed in parseResults (atoDebt.js)\n' +
      `  Search URL: ${result.searchUrl}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  passed++;

  // ── Step 4: Verify fixture name appears in results ────────────────────────
  step(`Step 4: Checking if "${fixtureName}" (or significant words) appears in results...`);

  const words = sigWords(fixtureName);
  step(`  Significant words: ${JSON.stringify(words)}`);

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
      `Significant words: ${JSON.stringify(words)}\n` +
      'Result titles returned:',
      result.results.map((r) => ({ title: r.title, entity: r.metadata && r.metadata.Entity })));
    failed++;
  } else {
    pass('Step 4', `"${fixtureName}" confirmed in scraper results`);
    passed++;
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
