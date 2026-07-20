/**
 * TEST: Modern Slavery Statements Register
 *
 * PURPOSE
 *   Verifies that searchModernSlavery() returns a result when given an entity
 *   name confirmed to appear in the Australian Modern Slavery Statements
 *   Register. The test self-discovers a live fixture by querying the register
 *   directly with a broad search term, then calls the full scraper with that
 *   fixture name and checks the result comes back.
 *
 *   Two-layer comparison isolates failures:
 *     • Raw page has results but scraper misses them
 *       → CSS selectors changed (a.search-results__item or child selectors
 *         in server/scrapers/modernSlavery.js)
 *     • Raw page has no results for the broad query
 *       → modernslaveryregister.gov.au is unreachable or returned no entries
 *     • Raw page has results but isEntityMatch filters out the fixture
 *       → The entity name extracted from the result DOM does not contain all
 *         words (>2 chars) of the fixture — or the fixture name itself is too
 *         generic (e.g. only stopwords)
 *
 * REQUIREMENTS
 *   No API keys or Puppeteer needed — axios + cheerio only.
 *
 * USAGE
 *   node server/tests/test-modern-slavery.js
 *   node server/tests/test-modern-slavery.js --name "Acme Holdings Pty Ltd"
 *
 * EXIT CODE
 *   0 — fixture entity found by scraper
 *   1 — not found or error at any layer
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: no statement entries found in raw HTML"
 *     → Site structure changed or the register is down; check that
 *       a.search-results__item is still the result anchor selector on
 *       https://modernslaveryregister.gov.au/statements/?q=limited
 *
 *   "Step 2 FAIL: could not extract a usable company name"
 *     → All top results have entity names that are either blank or composed
 *       entirely of stopwords/short words. Run with --name "Entity Name" after
 *       browsing the register manually.
 *
 *   "Step 3 FAIL: 0 results from scraper"
 *     → searchModernSlavery() returned no results despite the register having
 *       entries for the fixture. Most likely causes:
 *         1. The CSS selector for results changed (check a.search-results__item)
 *         2. isEntityMatch is filtering everything out (see Step 4 diagnostics)
 *         3. The request is being blocked or redirected
 *
 *   "Step 4 FAIL: fixture not in results"
 *     → nameMatchesEntity / isEntityMatch filtered out the fixture. The scraper
 *       requires every word of the search term longer than 2 chars to appear in
 *       the entity text returned by the register. Possible causes:
 *         - The fixture name contains words absent from the entity block text
 *           (e.g. the register stores "ABC Holdings" but we searched "ABC Holdings Limited")
 *         - The fixture name has too many short/common words; try --name with a
 *           more distinctive multi-word name from the register.
 */

'use strict';

const path    = require('path');
const axios   = require('axios');
const cheerio = require('cheerio');
const { searchModernSlavery } = require(path.join(__dirname, '../scrapers/modernSlavery'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

// Broad search term used to self-discover a fixture.
// "limited" appears in almost every large company name on the register and
// returns a populated first page without requiring a specific entity name.
const BROAD_QUERY = 'limited';
const REGISTER_SEARCH_URL = `https://modernslaveryregister.gov.au/statements/?q=${encodeURIComponent(BROAD_QUERY)}`;

// Words that do NOT count as "significant" for the nameMatchesEntity / isEntityMatch
// filter in modernSlavery.js (words <= 2 chars are already excluded by the scraper;
// these common words are excluded here so we can warn when a fixture name would
// pass the register search but still get filtered out).
const STOPWORDS = new Set(['pty', 'ltd', 'limited', 'the', 'and', 'of', 'a']);

// ── Parse CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// ── Utilities ──────────────────────────────────────────────────────────────────

/**
 * Return the "significant" words from a company name as understood by the
 * isEntityMatch() function in modernSlavery.js:
 *   - split on whitespace
 *   - keep words with length > 2  (the scraper uses > 2, not > 3)
 *
 * We additionally warn when a word is a common stopword, because even though
 * the scraper does not exclude them, a fixture whose only meaningful word is
 * "limited" would match almost anything.
 */
function significantWords(name) {
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Returns true if the name has at least one word longer than 3 chars that is
 * not a stopword — i.e. a word distinctive enough to be a useful fixture.
 */
function hasDistinctiveWord(name) {
  return name
    .toLowerCase()
    .split(/\s+/)
    .some((w) => w.length > 3 && !STOPWORDS.has(w));
}

// ── Main ───────────────────────────────────────────────────────────────────────

(async () => {
  header('Modern Slavery Statements Register — Integration Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Fetch register with broad query; confirm entries are returned ──

  step(`Step 1: Fetching register with broad query "${BROAD_QUERY}"...`);
  step(`  URL: ${REGISTER_SEARCH_URL}`);

  let rawEntities = []; // [{ entityText, entityName, href }]

  try {
    const { data } = await axios.get(REGISTER_SEARCH_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(data);

    // Each result is an <a class="search-results__item"> anchor.
    // This is the same selector used by the scraper — if it returns nothing
    // here, the site structure has changed.
    $('a.search-results__item').each((_, el) => {
      const href = $(el).attr('href') || '';
      // Full entity block text (includes entity name + ABN + period lines)
      const entityText = $(el).find('.search-results__item-entity').text().trim();
      // First child div is the entity name. Cheerio's .text() starts with a
      // leading newline and includes the "+ N more" badge text from the <em>
      // child. Normalize whitespace first, then strip the badge and ABN suffix.
      const rawName = $(el).find('.search-results__item-entity div').first().text();
      const entityName = rawName
        .replace(/\s+/g, ' ')
        .replace(/\s*\+\s*\d+\s*$/, '')
        .replace(/\s*\([0-9 ]+\)\s*$/, '')
        .trim();

      if (entityText) {
        rawEntities.push({ entityText, entityName: entityName || entityText, href });
      }
    });
  } catch (e) {
    fail('Step 1',
      `Request to modernslaveryregister.gov.au failed: ${e.message}\n` +
      'Check network connectivity or whether the register URL has changed.\n' +
      `  GET ${REGISTER_SEARCH_URL}`);
    summary(0, 1);
    process.exit(1);
  }

  if (rawEntities.length === 0) {
    fail('Step 1',
      'No statement entries found in raw HTML (selector: a.search-results__item).\n' +
      'The register may have changed its markup. Check:\n' +
      `  ${REGISTER_SEARCH_URL}\n` +
      'Update the selector if the page structure has changed.\n' +
      'Run with --name "Entity Name" to skip auto-discovery.');
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 1', `Register is reachable; found ${rawEntities.length} statement entry/entries on first page`);
  passed++;

  // ── Step 2: Extract a fixture company name from the raw entries ────────────

  step('Step 2: Selecting a fixture company name with at least one distinctive word...');

  let fixtureName = suppliedName || null;

  if (!fixtureName) {
    // Iterate through raw entries until we find one with a distinctive name.
    // "Distinctive" means at least one word >3 chars that is not a stopword,
    // so that the isEntityMatch filter in the scraper has something real to
    // match against.
    for (const entry of rawEntities) {
      const candidate = entry.entityName.trim();
      if (!candidate) continue;

      if (hasDistinctiveWord(candidate)) {
        fixtureName = candidate;
        dump('Selected fixture entry', { entityName: entry.entityName, href: entry.href });
        break;
      } else {
        warn(`  Skipping "${candidate}" — no distinctive words (all short or stopwords)`);
      }
    }
  }

  if (!fixtureName) {
    fail('Step 2',
      'Could not extract a usable company name from any register entry.\n' +
      'All entity names on the first page appear to be blank or composed\n' +
      'entirely of short/common words.\n' +
      'Run with --name "Entity Name" after browsing:\n' +
      `  ${REGISTER_SEARCH_URL}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  // Warn if the fixture name has borderline distinctiveness
  const sigWords = significantWords(fixtureName);
  const distinctWords = sigWords.filter((w) => w.length > 3 && !STOPWORDS.has(w));

  if (distinctWords.length === 0) {
    // This shouldn't happen given hasDistinctiveWord above, but guard anyway
    warn(`Fixture "${fixtureName}" has no words >3 chars outside stopwords.`);
    warn('The isEntityMatch filter in modernSlavery.js uses words.length > 2,');
    warn('so the scraper may still match — but the fixture is not very distinctive.');
    warn('Consider running with --name "A More Specific Company Name".');
  } else {
    step(`  Significant words (>2 chars) that isEntityMatch will require: ${JSON.stringify(sigWords)}`);
    if (distinctWords.length < sigWords.length) {
      warn(`  Some significant words are stopwords: ${JSON.stringify(sigWords.filter((w) => STOPWORDS.has(w)))}`);
      warn('  These will still be required by isEntityMatch — confirm they appear in the entity block text.');
    }
  }

  pass('Step 2', `Test fixture: "${fixtureName}"`);
  passed++;

  // ── Step 3: Call searchModernSlavery with the fixture name ─────────────────

  step(`Step 3: Calling searchModernSlavery("${fixtureName}", "")...`);

  let result;
  try {
    result = await searchModernSlavery(fixtureName, '');
  } catch (e) {
    fail('Step 3', `searchModernSlavery threw an exception: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  step(`  Summary: "${result.summary}"`);
  step(`  Results count: ${result.results.length}`);
  step(`  Search URL used: ${result.searchUrl}`);

  if (result.results.length > 0) {
    result.results.slice(0, 3).forEach((r, i) =>
      dump(`Result ${i + 1}`, { title: r.title, description: r.description, url: r.url }));
  } else {
    // Diagnose: re-fetch the register for the fixture name and check raw HTML
    step('  Diagnosing: re-fetching register directly for fixture name...');
    try {
      const diagUrl = `https://modernslaveryregister.gov.au/statements/?q=${encodeURIComponent(fixtureName)}`;
      const { data: diagHtml } = await axios.get(diagUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
        timeout: 15000,
      });

      const $diag = cheerio.load(diagHtml);
      const diagItems = [];
      $diag('a.search-results__item').each((_, el) => {
        const entityText = $diag(el).find('.search-results__item-entity').text().trim();
        if (entityText) diagItems.push(entityText);
      });

      if (diagItems.length > 0) {
        warn(`  Direct register search for "${fixtureName}" returned ${diagItems.length} raw item(s).`);
        warn('  The scraper is receiving results but isEntityMatch() is filtering them all out.');
        warn('  isEntityMatch requires every word >2 chars in the search name to appear in the entity text.');
        warn(`  Required words: ${JSON.stringify(sigWords)}`);
        warn('  First raw entity text(s):');
        diagItems.slice(0, 3).forEach((t) => warn(`    "${t}"`));
        warn('  Check whether the fixture name words all appear verbatim in the entity block above.');
        warn('  If not, the entity block uses an abbreviated or slightly different name.');
        warn('  Fix: run with --name using exactly the name as it appears in the register.');
      } else {
        warn(`  Direct register search for "${fixtureName}" also returned 0 raw items.`);
        warn('  The register may not index this name, or the search is case/format sensitive.');
        warn('  The scraper result (0) appears correct for this fixture.');
        warn(`  Browse manually: ${diagUrl}`);
      }
    } catch (diagErr) {
      warn(`  Diagnostic request failed: ${diagErr.message}`);
    }

    fail('Step 3',
      `searchModernSlavery("${fixtureName}") returned 0 results.\n` +
      'See diagnostic output above for likely cause.\n' +
      'If the scraper selector changed, update a.search-results__item in\n' +
      'server/scrapers/modernSlavery.js to match the current register markup.');
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 3', `Scraper returned ${result.results.length} result(s) without throwing`);
  passed++;

  // ── Step 4: Verify fixture name appears in at least one result ─────────────

  step(`Step 4: Checking that "${fixtureName}" (or its significant words) appears in a result...`);

  // The scraper's isEntityMatch already enforces that every word >2 chars of the
  // search name appears in the entity text before it is included in results[].
  // So any result in results[] already satisfies the word-match. We do the check
  // here independently on the title field to confirm the data flows through.
  function normalise(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const found = result.results.some((r) => {
    const text = normalise((r.title || '') + ' ' + (r.description || ''));
    // Require at least one significant word to appear (the scraper already
    // applied the full filter; this checks the data made it into the output shape)
    return sigWords.length > 0 && sigWords.some((w) => text.includes(w));
  });

  if (!found) {
    fail('Step 4',
      `None of the significant words from "${fixtureName}" appear in any result title/description.\n` +
      `Significant words checked: ${JSON.stringify(sigWords)}\n` +
      'This is unexpected since isEntityMatch() should have already ensured a match.\n' +
      'Possible cause: the scraper populates r.title from a different DOM element\n' +
      'than the one isEntityMatch checks (entityText vs entityName).\n' +
      'Check that .search-results__item-entity div (first child) text includes\n' +
      'the same words as the full .search-results__item-entity block text.\n' +
      'Result titles returned:',
      result.results.map((r) => r.title));
    failed++;
  } else {
    pass('Step 4',
      `At least one result contains significant words from "${fixtureName}" — ` +
      'data flows correctly through the scraper');
    passed++;
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
