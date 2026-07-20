/**
 * TEST: Fair Work Ombudsman — Newsroom Enforcement Outcomes
 *
 * PURPOSE
 *   Verifies that searchFWO() returns a result when given an entity name
 *   confirmed to appear in a FWO newsroom enforcement article. The test
 *   self-discovers a fixture by fetching the newsroom list page directly
 *   with axios (broad/empty keyword search), then calls the full scraper
 *   and checks the same entity comes back.
 *
 *   Four-layer comparison isolates failures:
 *     • Step 1: Newsroom page is reachable and contains article listings
 *       → If this fails, FWO changed their site structure
 *     • Step 2: First enforcement article has an extractable employer name
 *       → If this fails, heading/body patterns need updating
 *     • Step 3: scraper returns >= 1 result for that fixture name
 *       → If this fails, CSS selectors changed or nameMatchesEntity is too strict
 *     • Step 4: fixture name (significant words) appears in >= 1 result
 *       → If this fails, nameMatchesEntity is filtering it out
 *
 * REQUIREMENTS
 *   No API keys or Puppeteer — axios + cheerio only.
 *
 * USAGE
 *   node server/tests/test-fwo.js
 *   node server/tests/test-fwo.js --name "Acme Pty Ltd"
 *
 * EXIT CODE
 *   0 — fixture entity found by scraper
 *   1 — not found or error at any layer
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: page not reachable or no article elements found"
 *     → FWO changed their news structure; check the article selectors below
 *       and in server/scrapers/fwo.js parseNewsItems()
 *   "Step 2 FAIL: no enforcement articles found"
 *     → FWO newsroom has no current enforcement content matching keywords,
 *       or the article text selectors changed
 *   "Step 3 FAIL: 0 results from scraper"
 *     → scraper CSS selectors changed or nameMatchesEntity is too strict;
 *       compare which selector worked in Step 1 vs what parseNewsItems tries
 *   "Step 4 FAIL: fixture not in results"
 *     → nameMatchesEntity is filtering out the entity; check which significant
 *       words (>3 chars, non-stopword) appear in the article text vs the name
 */

'use strict';

const path    = require('path');
const axios   = require('axios');
const cheerio = require('cheerio');
const { searchFWO } = require(path.join(__dirname, '../scrapers/fwo'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

// The FWO newsroom search endpoint — empty keys returns the full recent feed
const FWO_BASE      = 'https://www.fairwork.gov.au';
const FWO_NEWS_URL  = `${FWO_BASE}/newsroom/news-and-media-search?keys=`;

// Same headers the scraper uses
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: 'https://www.fairwork.gov.au/',
};

// Enforcement keywords (superset of the scraper's list for broad discovery)
const ENFORCEMENT_KEYWORDS = [
  'penalty', 'penalised', 'penalized',
  'court', 'underpaid', 'underpayment',
  'back pay', 'backpay', 'back-pay',
  'contravent', 'fine', 'prosecution',
  'ordered to pay', 'enforceable undertaking',
  'infringement notice', 'injunction',
];

// Stopwords used by the scraper's nameMatchesEntity()
const STOPWORDS = /^(pty|ltd|limited|the|and|of|a)$/;

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// ── Utilities ─────────────────────────────────────────────────────────────────

function isEnforcementText(text) {
  const lower = (text || '').toLowerCase();
  return ENFORCEMENT_KEYWORDS.some((k) => lower.includes(k));
}

function sigWords(name) {
  return (name || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.test(w));
}

// Attempt to extract an employer / company name from an FWO article heading.
// Common FWO title patterns:
//   "Acme Pty Ltd ordered to pay $X in penalties"     → "Acme Pty Ltd"
//   "John Smith penalised for underpaying workers"     → "John Smith"
//   "Franchisee fined for record-keeping failures"     → generic (skip)
//   "Fair Work Ombudsman takes court action against Acme Group" → "Acme Group"
function extractEntityName(title) {
  // Pattern 1: "X Pty Ltd" or "X Pty. Ltd."
  const m1 = title.match(/([A-Z][A-Za-z0-9&'\s-]+ (?:Pty\.?\s*Ltd\.?|Pty))/);
  if (m1) return m1[1].trim();

  // Pattern 2: "against <Name>" at the end of the title
  const m2 = title.match(/\bagainst\s+([A-Z][A-Za-z\s&'-]{3,40})(?:\s+(?:in|for|over|at|on)|\s*$)/);
  if (m2) return m2[1].trim();

  // Pattern 3: Capitalised multi-word sequence at the start followed by a verb
  const genericRoles = /^(a |the |an |one |two |three |man |woman |employer |operator |company |business |franchisee |contractor |worker |director )/i;
  const m3 = title.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:ordered|penali[sz]ed|fined|prosecuted|convicted|banned|suspended|required|agrees?)/);
  if (m3 && !genericRoles.test(m3[1] + ' ')) return m3[1].trim();

  // Pattern 4: Quoted name
  const m4 = title.match(/["'"]([^"'"]{3,50})["'""]/);
  if (m4) return m4[1].trim();

  // Pattern 5: single- or multi-word entity name (digits/ampersands/"of"/"for"/"and" joiners
  // allowed) directly followed by an enforcement verb, e.g. "Yooralla signs Enforceable
  // Undertaking", "G8 Education faces court over...", "The University of NSW signs..."
  const m5 = title.match(
    /^((?:The\s+)?[A-Z][A-Za-z0-9&'-]*(?:\s+(?:of|for|and)\s+[A-Z][A-Za-z0-9&'-]*|\s+[A-Z][A-Za-z0-9&'-]*)*)\s+(?:signs?|faces?|agrees?|enters?|reaches?|penali[sz]ed|fined|ordered|prosecuted|convicted|banned|suspended|required|sued|takes?|found)\b/
  );
  if (m5 && !genericRoles.test(m5[1] + ' ')) return m5[1].trim();

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('Fair Work Ombudsman — Newsroom Enforcement Outcomes Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Fetch FWO newsroom list and confirm article elements exist ─────
  step('Step 1: Fetching FWO newsroom list page and checking for article listings...');

  let rawHtml;
  let $page;

  try {
    const { data } = await axios.get(FWO_NEWS_URL, {
      headers: HEADERS,
      timeout: 15000,
      maxRedirects: 5,
    });
    rawHtml = data;
    $page = cheerio.load(rawHtml);
  } catch (e) {
    fail('Step 1',
      `Could not fetch FWO newsroom: ${e.message}\n` +
      `URL: ${FWO_NEWS_URL}\n` +
      'Check network connectivity or whether fairwork.gov.au is accessible.');
    summary(0, 1);
    process.exit(1);
  }

  // Try the same selectors the scraper uses (primary first)
  const ARTICLE_SELECTORS = [
    'ol.searchResultsInfo li.media',
    'li.media',
    'article',
    '.news-item',
    '.search-result-item',
    '.listing-item',
    '.module-content li',
    '[class*="news-list"] li',
    'li.result',
    '.views-row',
  ];

  let workingSelector = null;
  let articleCount = 0;
  for (const sel of ARTICLE_SELECTORS) {
    const n = $page(sel).length;
    if (n > 0) {
      workingSelector = sel;
      articleCount = n;
      break;
    }
  }

  if (!workingSelector) {
    fail('Step 1',
      'No article elements found on the FWO newsroom page using any known selector.\n' +
      `URL: ${FWO_NEWS_URL}\n` +
      'FWO may have changed their news listing structure.\n' +
      'Selectors tried: ' + ARTICLE_SELECTORS.join(', ') + '\n' +
      'Run with --name "Entity Name" to skip fixture discovery.');
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 1', `Newsroom page reachable; ${articleCount} article element(s) found via selector "${workingSelector}"`);
  passed++;

  // ── Step 2: Find first enforcement article and extract employer name ────────
  step('Step 2: Scanning articles for enforcement content and extracting employer name...');

  let fixtureName = suppliedName;
  let fixtureTitle = null;
  let fixtureText = null;

  if (!fixtureName) {
    $page(workingSelector).each((_, el) => {
      if (fixtureName) return; // already found one

      const $el = $page(el);
      const text = $el.text();

      if (!isEnforcementText(text)) return;

      // Try to extract a name from the heading
      // New structure: .search-highlight a holds the title
      // Legacy structure: h2/h3/h4 or first anchor
      const headingText =
        $el.find('.search-highlight a').first().text().trim() ||
        $el.find('h2, h3, h4, .title, .heading').first().text().trim() ||
        $el.find('a').first().text().trim();

      const extracted = headingText ? extractEntityName(headingText) : null;

      if (extracted) {
        const words = sigWords(extracted);
        if (words.length === 0) return; // no usable significant words
        // Pre-check: at least one significant word must appear in the article text
        // (mirrors nameMatchesEntity pre-condition)
        const lower = text.toLowerCase();
        if (!words.every((w) => lower.includes(w))) return;

        fixtureName  = extracted;
        fixtureTitle = headingText;
        fixtureText  = text;
      }
    });
  }

  if (!fixtureName) {
    // Softer fallback: pick the first enforcement article and pull capitalised words
    let fallbackText = null;
    let fallbackHeading = null;
    $page(workingSelector).each((_, el) => {
      if (fallbackHeading) return;
      const $el = $page(el);
      const text = $el.text();
      if (!isEnforcementText(text)) return;
      fallbackHeading = $el.find('.search-highlight a').first().text().trim() ||
                        $el.find('h2, h3, h4, .title, .heading').first().text().trim() ||
                        $el.find('a').first().text().trim() || text.slice(0, 120);
      fallbackText = text;
    });

    if (fallbackHeading) {
      const capWords = fallbackHeading.match(/\b[A-Z][a-z]{2,}/g) || [];
      const candidates = capWords.filter((w) => !STOPWORDS.test(w.toLowerCase()) && w.length > 3);
      if (candidates.length >= 2) {
        fixtureName  = candidates.slice(0, 2).join(' ');
        fixtureTitle = fallbackHeading;
        fixtureText  = fallbackText;
        warn(`Could not extract a clean entity name — using capitalised words as proxy: "${fixtureName}"`);
      }
    }
  }

  if (!fixtureName) {
    fail('Step 2',
      'No enforcement articles found on the FWO newsroom page, or none with an extractable employer name.\n' +
      'Possible reasons:\n' +
      '  • FWO newsroom currently has no enforcement/penalty content\n' +
      '  • Article headings no longer match known name patterns\n' +
      `Browse: ${FWO_NEWS_URL}\n` +
      'Re-run with --name "Employer Name" to skip auto-discovery.');
    summary(passed, 1);
    process.exit(1);
  }

  const words = sigWords(fixtureName);
  if (words.length === 0) {
    fail('Step 2',
      `Extracted name "${fixtureName}" has no significant words (>3 chars, non-stopword).\n` +
      'nameMatchesEntity will always return false for this name.\n' +
      'Re-run with --name "Entity Name" to supply a better fixture.');
    summary(passed, 1);
    process.exit(1);
  }

  pass('Step 2',
    `Test fixture: "${fixtureName}"${fixtureTitle ? ` (from heading: "${fixtureTitle}")` : ''}\n` +
    `     Significant words: ${JSON.stringify(words)}`);
  passed++;

  // ── Step 3: Call searchFWO and assert >= 1 result ─────────────────────────
  step(`Step 3: Calling searchFWO("${fixtureName}", "", [])...`);

  let result;
  try {
    result = await searchFWO(fixtureName, '', []);
  } catch (e) {
    fail('Step 3', `searchFWO threw an exception: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  step(`  Summary: "${result.summary}"`);
  step(`  Results count: ${result.results.length}`);

  if (result.results.length > 0) {
    result.results.slice(0, 3).forEach((r, i) =>
      dump(`Result ${i + 1}`, { title: r.title, date: r.date, url: r.url }));
  }

  if (result.results.length === 0) {
    // Diagnostic: try a direct axios fetch for the fixture name to see if the
    // page itself has results that the scraper is missing
    step('  Diagnosing: fetching FWO newsroom directly for the fixture name...');
    try {
      const diagUrl = `${FWO_BASE}/newsroom/news-and-media-search?keys=${encodeURIComponent(fixtureName)}`;
      const { data: diagHtml } = await axios.get(diagUrl, { headers: HEADERS, timeout: 15000, maxRedirects: 5 });
      const $diag = cheerio.load(diagHtml);
      let diagCount = 0;
      for (const sel of ARTICLE_SELECTORS) {
        const n = $diag(sel).length;
        if (n > 0) { diagCount = n; break; }
      }
      step(`  Direct page fetch for "${fixtureName}" found ${diagCount} article element(s)`);
      if (diagCount > 0) {
        warn('  The FWO newsroom page has articles for this name but the scraper returned none.');
        warn('  Check whether isEnforcementOutcome() or nameMatchesEntity() is filtering them out.');
        warn(`  Significant words the scraper will require: ${JSON.stringify(words)}`);
        if (fixtureText) {
          const lower = fixtureText.toLowerCase();
          const missing = words.filter((w) => !lower.includes(w));
          if (missing.length > 0) {
            warn(`  Words NOT found in original article text: ${JSON.stringify(missing)}`);
            warn('  nameMatchesEntity will reject the article because of these missing words.');
          }
        }
      } else {
        warn(`  Direct page fetch also returned no articles for "${fixtureName}".`);
        warn('  The extracted fixture name may not match FWO search index terms exactly.');
        warn(`  Browse: ${FWO_BASE}/newsroom/news-and-media-search?keys=${encodeURIComponent(fixtureName)}`);
      }
    } catch (e) {
      warn(`  Diagnostic fetch failed: ${e.message}`);
    }

    fail('Step 3',
      '0 results returned by searchFWO.\n' +
      `Fixture: "${fixtureName}"\n` +
      'Possible causes:\n' +
      '  • CSS selectors in parseNewsItems() no longer match FWO article markup\n' +
      '  • isEnforcementOutcome() does not match keywords in current articles\n' +
      '  • nameMatchesEntity() significant-word check is too strict for this name');
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 3', `searchFWO returned ${result.results.length} result(s)`);
  passed++;

  // ── Step 4: Verify fixture significant words appear in >= 1 result ─────────
  step(`Step 4: Checking that significant words of "${fixtureName}" appear in at least one result...`);

  function normalise(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(); }

  const foundInResult = result.results.some((r) => {
    const text = normalise(r.title + ' ' + (r.description || ''));
    return words.every((w) => text.includes(w));
  });

  if (!foundInResult) {
    fail('Step 4',
      `Fixture "${fixtureName}" not confirmed in any scraper result.\n` +
      `Significant words required: ${JSON.stringify(words)}\n` +
      'Result titles returned:',
      result.results.map((r) => r.title));
    warn('Hint: nameMatchesEntity in fwo.js requires ALL significant words (>3 chars, non-stopword)');
    warn('to appear in the full article text. If the name has words absent from the article,');
    warn('the result will be included but the title check here may differ from what the scraper sees.');
    failed++;
  } else {
    pass('Step 4', `"${fixtureName}" confirmed in scraper results (significant words match)`);
    passed++;
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
