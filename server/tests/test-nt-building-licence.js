/**
 * TEST: NT Building Practitioners Board — Licence Register
 *
 * PURPOSE
 *   Probes the NT building practitioner licence search to confirm:
 *     1. The register URL is accessible
 *     2. Searching by name returns parseable results
 *     3. A discovered entity can be found again by re-searching its name
 *
 *   There is no automated scraper for this register yet.
 *   URL from links.js: https://buildinglicences.nt.gov.au/search?name={name}
 *
 * REQUIREMENTS
 *   No API keys. Tries axios; falls back to Puppeteer if JS-rendered.
 *
 * USAGE
 *   node server/tests/test-nt-building-licence.js
 *   node server/tests/test-nt-building-licence.js --name "Smith Building"
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

const BASE = 'https://buildinglicences.nt.gov.au';
const SEARCH_URL = `${BASE}/search`;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/json',
  'Accept-Language': 'en-AU,en;q=0.9',
  Referer: BASE + '/',
};

// NT may use a React SPA (nt.gov.au digital platform) — try JSON API too
const API_URL = `${BASE}/api/search`;

const BROAD_TERMS = ['smith', 'jones', 'building', 'constructions'];
const SEARCH_PARAMS = ['name', 'q', 'query', 'search'];

const args = process.argv.slice(2);
const nameIdx = args.indexOf('--name');
const suppliedName = nameIdx !== -1 ? args[nameIdx + 1] : null;

function extractNamesFromHtml($) {
  const candidates = [
    'table tbody tr td:first-child',
    '.search-results td',
    '[class*="result"] [class*="name"]',
    '[class*="practitioner"] [class*="name"]',
    '.licence-holder',
    'td',
    'li [class*="name"]',
  ];
  for (const sel of candidates) {
    const names = [];
    $(sel).each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 3 && t.length < 120 && !/^(name|licence|type|status|expiry|class|number|practitioner|search|trade)/i.test(t)) {
        names.push(t);
      }
    });
    if (names.length > 0) return { names, sel };
  }
  return { names: [], sel: null };
}

function extractNamesFromJson(data) {
  if (Array.isArray(data)) {
    return data.map((item) =>
      item.name || item.fullName || item.licenceeName || item.practitionerName || JSON.stringify(item).slice(0, 80)
    ).filter(Boolean);
  }
  if (data && typeof data === 'object') {
    const arr = data.results || data.data || data.items || data.practitioners || [];
    return Array.isArray(arr) ? arr.map((item) => item.name || item.fullName || '').filter(Boolean) : [];
  }
  return [];
}

async function fetchWithPuppeteer(query) {
  step('  Falling back to Puppeteer for JS-rendered content...');
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(`${SEARCH_URL}?name=${encodeURIComponent(query)}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 4000));
    // If there's a search input, try filling it
    const inputSel = await page.$('input[type="search"], input[placeholder*="name" i], input[name*="name" i], input[name*="search" i]');
    if (inputSel) {
      await inputSel.click({ clickCount: 3 });
      await inputSel.type(query, { delay: 50 });
      await page.keyboard.press('Enter');
      await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
    }
    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

(async () => {
  header('NT Building Practitioners Board — Licence Register Probe');
  let passed = 0;
  let failed = 0;

  step('Step 1: Probing NT building licence search...');
  let rawHtml = null;
  let rawJson = null;
  let usedTerm = null;
  let usedMethod = 'axios';
  let usedParam = null;

  outer:
  for (const term of (suppliedName ? [suppliedName] : BROAD_TERMS)) {
    // Try HTML endpoint
    for (const param of SEARCH_PARAMS) {
      try {
        const { data } = await axios.get(`${SEARCH_URL}?${param}=${encodeURIComponent(term)}`, {
          headers: HEADERS, timeout: 20000,
        });
        if (typeof data === 'string' && data.length > 300) {
          rawHtml = data; usedTerm = term; usedParam = param; break outer;
        } else if (typeof data === 'object') {
          rawJson = data; usedTerm = term; usedParam = param; break outer;
        }
      } catch { /* try next */ }
    }
    // Try JSON API
    for (const param of SEARCH_PARAMS) {
      try {
        const { data } = await axios.get(`${API_URL}?${param}=${encodeURIComponent(term)}`, {
          headers: { ...HEADERS, Accept: 'application/json' }, timeout: 15000,
        });
        if (data && typeof data === 'object') {
          rawJson = data; usedTerm = term; usedParam = param; usedMethod = 'axios-json'; break outer;
        }
      } catch { /* try next */ }
    }
  }

  if (!rawHtml && !rawJson) {
    try {
      rawHtml = await fetchWithPuppeteer(suppliedName || BROAD_TERMS[0]);
      usedTerm = suppliedName || BROAD_TERMS[0];
      usedMethod = 'puppeteer';
    } catch (e) {
      fail('Step 1', `All access methods failed.\nURL: ${SEARCH_URL}\nLast error: ${e.message}`);
      summary(0, 1);
      process.exit(1);
    }
  }

  pass('Step 1', `Register reachable via ${usedMethod}${usedParam ? ` (?${usedParam}=)` : ''}, term: "${usedTerm}"`);
  passed++;

  step('Step 2: Parsing results...');
  let names = [];
  let sel = null;

  if (rawJson) {
    names = extractNamesFromJson(rawJson);
    sel = 'json';
    step(`  Parsed as JSON. Keys: ${Object.keys(rawJson).join(', ')}`);
  } else {
    const $ = cheerio.load(rawHtml);
    const result = extractNamesFromHtml($);
    names = result.names;
    sel = result.sel;
  }

  if (names.length === 0) {
    fail('Step 2',
      'No practitioner names found.\n' +
      'NT building licences may be behind a React SPA or require different search parameters.\n' +
      'Try: ' + SEARCH_URL + '\n' +
      'Raw response (first 800 chars):',
      (rawHtml || JSON.stringify(rawJson)).toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 800));
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  const fixtureName = suppliedName || names[0];
  pass('Step 2', `Found ${names.length} result(s) via "${sel}". Fixture: "${fixtureName}"`);
  passed++;
  step('  Sample: ' + names.slice(0, 3).join(', '));

  step(`Step 3: Re-searching for "${fixtureName}"...`);
  let reNames = [];
  try {
    if (usedMethod === 'puppeteer') {
      const html = await fetchWithPuppeteer(fixtureName);
      const $ = cheerio.load(html);
      reNames = extractNamesFromHtml($).names;
    } else if (usedMethod === 'axios-json') {
      const { data } = await axios.get(`${API_URL}?${usedParam}=${encodeURIComponent(fixtureName)}`, {
        headers: { ...HEADERS, Accept: 'application/json' }, timeout: 15000,
      });
      reNames = extractNamesFromJson(data);
    } else {
      const { data } = await axios.get(`${SEARCH_URL}?${usedParam}=${encodeURIComponent(fixtureName)}`, {
        headers: HEADERS, timeout: 20000,
      });
      if (typeof data === 'string') {
        const $ = cheerio.load(data);
        reNames = extractNamesFromHtml($).names;
      } else {
        reNames = extractNamesFromJson(data);
      }
    }
  } catch (e) {
    fail('Step 3', `Re-search failed: ${e.message}`);
    failed++;
    summary(passed, failed);
    process.exit(1);
  }

  const term0 = fixtureName.split(/\s+/)[0].toLowerCase();
  const found = reNames.some((n) => n.toLowerCase().includes(term0));

  if (!found) {
    fail('Step 3', `"${fixtureName}" not in re-search. Got: ${reNames.slice(0, 5).join(', ')}`);
    failed++;
  } else {
    pass('Step 3', `"${fixtureName}" confirmed in re-search`);
    passed++;
    step(`SCRAPER NOTE: NT licence register parseable via ${usedMethod}. Selector/format: "${sel}"`);
    step(`  URL: ${usedMethod === 'axios-json' ? API_URL : SEARCH_URL}?${usedParam || 'name'}={name}`);
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
