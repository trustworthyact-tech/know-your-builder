/**
 * TEST: WA Building and Energy — Enforcement Media Releases
 *
 * PURPOSE
 *   Verifies that searchWABuildingEnergy() returns a result when given an entity
 *   name confirmed to appear in a WA Building and Energy enforcement media
 *   release. The test self-discovers a fixture by fetching the media releases
 *   page directly with axios, then calls the full scraper and checks the same
 *   entity comes back.
 *
 *   Two-layer comparison isolates failures:
 *     • Raw page has enforcement articles but scraper misses them
 *       → CSS selectors changed (parseResults in waBuildingEnergy.js)
 *     • Raw page has no enforcement articles
 *       → WA B&E changed site structure or no current enforcement releases
 *     • Raw page has article but nameMatchesEntity filters it out
 *       → Entity name extracted from title has words not present in the article
 *         text, or the significant-word filter is too strict
 *
 * REQUIREMENTS
 *   No API keys or Puppeteer needed — axios only.
 *
 * USAGE
 *   node server/tests/test-wa-building.js
 *   node server/tests/test-wa-building.js --name "John Smith"
 *
 * EXIT CODE
 *   0 — fixture entity found by scraper
 *   1 — not found or error at any layer
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: no enforcement articles found in raw HTML"
 *     → Site structure or CSS selectors changed; check article/li selectors
 *       in parseResults inside server/scrapers/waBuildingEnergy.js
 *   "Step 2 FAIL: could not extract entity name from title"
 *     → Title pattern changed; update the name-extraction regex below
 *   "Step 3 FAIL: 0 results from scraper"
 *     → The selector that worked for Step 1 (axios) is not the one the scraper
 *       tries first; check the selector priority in parseResults
 *   "Step 4 FAIL: fixture not in results"
 *     → nameMatchesEntity is filtering out the entity; check which significant
 *       words (>3 chars, non-stopword) appear in the article text vs the name
 */

'use strict';

const path    = require('path');
const axios   = require('axios');
const { searchWABuildingEnergy } = require(path.join(__dirname, '../scrapers/waBuildingEnergy'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

// buildingandenergywa.gov.au is defunct — content moved to wa.gov.au.
// Enforcement announcements are indexed in the wa.gov.au Elastic cluster;
// public read credentials are embedded in every wa.gov.au page.
const ELASTIC_HOST = 'https://wa-gov-au-syd-v8-prd.es.ap-southeast-2.aws.found.io:443';
const ELASTIC_INDEX = 'production-wagov-blue-pipeline-cms-search-alias';
const ELASTIC_AUTH = { username: 'client', password: '43674c65465000' };
const ELASTIC_SEARCH_URL = `${ELASTIC_HOST}/${ELASTIC_INDEX}/_search`;
const WA_BE_COLLECTION_URL = 'https://www.wa.gov.au/government/document-collections/disciplinary-and-prosecution-media-releases-builders';

const ENFORCEMENT_KEYWORDS = ['prosecut', 'penalt', 'fine', 'suspend', 'cancel', 'prohibit',
  'unlicensed', 'unregistered', 'illegal', 'offence', 'conviction', 'court', 'tribunal',
  'order', 'disciplin', 'caution', 'infringement'];

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// ── Utilities ─────────────────────────────────────────────────────────────────

function isEnforcementText(text) {
  const lower = text.toLowerCase();
  return ENFORCEMENT_KEYWORDS.some((k) => lower.includes(k));
}

// Attempt to extract a person or company name from a WA B&E media release title.
// Common patterns:
//   "Builder fined $X000 for ..."                → generic, no extractable proper name
//   "Perth builder convicted for ..."             → generic
//   "John Smith fined $X000 for unlicensed work" → "John Smith" (capitalised words at start)
//   "ABC Building Pty Ltd ordered to ..."         → "ABC Building Pty Ltd"
//   "Man/Woman/Tradesperson/Builder prosecuted"   → generic, skip
function extractEntityName(title) {
  // Look for capitalised multi-word sequences not starting with generic role nouns
  const genericRoles = /^(a |the |man |woman |builder |tradesperson |tradesman |contractor |company |person |plumber |electrician |owner |operator )/i;

  // Pattern 1: "Firstname Lastname <verb>"
  const m1 = title.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(fined|prosecuted|ordered|convicted|banned|disqualified|suspended|charged)/);
  if (m1 && !genericRoles.test(m1[1] + ' ')) return m1[1];

  // Pattern 2: Company name before "Pty Ltd" or "Pty. Ltd."
  const m2 = title.match(/([A-Z][A-Za-z&'\s]+ (?:Pty\.?\s*Ltd\.?|Pty))/);
  if (m2) return m2[1].trim();

  // Pattern 3: Quoted name
  const m3 = title.match(/["'"]([^"'"]{3,40})["'""]/);
  if (m3) return m3[1].trim();

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('WA Building and Energy — Enforcement Media Releases Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Discover fixture via wa.gov.au Elastic API ────────────────────
  step('Step 1: Querying WA B&E enforcement articles via Elastic API...');

  let enforcementItems = [];

  try {
    const { data } = await axios.post(ELASTIC_SEARCH_URL, {
      query: {
        bool: {
          filter: [
            { term: { content_type: 'announcement_content' } },
            { match: { field_provider_title: 'Building and Energy' } },
          ],
        },
      },
      sort: [{ field_published_date: { order: 'desc' } }],
      size: 20,
      _source: ['title', 'url', 'field_published_date', 'field_description'],
    }, {
      auth: ELASTIC_AUTH,
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000,
    });

    const hits = (data.hits && data.hits.hits) || [];
    for (const hit of hits) {
      const src = hit._source || {};
      const title = Array.isArray(src.title) ? src.title[0] : (src.title || '');
      const description = Array.isArray(src.field_description)
        ? src.field_description[0]
        : (src.field_description || '');
      if (title && isEnforcementText(title)) {
        enforcementItems.push({ title, text: `${title} ${description}` });
      }
    }

    if (enforcementItems.length > 0) {
      step(`  Found ${enforcementItems.length} enforcement article(s) from Elastic API`);
    }
  } catch (e) {
    warn(`  Elastic API request failed: ${e.message}`);
  }

  if (enforcementItems.length === 0) {
    fail('Step 1',
      'No enforcement articles found via Elastic API.\n' +
      'Check if the wa.gov.au Elastic endpoint is still accessible:\n' +
      `  POST ${ELASTIC_SEARCH_URL}\n` +
      `Or browse: ${WA_BE_COLLECTION_URL}\n` +
      'Or run with --name "Entity Name" to skip fixture discovery.');
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 1', `Found ${enforcementItems.length} enforcement article(s) in WA B&E Elastic index`);
  passed++;

  // ── Step 2: Extract entity name from first enforcement article ─────────────
  step('Step 2: Extracting entity name from first enforcement article...');

  let fixtureName = suppliedName;
  let fixtureTitle = null;

  if (!fixtureName) {
    for (const item of enforcementItems) {
      const extracted = extractEntityName(item.title);
      if (extracted) {
        fixtureName = extracted;
        fixtureTitle = item.title;
        break;
      }
    }
  }

  if (!fixtureName) {
    // Fall back: use the first article title directly as the search term
    fixtureTitle = enforcementItems[0].title;
    // Use the first 2+ capitalised words from the title as a proxy name
    const capWords = fixtureTitle.match(/\b[A-Z][a-z]{2,}/g);
    if (capWords && capWords.length >= 2) {
      fixtureName = capWords.slice(0, 2).join(' ');
      warn(`Could not extract a clean entity name — using capitalized words: "${fixtureName}"`);
    } else {
      fail('Step 2',
        'Could not extract any entity name from enforcement article titles.\n' +
        'Re-run with --name "Entity Name" after checking:\n' +
        `  ${usedUrl}\n` +
        'Article titles found:',
        enforcementItems.slice(0, 5).map((i) => i.title));
      failed++;
      summary(passed, failed);
      process.exit(1);
    }
  }

  pass('Step 2', `Test fixture: "${fixtureName}"${fixtureTitle ? ` (from: "${fixtureTitle}")` : ''}`);
  passed++;

  // ── Step 3: Call searchWABuildingEnergy ────────────────────────────────────
  step(`Step 3: Calling searchWABuildingEnergy("${fixtureName}", "", [])...`);

  let result;
  try {
    result = await searchWABuildingEnergy(fixtureName, '', []);
  } catch (e) {
    fail('Step 3', `searchWABuildingEnergy threw: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 3', 'scraper returned without throwing');
  step(`  Summary: "${result.summary}"`);
  step(`  Results count: ${result.results.length}`);

  if (result.results.length > 0) {
    result.results.slice(0, 3).forEach((r, i) =>
      dump(`Result ${i + 1}`, { title: r.title, date: r.date, url: r.url }));
  }

  if (result.results.length === 0) {
    // Diagnose: query Elastic directly for the fixture name
    step('  Diagnosing: querying Elastic directly for the fixture name...');
    try {
      const { data: diagData } = await axios.post(ELASTIC_SEARCH_URL, {
        query: {
          bool: {
            must: [{ multi_match: { query: fixtureName, fields: ['title', 'body', 'field_description'], type: 'phrase' } }],
            filter: [
              { term: { content_type: 'announcement_content' } },
              { match: { field_provider_title: 'Building and Energy' } },
            ],
          },
        },
        size: 5,
        _source: ['title'],
      }, { auth: ELASTIC_AUTH, headers: { 'Content-Type': 'application/json' }, timeout: 20000 });

      const diagCount = ((diagData.hits && diagData.hits.hits) || []).length;
      step(`  Direct Elastic search for "${fixtureName}" returned ${diagCount} result(s)`);
      if (diagCount > 0) {
        warn('  Elastic has results but scraper returned none.');
        warn('  Check the nameMatchesEntity filter in server/scrapers/waBuildingEnergy.js:');
        warn('  It requires ALL significant words (>3 chars, non-stopword) to appear in article text.');
        warn(`  Significant words from "${fixtureName}":`,
          fixtureName.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !/^(pty|ltd|limited|the|and|of|a)$/.test(w)));
      } else {
        warn(`  Elastic also found nothing for "${fixtureName}" — the scraper result is correct.`);
        warn('  The extracted fixture name may not match exactly what is in the article text.');
        warn(`  Browse: ${WA_BE_COLLECTION_URL}`);
      }
    } catch (e) {
      warn(`  Diagnostic Elastic query failed: ${e.message}`);
    }

    fail('Step 3', '0 results returned by scraper');
    failed++;
    summary(passed, failed);
    process.exit(1);
  }
  passed++;

  // ── Step 4: Verify fixture name appears in results ─────────────────────────
  step(`Step 4: Checking if "${fixtureName}" appears in results...`);

  function normalise(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(); }
  const sigWords = normalise(fixtureName).split(/\s+/).filter((w) => w.length > 3 && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));

  const found = result.results.some((r) => {
    const text = normalise(r.title + ' ' + (r.description || ''));
    return sigWords.length > 0 && sigWords.every((w) => text.includes(w));
  });

  if (!found) {
    fail('Step 4',
      `"${fixtureName}" not found in scraper results.\n` +
      `Significant words matched: ${JSON.stringify(sigWords)}\n` +
      'Result titles returned:',
      result.results.map((r) => r.title));
    failed++;
  } else {
    pass('Step 4', `"${fixtureName}" confirmed in scraper results`);
    passed++;
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
