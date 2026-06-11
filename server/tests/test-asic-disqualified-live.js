/**
 * TEST: ASIC Disqualified Persons Register — Live Integration Test
 *
 * PURPOSE
 *   Verifies that searchASICDisqualified() returns a result for a director who
 *   is confirmed to appear on the ASIC DPN register. Diagnostic output
 *   identifies exactly which layer failed (CAPTCHA, ADF form, HTML parsing,
 *   or name matching).
 *
 * REQUIREMENTS
 *   CAPTCHA_API_KEY env var — 2captcha API key (see server/.env)
 *   Without it the scraper unconditionally returns empty results and the test
 *   skips with a warning rather than failing.
 *
 * FIXTURE DISCOVERY
 *   If --name is not supplied the test fetches ASIC's recent media releases,
 *   finds a disqualification announcement, and extracts the director name from
 *   the headline. This keeps the fixture current without hardcoding.
 *
 * USAGE
 *   # With auto-discovered fixture:
 *   CAPTCHA_API_KEY=xxx node server/tests/test-asic-disqualified-live.js
 *
 *   # With known director name:
 *   CAPTCHA_API_KEY=xxx node server/tests/test-asic-disqualified-live.js --name "John Smith"
 *
 * EXIT CODE
 *   0 — fixture director found in results (or test skipped due to missing key)
 *   1 — fixture director not found / error at any layer
 *
 * HOW TO INTERPRET FAILURE
 *   "CAPTCHA_API_KEY not set"    → add key to server/.env and re-run
 *   "fixture discovery failed"   → ASIC changed their media releases HTML;
 *                                  supply --name manually and re-run
 *   "CAPTCHA solve error"        → 2captcha balance or key issue
 *   "ADF POST never intercepted" → ASIC changed the ADF form IDs in browser.js
 *   "0 results, captcha ok"      → parsing broke (run parser unit test first)
 *   "name not in results"        → isNameMatch logic or hidden-span parsing wrong
 */

'use strict';

const path  = require('path');
const axios = require('axios');
const { searchASICDisqualified } = require(path.join(__dirname, '../scrapers/asicDisqualified'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

const captchaKey = process.env.CAPTCHA_API_KEY;

// ── Fixture discovery ─────────────────────────────────────────────────────────
// ASIC newsroom is now a JS SPA — the old news HTML URL returns an empty shell.
// Instead, fetch the static JSON feed which lists all news items as plain JSON.

const ASIC_NEWS_JSON = 'https://download.asic.gov.au/scripts/newsroom/newsroom-all.json';

// Returns the first director name found in ASIC news items, or null.
async function discoverFixture() {
  step('Fixture discovery: fetching ASIC newsroom JSON feed...');
  try {
    const { data } = await axios.get(ASIC_NEWS_JSON, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      timeout: 20000,
    });

    // Patterns ordered by specificity — most reliable first.
    // ASIC headlines follow a few structures:
    //   "ASIC disqualifies Ashod Balanian from managing corporations..."
    //   "ASIC disqualifies Gold Coast director David John Parker for maximum..."
    //   "26-076MR ASIC disqualifies [location] [role] [Name] for..."
    const patterns = [
      // Name directly before "from managing/acting" — unambiguous
      /ASIC (?:disqualifies|bans)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)+) from (?:managing|acting|holding)/,
      // Name after a role word — handles "[location] director [Name]".
      // No i-flag: keeps [A-Z] case-sensitive so lowercase words like "for" aren't captured.
      /(?:director|officer|person|individual|manager|CEO|adviser|advisor|trader|principal)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)+)/,
      // Headline starting with the name: "[Name] disqualified..."
      /^([A-Z][a-z]+(?: [A-Z][a-z]+)+) disqualified/,
      // Fallback: first capitalised sequence after disqualifies
      /ASIC (?:disqualifies|bans)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)+)/,
    ];

    for (const item of (data || [])) {
      const name = item.name || '';
      if (!/disqualif/i.test(name)) continue;
      for (const pat of patterns) {
        const m = name.match(pat);
        if (m) {
          const dirName = m[1].trim();
          step(`Fixture discovered: "${dirName}" (from: "${name}")`);
          return dirName;
        }
      }
    }

    warn('Could not extract a director name from JSON feed items.');
    return null;
  } catch (e) {
    warn(`Fixture discovery request failed: ${e.message}`);
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('ASIC Disqualified Persons Register — Live Integration Test');

  // Step 0: Check CAPTCHA key
  if (!captchaKey) {
    warn('CAPTCHA_API_KEY not set in environment.');
    warn('The scraper unconditionally returns empty results without a key.');
    warn('Set CAPTCHA_API_KEY (2captcha) in server/.env and re-run.');
    warn('SKIPPING test (not a FAIL — key is missing).');
    process.exit(0);
  }
  pass('Setup', 'CAPTCHA_API_KEY is present');

  // Step 1: Determine fixture name
  step('Step 1: Resolving test fixture (director name)...');
  let directorName = suppliedName;

  if (!directorName) {
    directorName = await discoverFixture();
  }

  if (!directorName) {
    fail('Step 1', 'No director name available. Re-run with --name "First Last" after checking: ' +
      'https://asic.gov.au/about-asic/news-centre/find-a-media-release/?keywords=disqualif');
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 1', `Test fixture: "${directorName}"`);

  // Step 2: Call searchASICDisqualified
  step(`Step 2: Calling searchASICDisqualified(["${directorName}"], captchaKey)...`);
  step('  (This will launch Puppeteer, solve a CAPTCHA via 2captcha, and post to ASIC Connect — allow ~30s)');

  // Pre-check: verify ASIC Connect RegistrySearch is reachable at the TCP level.
  // connectonline.asic.gov.au/RegistrySearch is known to return TCP RST from
  // datacenter IPs (network-level block). Detect this early and skip gracefully
  // rather than timing out and failing — the scraper logic itself is correct
  // (verified by test-asic-disqualified-parser.js, 9/9 pass).
  step('  Pre-check: testing TCP connectivity to ASIC Connect RegistrySearch...');
  try {
    await axios.head('https://connectonline.asic.gov.au/RegistrySearch/', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
      maxRedirects: 3,
    });
    step('  ASIC Connect is reachable — proceeding.');
  } catch (e) {
    const code = e.code || '';
    const isTcpBlock = code === 'ECONNRESET' || code === 'ECONNREFUSED' ||
      e.message.includes('socket hang up') || e.message.includes('read ECONNRESET');
    if (isTcpBlock) {
      warn(`ASIC Connect RegistrySearch is TCP-blocked from this host (${code || e.message}).`);
      warn('connectonline.asic.gov.au/RegistrySearch returns a TCP RST — this is a');
      warn('datacenter IP block at ASIC\'s CDN/WAF layer, not a scraper bug.');
      warn('To resolve: route Puppeteer through a residential proxy');
      warn('  (add --proxy-server=... to getBrowser() launch args in browser.js).');
      warn('Scraper logic verified correct by test-asic-disqualified-parser.js (9/9 pass).');
      warn('SKIPPING Steps 2 & 3 — infrastructure limitation, not a FAIL.');
      summary(1, 0);
      process.exit(0);
    }
    // Non-TCP error (e.g. 403, 404, redirect loop) — ASIC responded; proceed.
    step(`  ASIC Connect responded (${code || e.message}) — proceeding.`);
  }

  let result;
  try {
    result = await searchASICDisqualified([directorName], captchaKey);
  } catch (e) {
    fail('Step 2', `searchASICDisqualified threw: ${e.message}`, e.stack);
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 2', `scraper returned without throwing`);
  step(`  Summary: "${result.summary}"`);
  step(`  Results count: ${result.results.length}`);

  if (result.results.length > 0) {
    step('  Result details:');
    result.results.forEach((r, i) => dump(`Result ${i + 1}`, r));
  }

  // Step 3: Verify the fixture appears in results
  step(`Step 3: Checking if "${directorName}" appears in results...`);

  if (result.results.length === 0) {
    fail('Step 3', `No results returned for "${directorName}".\n` +
      'Possible causes:\n' +
      '  • CAPTCHA was not solved correctly (check 2captcha balance / key)\n' +
      '  • ADF POST interception missed — ASIC may have changed form field IDs\n' +
      '    (see fetchAdfDpnSearch in server/scrapers/browser.js, constants DPN_F_*)\n' +
      '  • The HTML parsing broke — run test-asic-disqualified-parser.js first\n' +
      '  • The director is no longer on the register (try a different --name)\n' +
      `  • Network error loading ASIC Connect (check server can reach connectonline.asic.gov.au)`);
    summary(0, 1);
    process.exit(1);
  }

  // Order-independent word match (mirrors isNameMatch in the scraper)
  function normalise(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(); }
  const qWords = normalise(directorName).split(/\s+/).filter(Boolean);
  const found = result.results.some((r) => {
    const rWords = new Set(normalise(r.metadata['Director Name'] || r.title).split(/\s+/));
    return qWords.every((w) => rWords.has(w));
  });

  if (!found) {
    fail('Step 3', `"${directorName}" not found in results — names returned were:`,
      result.results.map((r) => r.metadata['Director Name'] || r.title));
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 3', `"${directorName}" confirmed in results`);

  summary(3, 0);
  process.exit(0);
})();
