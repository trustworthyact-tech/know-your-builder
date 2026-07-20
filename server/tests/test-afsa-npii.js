/**
 * TEST: AFSA — National Personal Insolvency Index (NPII)
 *
 * DEEP-CHECK ONLY — Do not add to run-all.sh. Run manually:
 *   node server/tests/test-afsa-npii.js
 *   node server/tests/test-afsa-npii.js --name "John Smith"
 *
 * PURPOSE
 *   Verifies that searchAfsaNpii() returns a result when given a director name
 *   confirmed to appear in the AFSA NPII register. The test self-discovers a
 *   fixture by performing a broad GET request to the NPII search page and
 *   a POST with an empty/wildcard surname, then calls the full scraper and
 *   checks the same person comes back.
 *
 *   Four-step isolation pattern:
 *     Step 1 — Raw page reachable and form session tokens obtainable
 *     Step 2 — Broad POST returns at least one insolvency entry; name extracted
 *     Step 3 — searchAfsaNpii() called with fixture name; results.length >= 1
 *     Step 4 — Fixture surname appears in at least one result title
 *
 * FAILURE MODES
 *   "Step 1 FAIL: could not load NPII search page"
 *     → npii.afsa.gov.au is unreachable, or has changed its URL/TLS config.
 *       Check: curl -I https://npii.afsa.gov.au/search.xhtml
 *   "Step 1 FAIL: no ViewState token found in page"
 *     → AFSA has removed or renamed the JSF ViewState input.
 *       Check the HTML source for javax.faces.ViewState in afsaNpii.js.
 *   "Step 2 FAIL: broad POST returned no table rows"
 *     → The form field names or search parameters have changed.
 *       Check searchForm:* field names in afsaNpii.js against the live form.
 *       Or the broad search (single-letter surname) returned no live records.
 *   "Step 2 FAIL: could not extract a surname from any row"
 *     → Table column layout has changed; update column parsing in afsaNpii.js.
 *   "Step 3 FAIL: scraper threw or returned no results"
 *     → The JSF two-step flow (GET viewState → POST) broke for the fixture name.
 *       Check fetchSearchPage() and postSearch() in server/scrapers/afsaNpii.js.
 *   "Step 4 FAIL: fixture surname not found in result titles"
 *     → The surname filter in postSearch() — normalise(rowText).includes(normalise(surname))
 *       — may be too strict, or the column layout shift caused wrong personName extraction.
 *
 * REQUIREMENTS
 *   No API keys or Puppeteer needed — axios only.
 *
 * EXIT CODE
 *   0 — fixture person found by scraper
 *   1 — not found or error at any layer
 */

'use strict';

const path  = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { searchAfsaNpii } = require(path.join(__dirname, '../scrapers/afsaNpii'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

// MIGRATION (2026-07-05): npii.afsa.gov.au is decommissioned.
// AFSA moved NPII to the Bankruptcy Register Search (BRS) at services.afsa.gov.au/brs/.
// The BRS uses CSRF tokens, not JSF ViewState, and requires an AFSA account + per-result
// payment. The scraper (afsaNpii.js) silently returns empty results until rebuilt.
// This test will fail at Step 1 (no ViewState) — this is the expected signal that
// the scraper needs a full rebuild targeting the BRS 3-step flow:
//   1. GET /brs/search → extract _csrf + cookies
//   2. POST /brs/search-add-email → name criteria → shows email opt-in page
//   3. POST /brs/searchbyname → email page → shows results (requires paid AFSA account)
const BASE        = 'https://services.afsa.gov.au';
const SEARCH_URL  = `${BASE}/brs/search`;
const TIMEOUT_MS  = 15000;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: `${BASE}/`,
};

// Administration type strings used by NPII
const ADMIN_TYPE_PATTERN = /bankruptcy|debt agreement|personal insolvency|part ix|part x/i;

// ── Parse CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// ── Utilities ──────────────────────────────────────────────────────────────────

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z\s]/g, '').trim();
}

/**
 * Attempt to extract a surname from a table row's cells.
 * NPII layouts vary; mirrors the column-detection logic in afsaNpii.js.
 */
function extractSurnameFromRow($, row) {
  const $cells = $(row).find('td');
  if ($cells.length < 2) return null;

  const col0 = $cells.eq(0).text().trim();
  const col1 = $cells.eq(1).text().trim();

  let personName = '';
  if (ADMIN_TYPE_PATTERN.test(col0)) {
    // Layout: AdminType | Name | ...
    personName = col1;
  } else {
    // Layout: Name | AdminType | ... (or fallback)
    personName = col0;
  }

  if (!personName) return null;

  // Person names on NPII are typically "SURNAME Givenname" or "Givenname SURNAME".
  // The surname filter in afsaNpii.js uses only the surname portion.
  // Return the first significant word (>= 2 chars) as a usable surname.
  const parts = personName.trim().split(/\s+/).filter((p) => p.length >= 2);
  return parts.length > 0 ? parts[0] : null;
}

// ── Main ───────────────────────────────────────────────────────────────────────

(async () => {
  header('AFSA — National Personal Insolvency Index (NPII) Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Load the NPII search page and extract session tokens ─────────────
  step('Step 1: Loading NPII search page and extracting JSF ViewState...');

  let viewState = '';
  let cookies   = '';

  try {
    const res = await axios.get(SEARCH_URL, {
      headers: HEADERS,
      timeout: TIMEOUT_MS,
      maxRedirects: 5,
    });

    const $ = cheerio.load(res.data);
    viewState = $('input[name="javax.faces.ViewState"]').val() || '';
    cookies   = [].concat(res.headers['set-cookie'] || []).join('; ');

    if (!viewState) {
      fail(
        'Step 1',
        'Page loaded but no javax.faces.ViewState token found — this is EXPECTED.\n' +
        'AFSA decommissioned npii.afsa.gov.au and migrated NPII to:\n' +
        '  https://services.afsa.gov.au/brs/search  (Bankruptcy Register Search)\n' +
        'The BRS uses CSRF tokens (not JSF ViewState) and requires:\n' +
        '  • A registered AFSA account\n' +
        '  • Per-result payment ("Pay and search")\n' +
        'The scraper (afsaNpii.js) needs a full rebuild for the 3-step BRS flow.\n' +
        'See the MIGRATION note at the top of this file and afsaNpii.js for details.\n' +
        `BRS URL: ${SEARCH_URL}`,
      );
      summary(0, 1);
      process.exit(1);
    }

    step(`  ViewState present (${viewState.length} chars), cookies: ${cookies.length} chars`);
  } catch (e) {
    fail(
      'Step 1',
      `Could not load BRS search page: ${e.message}\n` +
      `URL: ${SEARCH_URL}\n` +
      'Check connectivity: curl -I https://services.afsa.gov.au/brs/search\n' +
      'Note: npii.afsa.gov.au was decommissioned 2026-07 — AFSA NPII moved to BRS.',
    );
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 1', `NPII search page reachable; ViewState token obtained`);
  passed++;

  // ── Step 2: Broad POST to discover a live fixture ───────────────────────────
  step('Step 2: POSTing broad search to discover a live insolvency entry...');

  let fixtureName = suppliedName;

  if (!fixtureName) {
    // Use a single common letter as a broad surname to surface live records.
    // Try several letters so we don't depend on one letter having entries.
    const candidateLetters = ['S', 'B', 'M', 'T', 'W'];
    let foundRows = [];
    let usedLetter = '';

    for (const letter of candidateLetters) {
      try {
        const params = new URLSearchParams();
        params.set('javax.faces.ViewState', viewState);
        params.set('searchForm', 'searchForm');
        params.set('searchForm:surname', letter);
        params.set('searchForm:givenName', '');
        params.set('searchForm:searchType', 'DEBTOR_NAME');
        params.set('searchForm:searchButton', 'Search');
        params.set('javax.faces.source', 'searchForm:searchButton');
        params.set('javax.faces.partial.execute', '@all');
        params.set('javax.faces.partial.render', '@all');

        const res = await axios.post(SEARCH_URL, params.toString(), {
          headers: {
            ...HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: cookies,
          },
          timeout: TIMEOUT_MS,
          maxRedirects: 5,
        });

        const $ = cheerio.load(res.data);
        const rows = $('table tbody tr').toArray();

        if (rows.length > 0) {
          foundRows = rows.map((r) => ({ row: r, $}));
          usedLetter = letter;
          step(`  Broad search for "${letter}*" returned ${rows.length} table row(s)`);
          break;
        }

        step(`  Broad search for "${letter}*" returned 0 rows — trying next letter`);
      } catch (e) {
        warn(`  POST with letter "${letter}" failed: ${e.message}`);
      }
    }

    if (foundRows.length === 0) {
      fail(
        'Step 2',
        'Broad POST returned no table rows for any candidate letter.\n' +
        'Possible causes:\n' +
        '  • JSF form field names changed — check searchForm:* names in afsaNpii.js\n' +
        '  • The search returns results via AJAX into a partial-update XML envelope;\n' +
        '    cheerio may need to parse the partial response differently\n' +
        '  • NPII register is temporarily empty or rate-limited\n' +
        'Re-run with --name "Surname Givenname" to skip auto-discovery.',
      );
      failed++;
      summary(passed, failed);
      process.exit(1);
    }

    // Extract a usable surname from the first matching row
    for (const { row, $ } of foundRows) {
      const surname = extractSurnameFromRow($, row);
      if (surname && surname.length >= 2) {
        fixtureName = surname;
        break;
      }
    }

    if (!fixtureName) {
      fail(
        'Step 2',
        'Could not extract a surname from any table row.\n' +
        'The NPII table column layout may have changed.\n' +
        'Check extractSurnameFromRow() in this test and the column-detection\n' +
        'logic in postSearch() in server/scrapers/afsaNpii.js.\n' +
        'Re-run with --name "Surname Givenname" to bypass auto-discovery.',
      );
      failed++;
      summary(passed, failed);
      process.exit(1);
    }

    step(`  Auto-discovered fixture surname: "${fixtureName}" (from letter "${usedLetter}" broad search)`);
  }

  pass('Step 2', `Test fixture: "${fixtureName}"`);
  passed++;

  // ── Step 3: Call searchAfsaNpii with the fixture name ────────────────────────
  step(`Step 3: Calling searchAfsaNpii(["${fixtureName}"])...`);

  let result;
  try {
    result = await searchAfsaNpii([fixtureName]);
  } catch (e) {
    fail('Step 3', `searchAfsaNpii threw: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  step(`  Summary: "${result.summary}"`);
  step(`  Results count: ${result.results.length}`);

  if (result.results.length > 0) {
    result.results.slice(0, 3).forEach((r, i) =>
      dump(`Result ${i + 1}`, {
        title: r.title,
        description: r.description,
        status: r.status,
        date: r.date,
        url: r.url,
      }),
    );
  }

  if (result.results.length === 0) {
    fail(
      'Step 3',
      `searchAfsaNpii returned 0 results for "${fixtureName}".\n` +
      'Possible causes:\n' +
      '  • The JSF two-step flow (GET viewState → POST) failed silently inside the scraper.\n' +
      '    The scraper catches all errors and returns [] — check fetchSearchPage() and\n' +
      '    postSearch() in server/scrapers/afsaNpii.js for silent failures.\n' +
      '  • The surname filter in postSearch() — normalise(rowText).includes(normalise(surname))\n' +
      '    — may be too strict if the auto-discovered name includes punctuation or accents.\n' +
      '  • The NPII table had only one row when auto-discovered; that entry may have been\n' +
      '    purged between Step 2 and Step 3. Re-run with --name to use a stable fixture.',
    );
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 3', `scraper returned ${result.results.length} result(s)`);
  passed++;

  // ── Step 4: Verify fixture surname appears in at least one result title ───────
  step(`Step 4: Checking fixture surname "${fixtureName}" appears in result titles...`);

  // The scraper's postSearch() already filters rows by normalise(surname) appearing
  // in the row text, so the first word of fixtureName should always be present.
  const fixtureSurname = normalise(fixtureName).split(/\s+/)[0];

  const found = result.results.some((r) => {
    const text = normalise(r.title || '');
    return fixtureSurname.length >= 2 && text.includes(fixtureSurname);
  });

  if (!found) {
    fail(
      'Step 4',
      `Fixture surname "${fixtureSurname}" not found in any result title.\n` +
      'This suggests the column-detection logic in postSearch() is assigning the wrong\n' +
      'cell to personName, so the title is built from the admin-type column instead.\n' +
      'Check the adminTypePattern branching in server/scrapers/afsaNpii.js.\n' +
      'Result titles returned:',
      result.results.map((r) => r.title),
    );
    failed++;
  } else {
    pass('Step 4', `Fixture surname "${fixtureSurname}" confirmed in scraper results`);
    passed++;
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
