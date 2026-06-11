/**
 * TEST: WA Building and Energy — Licence Search Register
 *
 * PURPOSE
 *   Probes the WA Building & Energy licence search (separate from the
 *   enforcement media releases tested in test-wa-building.js) to confirm:
 *     1. The licence search URL is accessible
 *     2. Searching by name returns results with a parseable structure
 *     3. A discovered entity can be found again by re-searching its name
 *
 *   Note: the links.js URL points to commerce.wa.gov.au. This domain hosts
 *   the WA Department of Energy, Mines, Industry Regulation and Safety (DEMIRS)
 *   licence check, separate from the enforcement media release site.
 *
 * REQUIREMENTS
 *   No API keys. Tries axios; falls back to Puppeteer if JS-rendered.
 *
 * USAGE
 *   node server/tests/test-wa-be-licence.js
 *   node server/tests/test-wa-be-licence.js --name "Acme Building"
 *
 * EXIT CODE
 *   0 — register accessible, fixture entity found
 *   1 — any step failed
 */

'use strict';

const path    = require('path');
const axios   = require('axios');
const cheerio = require('cheerio');
const { getBrowser } = require(path.join(__dirname, '../scrapers/browser'));
const { pass, fail, step, warn, header, summary } = require('./lib/helpers');

const BASE = 'https://www.commerce.wa.gov.au';
const LICENCE_URL = `${BASE}/building-and-energy/licence-search`;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-AU,en;q=0.9',
  Referer: BASE + '/',
};

const BROAD_TERMS = ['pty', 'building', 'constructions', 'plumbing'];

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

function extractNames($) {
  const candidates = [
    'table tbody tr td:first-child',
    '.search-results td:first-child',
    '[class*="result"] [class*="name"]',
    'td[class*="name"]',
    'table tr td',
  ];
  for (const sel of candidates) {
    const names = [];
    $(sel).each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 3 && t.length < 120 && !/^(name|licence|registration|type|status|expiry|class|search)/i.test(t)) {
        names.push(t);
      }
    });
    if (names.length > 0) return { names, sel };
  }
  return { names: [], sel: null };
}

async function fetchWithAxios(query) {
  const url = `${LICENCE_URL}?name=${encodeURIComponent(query)}`;
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 20000 });
  return data;
}

async function fetchWithPuppeteer(query) {
  step('  Falling back to Puppeteer...');
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(`${LICENCE_URL}?name=${encodeURIComponent(query)}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 3000));
    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

(async () => {
  header('WA Building & Energy — Licence Search Register Probe');
  let passed = 0;
  let failed = 0;

  step('Step 1: Probing WA B&E licence search...');
  let rawHtml = null;
  let usedTerm = null;
  let usedMethod = 'axios';

  for (const term of (suppliedName ? [suppliedName] : BROAD_TERMS)) {
    try {
      const data = await fetchWithAxios(term);
      rawHtml = data;
      usedTerm = term;
      break;
    } catch (e) {
      warn(`  axios failed for "${term}": ${e.message}`);
    }
  }

  if (!rawHtml) {
    try {
      rawHtml = await fetchWithPuppeteer(suppliedName || BROAD_TERMS[0]);
      usedTerm = suppliedName || BROAD_TERMS[0];
      usedMethod = 'puppeteer';
    } catch (e) {
      fail('Step 1', `Both axios and Puppeteer failed: ${e.message}\nURL: ${LICENCE_URL}`);
      summary(0, 1);
      process.exit(1);
    }
  }

  pass('Step 1', `Register reachable via ${usedMethod} (search term: "${usedTerm}")`);
  passed++;

  step('Step 2: Parsing results HTML...');
  const $ = cheerio.load(rawHtml);
  const { names, sel } = extractNames($);

  if (names.length === 0) {
    fail('Step 2',
      'No licensee names found in response HTML.\n' +
      'WA B&E may use a different search parameter or a JS-rendered SPA.\n' +
      'Check the page at ' + LICENCE_URL + ' in a browser.\n' +
      'Raw text (first 800 chars):',
      rawHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800));
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  const fixtureName = suppliedName || names[0];
  pass('Step 2', `Found ${names.length} result(s) via "${sel}". Fixture: "${fixtureName}"`);
  passed++;
  step('  Sample: ' + names.slice(0, 3).join(', '));

  step(`Step 3: Re-searching for "${fixtureName}"...`);
  let reHtml;
  try {
    reHtml = usedMethod === 'puppeteer'
      ? await fetchWithPuppeteer(fixtureName)
      : await fetchWithAxios(fixtureName);
  } catch (e) {
    fail('Step 3', `Re-search failed: ${e.message}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  const $re = cheerio.load(reHtml);
  const { names: reNames } = extractNames($re);
  const term0 = fixtureName.split(/\s+/)[0].toLowerCase();
  const found = reNames.some((n) => n.toLowerCase().includes(term0));

  if (!found) {
    fail('Step 3', `"${fixtureName}" not found in re-search. Got: ${reNames.slice(0, 5).join(', ')}`);
    failed++;
  } else {
    pass('Step 3', `"${fixtureName}" confirmed in re-search`);
    passed++;
    step(`SCRAPER NOTE: WA B&E licence check parseable via ${usedMethod}. Selector: "${sel}"`);
    step(`  URL pattern: ${LICENCE_URL}?name={name}`);
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
