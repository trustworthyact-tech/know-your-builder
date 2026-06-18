/**
 * TEST: QBCC Adjudication Decisions
 *
 * PURPOSE
 *   Verifies that the adjudication path of searchQBCC() returns results when
 *   given an entity name confirmed to appear in the QBCC adjudication decisions
 *   register. The test self-discovers a fixture by calling the Salesforce Aura
 *   API directly with an empty query, then calls the full scraper and checks
 *   the same entity comes back in adjudicationResults.
 *
 *   The old QBCC adjudication decisions page (qbcc.qld.gov.au/adjudication-decisions)
 *   was removed. Decisions now live at:
 *     https://my.qbcc.qld.gov.au/myQBCC/s/adjudication-registry
 *   backed by a Salesforce Aura Apex API.
 *
 *   Four-layer diagnostic pattern:
 *     • Step 1 FAIL: Aura API not reachable or returns error
 *       → The Aura endpoint URL or Apex classname changed
 *     • Step 2 FAIL: API returned results but no party name can be extracted
 *       → The JSON response field names changed (respondent/claimant)
 *     • Step 3 FAIL: 0 adjudicationResults from scraper
 *       → The scraper's Aura API call structure differs from what Step 1 used
 *     • Step 4 FAIL: fixture not in adjudicationResults
 *       → The extracted name doesn't match what's stored in the decisions
 *
 * REQUIREMENTS
 *   No API keys or Puppeteer needed — axios + JSON only.
 *
 * USAGE
 *   node server/tests/test-qbcc-adjudication.js
 *   node server/tests/test-qbcc-adjudication.js --name "Smith Building Pty Ltd"
 *
 * EXIT CODE
 *   0 — fixture entity found in adjudicationResults
 *   1 — not found or error at any layer
 */

'use strict';

const path    = require('path');
const axios   = require('axios');
const { searchQBCC } = require(path.join(__dirname, '../scrapers/qbcc'));
const { pass, fail, step, warn, dump, header, summary } = require('./lib/helpers');

const ADJUDICATION_REGISTRY_URL = 'https://my.qbcc.qld.gov.au/myQBCC/s/adjudication-registry';
const AURA_ENDPOINT = 'https://my.qbcc.qld.gov.au/myQBCC/s/sfsites/aura?r=0&aura.ApexAction.execute=1';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  Origin: 'https://my.qbcc.qld.gov.au',
  Referer: ADJUDICATION_REGISTRY_URL,
};

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const nameIdx     = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

// ── Utilities ─────────────────────────────────────────────────────────────────

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

const stopwords = new Set(['pty', 'ltd', 'limited', 'the', 'and', 'of', 'a', 'for', 'in', 'v']);

function sigWords(name) {
  return normalise(name)
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopwords.has(w));
}

async function callAuraApi(searchBy, lastName) {
  const message = {
    actions: [{
      id: '1;a',
      descriptor: 'aura://ApexActionController/ACTION$execute',
      callingDescriptor: 'UNKNOWN',
      params: {
        namespace: '',
        classname: 'QBCCAdjudicationSearchController',
        method: 'getAdjudicationRegistryDecisionBy',
        params: { searchBy, firstName: '', lastName },
        cacheable: false,
        isContinuation: false,
      },
    }],
  };
  const auraContext = {
    mode: 'PROD',
    fwuid: 'scraper',
    app: 'siteforce:communityApp',
    loaded: { 'APPLICATION@markup://siteforce:communityApp': 'scraper' },
    dn: [],
    globals: {},
    uad: true,
  };
  const body = new URLSearchParams({
    message: JSON.stringify(message),
    'aura.context': JSON.stringify(auraContext),
    'aura.token': 'null',
  });

  const { data } = await axios.post(AURA_ENDPOINT, body.toString(), {
    headers: HEADERS,
    timeout: 20000,
  });
  return data?.actions?.[0]?.returnValue?.returnValue || [];
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  header('QBCC Adjudication Decisions — Integration Test');
  let passed = 0;
  let failed = 0;

  // ── Step 1: Call Aura API to confirm it's reachable and find a fixture ────
  step('Step 1: Calling QBCC Salesforce Aura API (empty respondentName search)...');
  step(`  Endpoint: ${AURA_ENDPOINT}`);

  let rawItems = [];

  if (!suppliedName) {
    try {
      // Empty lastName may return all decisions (acts as a broad query).
      // If it returns nothing, the test will fall back to --name.
      rawItems = await callAuraApi('respondentName', '');
      step(`  Raw items returned: ${rawItems.length}`);
      if (rawItems.length > 0) {
        dump('First raw item', rawItems[0]);
      }
    } catch (e) {
      fail('Step 1',
        `Aura API request failed: ${e.message}\n` +
        'Possible causes:\n' +
        '  • The Aura endpoint URL has changed\n' +
        '  • The Apex classname or method name changed\n' +
        '  • The QBCC Salesforce community is down\n' +
        `URL: ${AURA_ENDPOINT}\n` +
        'Run with --name "Party Name" to skip API discovery and test the scraper directly.');
      summary(0, 1);
      process.exit(1);
    }

    if (rawItems.length === 0) {
      warn('Empty-query API call returned no results — empty search is not supported.');
      warn('The test requires --name "Party Name" to supply a fixture.');
      warn(`Example: node server/tests/test-qbcc-adjudication.js --name "Smith"`);
      fail('Step 1',
        'Could not auto-discover a fixture from the Aura API.\n' +
        'The API requires a specific party name (lastName) to return results.\n' +
        'Re-run with --name "Party Name Pty Ltd" using a name known to appear in decisions.');
      summary(0, 1);
      process.exit(1);
    }

    pass('Step 1', `Aura API reachable — ${rawItems.length} decision(s) returned from broad query`);
  } else {
    // --name supplied: just confirm the endpoint is reachable with a small probe
    try {
      await callAuraApi('respondentName', suppliedName.split(' ').pop() || suppliedName);
      pass('Step 1', `Aura API reachable (probed with supplied name)`);
    } catch (e) {
      fail('Step 1', `Aura API probe failed: ${e.message}`);
      summary(0, 1);
      process.exit(1);
    }
  }
  passed++;

  // ── Step 2: Extract a party/company name from the first API result ─────────
  step('Step 2: Extracting party name from first Aura API result...');

  let fixtureName = suppliedName;

  if (!fixtureName) {
    for (const item of rawItems) {
      const respondent = item.respondent || item.respondentName || '';
      const claimant   = item.claimant   || item.claimantName   || '';
      const candidate  = respondent || claimant;
      if (candidate && candidate.length > 2) {
        fixtureName = candidate;
        step(`  Extracted: "${fixtureName}" (respondent="${respondent}" claimant="${claimant}")`);
        break;
      }
    }
  }

  if (!fixtureName) {
    fail('Step 2',
      'Could not extract a party name from the API results.\n' +
      'The JSON field for party name is no longer "respondent" or "claimant".\n' +
      `Check the raw item keys above and update the test and qbcc.js accordingly.\n` +
      'Re-run with --name "Party Name" to skip auto-discovery.');
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 2', `Test fixture: "${fixtureName}"`);
  passed++;

  // ── Step 3: Call searchQBCC and assert adjudicationResults.length >= 1 ────
  // Use a distinctive word from the fixture name (avoid common words like "Ltd").
  const stopW = new Set(['pty', 'ltd', 'limited', 'and', 'the', 'of', 'a']);
  const fixtureWords = fixtureName.split(/[\s,&]+/).filter((w) => w.length > 3 && !stopW.has(w.toLowerCase()));
  const searchName = fixtureWords[0] || fixtureName;
  step(`Step 3: Calling searchQBCC("${searchName}", null, [])...`);

  let result;
  try {
    result = await searchQBCC(searchName, null, []);
  } catch (e) {
    fail('Step 3', `searchQBCC threw an unexpected error: ${e.message}`, e.stack);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  step(`  Summary: "${result.summary}"`);
  step(`  adjudicationResults count: ${result.adjudicationResults.length}`);

  if (result.adjudicationResults.length > 0) {
    result.adjudicationResults.slice(0, 3).forEach((r, i) =>
      dump(`adjudicationResult ${i + 1}`, { title: r.title, url: r.url, description: (r.description || '').slice(0, 100) }));
  }

  if (result.adjudicationResults.length === 0) {
    fail('Step 3',
      `searchQBCC("${searchName}") returned 0 adjudicationResults.\n` +
      'Possible causes:\n' +
      '  • The Aura API call in qbcc.js uses different params than this test\n' +
      '  • The search term does not match the party name in the decisions register\n' +
      '  • The Salesforce community or Aura endpoint changed\n' +
      `Search name used: "${searchName}" (last word of "${fixtureName}")`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  pass('Step 3', `scraper returned ${result.adjudicationResults.length} adjudication result(s)`);
  passed++;

  // ── Step 4: Verify fixture name appears in adjudicationResults ─────────────
  step(`Step 4: Checking if "${fixtureName}" appears in adjudicationResults...`);

  const words = sigWords(fixtureName);
  step(`  Significant words: ${JSON.stringify(words)}`);

  const found = result.adjudicationResults.some((r) => {
    const text = normalise((r.title || '') + ' ' + (r.description || ''));
    return words.length > 0 && words.every((w) => text.includes(w));
  });

  if (!found) {
    warn('Fixture not found in adjudicationResults titles/descriptions.');
    warn(`Tried matching significant words: ${JSON.stringify(words)}`);
    warn('If the scraper returned results but they use a different party name format,');
    warn('re-run with --name using the exact party string from the register.');
    fail('Step 4',
      `"${fixtureName}" not matched in any adjudicationResult.\n` +
      'Titles returned by scraper:',
      result.adjudicationResults.map((r) => r.title));
    failed++;
  } else {
    pass('Step 4', `"${fixtureName}" confirmed in adjudicationResults`);
    passed++;
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
