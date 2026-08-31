/**
 * TEST: QBCC Act Licensees Register — Live Integration Test
 *
 * PURPOSE
 *   Verifies that searchQBCC() finds a real, currently-licensed QBCC entity via the
 *   "Search QBCC Act Licensees" register (my.qbcc.qld.gov.au/myQBCC/s/qbcc-licensee-register).
 *   This is a plain Aura Apex call (PublicRegisterSearchController.searchQBCCActLicenses),
 *   no Puppeteer/browser needed — replaces the old www.qbcc.qld.gov.au REST/HTML endpoints,
 *   both of which are dead (404) as of 2026-08-31 following a QBCC site restructure. That
 *   old failure was silently swallowed, so this scraper's output was a false "0 licences"
 *   for an unknown length of time before anyone noticed — this test exists to catch the
 *   next time this register moves or changes shape.
 *
 * REQUIREMENTS
 *   None — plain axios call, no API keys, no Puppeteer. Should run in a few seconds.
 *
 * USAGE
 *   # Auto-discover fixture:
 *   node server/tests/test-qbcc-licensee.js
 *
 *   # Provide a known real QBCC company name (skips discovery, faster):
 *   node server/tests/test-qbcc-licensee.js --name "Some Real Company Pty Ltd"
 *
 * EXIT CODE
 *   0 — fixture found in licenceResults
 *   1 — not found or error at any layer
 *
 * HOW TO INTERPRET FAILURE
 *   "Step 1 FAIL: no results for any candidate word"
 *     → The Aura endpoint or PublicRegisterSearchController.searchQBCCActLicenses method
 *       has changed/moved — see LICENSEE_REGISTER_URL and callQBCCAura in
 *       server/scrapers/qbcc.js, and re-derive the current controller/method by driving
 *       https://my.qbcc.qld.gov.au/myQBCC/s/qbcc-licensee-register with Puppeteer and
 *       inspecting aura.ApexAction.execute network calls, the way this was originally found.
 *   "Step 3 FAIL: fixture not in licenceResults"
 *     → searchQBCCLicensees()'s field mapping or nameMatchesEntity() filtering is dropping
 *       a genuine match — compare Step 1's raw item against what's pushed to allResults.
 */

'use strict';

const path = require('path');
const axios = require('axios');
const { searchQBCC } = require(path.join(__dirname, '../scrapers/qbcc'));
const { pass, fail, step, dump, header, summary } = require('./lib/helpers');

const AURA_ENDPOINT = 'https://my.qbcc.qld.gov.au/myQBCC/s/sfsites/aura?r=0&aura.ApexAction.execute=1';

// Common words likely to appear in many QBCC-licensed business names.
const CANDIDATE_WORDS = ['CONSTRUCTION', 'BUILDING', 'HOMES', 'CONTRACTING'];

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// Direct Aura call duplicated from qbcc.js for fixture discovery only (same reasoning as
// test-qbcc-excluded.js duplicating its shadow-DOM helpers) — the real implementation under
// test is searchQBCC() below, called via its public export.
async function discoverFixture() {
  for (const word of CANDIDATE_WORDS) {
    step(`Trying candidate word "${word}"...`);
    const message = {
      actions: [{
        id: '1;a',
        descriptor: 'aura://ApexActionController/ACTION$execute',
        callingDescriptor: 'UNKNOWN',
        params: {
          namespace: '',
          classname: 'PublicRegisterSearchController',
          method: 'searchQBCCActLicenses',
          params: { name: '', firstName: '', lastName: word },
          cacheable: false,
          isContinuation: false,
        },
      }],
    };
    const auraContext = {
      mode: 'PROD', fwuid: 'scraper', app: 'siteforce:communityApp',
      loaded: { 'APPLICATION@markup://siteforce:communityApp': 'scraper' }, dn: [], globals: {}, uad: true,
    };
    const body = new URLSearchParams({
      message: JSON.stringify(message),
      'aura.context': JSON.stringify(auraContext),
      'aura.token': 'null',
    });
    try {
      const { data } = await axios.post(AURA_ENDPOINT, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        timeout: 15000,
      });
      const items = data?.actions?.[0]?.returnValue?.returnValue || [];
      if (items.length > 0) {
        const name = items[0].customer?.name || items[0].customer?.lname;
        if (name) return name.split(',')[0].trim(); // "SMITH, JOHN" → "SMITH"
      }
      step(`No results for "${word}"`);
    } catch (e) {
      step(`Request failed for "${word}": ${e.message}`);
    }
  }
  return null;
}

(async () => {
  header('QBCC Act Licensees Register — Live Integration Test');

  step('Step 1: Resolving test fixture...');
  let fixtureName = suppliedName;

  if (!fixtureName) {
    fixtureName = await discoverFixture();
  }

  if (!fixtureName) {
    fail('Step 1',
      'Could not find any entry in the QBCC Act Licensees register for any candidate word.\n' +
      'Either the Aura endpoint/controller/method changed, or all candidate words genuinely\n' +
      'have zero matches (unlikely). Manually verify by driving\n' +
      'https://my.qbcc.qld.gov.au/myQBCC/s/qbcc-licensee-register with Puppeteer and\n' +
      'inspecting aura.ApexAction.execute calls, then re-run with: --name "Known Company Name"');
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 1', `Test fixture: "${fixtureName}"`);

  step(`Step 2: Calling searchQBCC("${fixtureName}", "", [])...`);
  let result;
  try {
    result = await searchQBCC(fixtureName, '', []);
  } catch (e) {
    fail('Step 2', `searchQBCC threw: ${e.message}`, e.stack);
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 2', 'scraper returned without throwing');
  step(`  Summary: "${result.summary}"`);
  step(`  Licence results count: ${result.licenceResults.length}`);

  if (result.licenceResults.length > 0) {
    result.licenceResults.forEach((r, i) => dump(`Licensee ${i + 1}`, { title: r.title, metadata: r.metadata }));
  }

  step(`Step 3: Checking if "${fixtureName}" appears in licenceResults...`);

  function normalise(s) { return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(); }
  const qWords = normalise(fixtureName).split(/\s+/).filter(Boolean);

  const found = result.licenceResults.some((r) => {
    const rWords = new Set(normalise(r.title).split(/\s+/));
    return qWords.every((w) => rWords.has(w));
  });

  if (!found) {
    fail('Step 3',
      `"${fixtureName}" not found in licenceResults.\n` +
      'Possible causes:\n' +
      '  • searchQBCCLicensees()\'s field mapping changed (customer.name/lname) — check\n' +
      '    server/scrapers/qbcc.js against a fresh Puppeteer-captured Apex response\n' +
      '  • nameMatchesEntity() filtered out a genuine match\n' +
      '  • Deduplication removed the entry (seen.has check in searchQBCCLicensees)',
      { returned: result.licenceResults.map((r) => r.title) });
    summary(0, 1);
    process.exit(1);
  }

  pass('Step 3', `"${fixtureName}" confirmed in licenceResults`);

  summary(3, 0);
  process.exit(0);
})();
