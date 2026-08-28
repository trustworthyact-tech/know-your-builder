/**
 * TEST: Court Records — live jurisdictions (NSW, ACT, Federal, NT) + manual fallback
 *
 * PURPOSE
 *   Verifies that searchCourtRecords() actually returns real, parsed results for every
 *   jurisdiction with a live automated source, and that every remaining jurisdiction
 *   returns the honest "no automated source" fallback shape rather than a silent
 *   "done, 0 results" — the exact failure mode CLAUDE.md flags for isAllErrored-style
 *   checks elsewhere in this codebase.
 *
 *   Each live jurisdiction uses its OWN fixture name, not a single shared one — a name
 *   that title-matches in one jurisdiction's case law usually won't in another's (e.g.
 *   "Multiplex" hits 19 NSW cases by title but 0 in ACT/Federal, where it only ever
 *   appears in full-text citations of other cases — titleMatchesTerm correctly filters
 *   those out. See the per-fixture comments below for the real case each one was
 *   verified against on 2026-08-26.)
 *
 *   Two-layer structure isolates failures:
 *     • Step 1 fails for a live jurisdiction (0 results for its known fixture)
 *       → that jurisdiction's search HTML structure likely changed — check the
 *         corresponding fetch*TermResults() selectors in courtRecords.js against a
 *         manual browse of its searchUrl (printed in the failure message)
 *     • Step 2 fails (a fallback jurisdiction doesn't return the expected shape)
 *       → buildManualFallback() no longer sets status: 'error', or a MANUAL_SEARCH_URLS
 *         entry was removed
 *
 * REQUIREMENTS
 *   NSW and ACT: no API keys or Puppeteer needed — axios + cheerio only, neither is
 *   Cloudflare/WAF-gated (confirmed 2026-08-26).
 *   Federal and NT: no API keys, but DO need Puppeteer (via fetchWithBrowser in
 *   browser.js) — both sit behind a Cloudflare managed challenge across their whole
 *   domain (confirmed: a solved session's cookies do not work for a subsequent plain
 *   HTTP request, so there's no way around the browser round-trip). These two steps
 *   are noticeably slower than NSW/ACT — budget up to a minute each.
 *
 * USAGE
 *   node server/tests/test-court-records.js
 *   node server/tests/test-court-records.js --name "Multiplex"   (overrides the NSW fixture only)
 *
 * TIMING
 *   NSW/ACT run in a few seconds each; Federal/NT can each take up to a minute
 *   (Puppeteer launch + Cloudflare challenge wait + page render). Expect this whole
 *   test to take ~1-2 minutes end to end.
 *
 * EXIT CODE
 *   0 — all assertions passed
 *   1 — any step failed or threw
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 [<jurisdiction>] FAIL: 0 results"
 *     → Open the printed searchUrl in a browser and check whether that jurisdiction's
 *       result markup (selectors documented at the top of each fetch*TermResults in
 *       courtRecords.js) still matches
 *   "Step 1 [<jurisdiction>] FAIL: result missing jurisdiction field"
 *     → that jurisdiction's search function no longer tags each ResultItem —
 *       runJurisdictionSearch() should do this generically; check it wasn't bypassed
 *   "Step 2 FAIL: fallback jurisdiction has wrong shape"
 *     → buildManualFallback() in courtRecords.js was changed; check it still returns
 *       status: 'error', results: [], and a searchUrl for every MANUAL_SEARCH_URLS key
 */

'use strict';

const path = require('path');
const { searchCourtRecords, buildManualFallback } = require(
  path.join(__dirname, '../scrapers/courtRecords')
);
const { pass, fail, step, dump, header, summary } = require('./lib/helpers');

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const nswOverride = nameIdx !== -1 ? args[nameIdx + 1] : null;

// One fixture per live jurisdiction — each verified to title-match a real, current case
// on 2026-08-26. Unlike NSW's, these aren't overridable via CLI (would need one flag per
// jurisdiction for little benefit) — if one goes stale, re-discover by browsing that
// jurisdiction's searchUrl for a broad term (e.g. "Constructions") and picking any
// "X v Y" title as the new fixture.
const LIVE_FIXTURES = {
  // "Multiplex" reliably appears in NSW Caselaw (same fixture entity used by the
  // CLAUDE.md performance baseline and the retired AustLII test).
  nsw: nswOverride || 'Multiplex',
  // Geocon Constructors (ACT) Pty Ltd — party in multiple live 2025 ACTSC matters
  // (e.g. "The Owners - Units Plan No 4421 v Geocon Constructors (ACT) Pty Ltd").
  act: 'Geocon Constructors',
  // Bunter v Hardy, in the matter of FT Sydney Pty Ltd — live 2026 FCA matters,
  // including a genuine deed-of-company-arrangement/Corporations Act case.
  federal: 'Bunter',
  // Multiplex Constructions PL v Trans Australian Constructions PL [1995] NTSC 14 —
  // NT is a small jurisdiction; this is a real but old (1995) hit, expect exactly 1.
  nt: 'Multiplex',
};

// Every jurisdiction not listed above should still return the manual fallback — see
// CLAUDE.md's court-records investigation for why each of these has no free,
// unauthenticated, full-text search yet.
const FALLBACK_JURISDICTIONS = ['qld', 'vic', 'wa', 'sa', 'tas'];

(async () => {
  header('Court Records — Live Jurisdictions + Manual Fallback Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: every live jurisdiction returns real, correctly-tagged results ──────
  // NSW and ACT are fast (plain axios); Federal and NT are slow (Puppeteer round-trip
  // through a Cloudflare managed challenge) — this step runs them sequentially rather
  // than in parallel so failures are easy to attribute to one jurisdiction at a time.
  const jurisdictionLabels = { nsw: 'NSW', act: 'ACT', federal: 'Federal', nt: 'NT' };

  for (const [jur, fixtureName] of Object.entries(LIVE_FIXTURES)) {
    const label = jurisdictionLabels[jur];
    step(`Step 1 [${jur}]: Calling searchCourtRecords("${fixtureName}", [], "${jur}")...`);

    let result;
    try {
      result = await searchCourtRecords(fixtureName, [], jur);
    } catch (e) {
      fail(`Step 1 [${jur}]`, `searchCourtRecords threw for jurisdiction "${jur}": ${e.message}`, e.stack);
      failed++;
      continue;
    }

    step(`  Summary: "${result.summary}"`);
    step(`  Results count: ${result.results.length}`);
    step(`  Jurisdiction label: "${result.jurisdiction}"`);

    if (result.results.length > 0) {
      result.results.slice(0, 2).forEach((r, i) =>
        dump(`${jur} result ${i + 1}`, { title: r.title, url: r.url, jurisdiction: r.jurisdiction }));
    }

    if (result.results.length < 1) {
      fail(`Step 1 [${jur}]`,
        `0 results for fixture "${fixtureName}".\n` +
        `Browse manually: ${result.searchUrl}\n` +
        'See the comment above LIVE_FIXTURES for how to pick a replacement fixture ' +
        'if this one no longer title-matches a current case.');
      failed++;
    } else if (result.jurisdiction !== label) {
      fail(`Step 1 [${jur}]`, `Expected jurisdiction "${label}" but got "${result.jurisdiction}".`);
      failed++;
    } else {
      const missingJurisdiction = result.results.filter((r) => r.jurisdiction !== label);
      if (missingJurisdiction.length > 0) {
        fail(`Step 1 [${jur}]`,
          `${missingJurisdiction.length} result(s) missing jurisdiction: '${label}' on the item itself ` +
          '(runJurisdictionSearch should tag every ResultItem, not just the top-level SearchResult).');
        failed++;
      } else {
        pass(`Step 1 [${jur}]`, `${result.results.length} result(s) returned, correctly tagged`);
        passed++;
      }
    }
  }

  // ── Step 1b: regression guard for the BHP false-negative (2026-08-26) ──────────────
  // Production originally returned "no cases found" for Federal Court on a real BHP
  // search despite BHP having a huge Federal Court history — fixed by adding
  // num_ranks=100 to the Federal Court search URL (Federal Court's search returns 1,514
  // total hits for "BHP" sorted by genuine relevance, and none of the default top-20 page
  // have "BHP" in the title). This step guards against that recall fix regressing.
  step('\nStep 1b: BHP Group Limited on Federal Court (regression guard)...');
  try {
    const bhp = await searchCourtRecords('BHP Group Limited', [], 'federal');
    const titleMatches = bhp.results.filter((r) => /\bbhp\s+group\s+limited\b/i.test(r.title));
    if (titleMatches.length < 1) {
      fail('Step 1b',
        `0 of ${bhp.results.length} Federal Court result(s) for "BHP Group Limited" ` +
        'actually contain "BHP Group Limited" (as a full phrase) in the title.\n' +
        'Check: num_ranks=100 is still present in fetchFederalTermResults\'s searchUrl ' +
        `— without it the default page size (20) is nowhere near enough for a ` +
        `high-volume entity like BHP.\nsearchUrl: ${bhp.searchUrl}`);
      failed++;
    } else {
      pass('Step 1b', `${titleMatches.length} genuine BHP Group Limited title-match(es) found (e.g. "${titleMatches[0].title}")`);
      passed++;
    }
  } catch (e) {
    fail('Step 1b', `searchCourtRecords threw for the BHP regression check: ${e.message}`, e.stack);
    failed++;
  }

  // ── Step 1c: regression guard for the BHP same-word-different-entity noise (2026-08-26) ──
  // A real production search for "BHP Group Pty Ltd" (ABN 49004028077) returned a wall of
  // unrelated BHP-group litigation — "BHP Coal Pty Ltd v Mining and Energy Union", "BHP
  // Steel v Oliver", "BHP Titanium Minerals", "BHP Refractories Pty Ltd", etc. — because
  // "BHP Group" stripped to the single distinctive word "BHP" ("Group" is a COMMON_WORDS
  // entry) and any title containing that one word passed. Fixed by requiring the full
  // multi-word term to appear together as a phrase. This step guards against that
  // full-phrase requirement being loosened back to single-word matching.
  step('\nStep 1c: BHP Group Limited excludes same-word different-entity noise (regression guard)...');
  try {
    const bhp = await searchCourtRecords('BHP Group Limited', [], 'nsw');
    const noise = bhp.results.filter((r) => !/\bbhp\s+group\s+limited\b/i.test(r.title));
    if (noise.length > 0) {
      fail('Step 1c',
        `${noise.length} NSW result(s) for "BHP Group Limited" don't contain the full ` +
        `phrase "BHP Group Limited" in the title (e.g. "${noise[0].title}") — ` +
        'titleMatchesTerm in courtRecords.js has likely regressed to single-word matching.');
      failed++;
    } else {
      pass('Step 1c', `All ${bhp.results.length} NSW result(s) genuinely contain "BHP Group Limited" — no same-word noise`);
      passed++;
    }
  } catch (e) {
    fail('Step 1c', `searchCourtRecords threw for the BHP noise regression check: ${e.message}`, e.stack);
    failed++;
  }

  // ── Step 2: fallback jurisdictions return the honest "no automated source" shape ──
  step(`\nStep 2: Checking fallback shape for [${FALLBACK_JURISDICTIONS.join(', ')}]...`);

  for (const jur of FALLBACK_JURISDICTIONS) {
    let result;
    try {
      result = await searchCourtRecords('Multiplex', [], jur);
    } catch (e) {
      fail(`Step 2 [${jur}]`, `searchCourtRecords threw: ${e.message}`, e.stack);
      failed++;
      continue;
    }

    const problems = [];
    if (result.status !== 'error') problems.push(`status is "${result.status}", expected "error"`);
    if (!Array.isArray(result.results) || result.results.length !== 0) {
      problems.push('results is not an empty array');
    }
    if (!result.searchUrl) problems.push('searchUrl is missing — no manual link surfaced');

    if (problems.length > 0) {
      fail(`Step 2 [${jur}]`, `Fallback shape incorrect: ${problems.join('; ')}`, result);
      failed++;
      continue;
    }

    step(`  [${jur}] status="${result.status}" searchUrl="${result.searchUrl}"`);
    pass(`Step 2 [${jur}]`, 'Honest fallback shape confirmed (status: error, no fabricated results)');
    passed++;
  }

  // Sanity check: buildManualFallback is directly exported and used correctly by
  // searchCourtRecords for a non-nsw jurisdiction (guards against the dispatch branch
  // silently drifting from the exported helper).
  const direct = buildManualFallback('tas');
  if (direct.searchUrl !== (await searchCourtRecords('Multiplex', [], 'tas')).searchUrl) {
    fail('Step 2', 'buildManualFallback("tas") and searchCourtRecords(..., "tas") disagree on searchUrl.');
    failed++;
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
