'use strict';

// Block pages are failures, never "no results" (DATA_SOURCES_PLAN.md Phase 2.2 / Phase 0).
// Fixtures in ./fixtures are trimmed excerpts of real pages saved 2026-10-13: a results page and
// a no-results page from each site, and the Cloudflare challenge courts.act.gov.au served to
// Railway that day. The scraper-level tests stub axios so every request gets the challenge page,
// then check the search reports a failure rather than a clean "nothing found".
const { test, mock, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { isFunnelbackResultsPage, isFedcourtResultsPage, fetchFederalPage, _resetFederalProxyForTests, searchCourtRecords } = require('./courtRecords');
const { isFwoSearchPage, searchFWO } = require('./fwo');
const { isSearchResponse, isDetailsResponse } = require('./nswFairTrading');
const { _resetForTests } = require('./proxyLimiter');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const CHALLENGE = fixture('act-challenge.html');
const AKAMAI_DENIED = '<html><head><title>Access Denied</title></head><body>You don\'t have permission to access this resource.</body></html>';

beforeEach(() => {
  _resetForTests();
  _resetFederalProxyForTests();
  mock.restoreAll();
});

test('ACT courts / ACAT — real results and no-results pages pass; block pages fail', () => {
  for (const f of ['act-hit.html', 'act-none.html', 'acat-hit.html', 'acat-none.html']) {
    assert.equal(isFunnelbackResultsPage(fixture(f)), true, f);
  }
  assert.equal(isFunnelbackResultsPage(CHALLENGE), false);
  assert.equal(isFunnelbackResultsPage(AKAMAI_DENIED), false);
  assert.equal(isFunnelbackResultsPage(''), false);
  assert.equal(isFunnelbackResultsPage({ some: 'json' }), false);
});

test('FWO — real results and no-results pages pass; block pages fail', () => {
  assert.equal(isFwoSearchPage(fixture('fwo-hit.html')), true);
  assert.equal(isFwoSearchPage(fixture('fwo-none.html')), true);
  assert.equal(isFwoSearchPage(CHALLENGE), false);
  assert.equal(isFwoSearchPage(AKAMAI_DENIED), false);
});

test('Federal Court — real results and no-results pages pass; block pages fail', () => {
  assert.equal(isFedcourtResultsPage(fixture('fed-hit.html')), true);
  assert.equal(isFedcourtResultsPage(fixture('fed-none.html')), true);
  assert.equal(isFedcourtResultsPage(CHALLENGE), false);
  assert.equal(isFedcourtResultsPage(AKAMAI_DENIED), false);
  assert.equal(isFedcourtResultsPage(fixture('act-hit.html')), false, 'another Funnelback site is not a Federal Court page');
});

test('NSW — only the expected JSON shapes pass', () => {
  assert.equal(isSearchResponse({ results: [] }), true);
  assert.equal(isSearchResponse({ results: [{ licenceId: 'x' }] }), true);
  assert.equal(isSearchResponse(CHALLENGE), false);
  assert.equal(isSearchResponse({ error: 'Unsupported Media Type' }), false);
  assert.equal(isDetailsResponse({ componentData: { licenceNumber: '85273C' } }), true);
  assert.equal(isDetailsResponse({ componentData: null }), false);
  assert.equal(isDetailsResponse(CHALLENGE), false);
});

// A failed check is `status: 'error'` (validateResult.js then sets completeness 'unavailable')
// or an explicit partial/unavailable completeness — never a done/complete empty result.
const reportsFailure = (out) => out.status === 'error' || ['partial', 'unavailable'].includes(out.completeness);

function stubEverySiteWith(page) {
  const prev = { SCRAPEOPS_API_KEY: process.env.SCRAPEOPS_API_KEY, PROXY_URL: process.env.PROXY_URL };
  delete process.env.SCRAPEOPS_API_KEY; // direct route only, as in local dev
  delete process.env.PROXY_URL;
  mock.method(axios, 'get', async () => ({ status: 200, data: page }));
  mock.method(axios, 'post', async () => ({ status: 200, data: page }));
  return () => {
    for (const [k, v] of Object.entries(prev)) if (v !== undefined) process.env[k] = v;
  };
}

test('ACT courts search fed a Cloudflare challenge reports a failure, not "no cases found"', async () => {
  const restore = stubEverySiteWith(CHALLENGE);
  try {
    const out = await searchCourtRecords('Blockpage Test Constructions Pty Ltd', [], 'act');
    assert.deepEqual(out.results, []);
    assert.ok(reportsFailure(out), `got: ${out.status} / ${out.completeness} / ${out.summary}`);
    assert.doesNotMatch(out.summary, /^No cases found/i);
  } finally {
    restore();
  }
});

test('FWO search fed a block page reports a failure, not "no enforcement outcomes"', async () => {
  const restore = stubEverySiteWith(AKAMAI_DENIED);
  try {
    const out = await searchFWO('Blockpage Test Constructions Pty Ltd', '', []);
    assert.deepEqual(out.results, []);
    assert.ok(reportsFailure(out), `got: ${out.status} / ${out.completeness} / ${out.summary}`);
    assert.doesNotMatch(out.summary, /^No Fair Work/i);
  } finally {
    restore();
  }
});

// Federal Court is a browser fetch, so these inject the browser call instead of stubbing axios.
// A fake fetchWithBrowser that applies the caller's `validate` the way browser.js does.
function fakeBrowser(pageFor) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push(options);
    const html = pageFor(options);
    if (options.validate && !options.validate(html)) throw new Error('did not return a results page');
    return html;
  };
  return { calls, fetch };
}
const PROXY = { server: 'http://gw.example-proxy.net:7000', username: 'u', password: 'p' };

test('Federal Court — an uncleared challenge throws, so the search fails instead of reading "no cases found"', async () => {
  const browser = fakeBrowser(() => CHALLENGE);
  await assert.rejects(fetchFederalPage('https://search.judgments.fedcourt.gov.au/s/search.html?query=x', { _fetchWithBrowser: browser.fetch, _proxy: null }));
  assert.equal(browser.calls[0].priority, 'high', 'Federal Court takes the browser pool\'s high-priority tier');
  assert.equal(browser.calls[0].proxy, null);
});

test('Federal Court — uses the residential proxy when configured, and goes direct for a while after it fails', async () => {
  let now = 0;
  const browser = fakeBrowser((o) => (o.proxy ? CHALLENGE : fixture('fed-hit.html')));
  const opts = { _fetchWithBrowser: browser.fetch, _proxy: PROXY, _now: () => now };
  mock.method(console, 'warn', () => {});
  await assert.rejects(fetchFederalPage('https://x/a', opts));
  assert.equal(await fetchFederalPage('https://x/b', opts), fixture('fed-hit.html'));
  assert.deepEqual(browser.calls.map((c) => Boolean(c.proxy)), [true, false]);
  now += 11 * 60 * 1000;
  await assert.rejects(fetchFederalPage('https://x/c', opts));
  assert.equal(browser.calls[2].proxy, PROXY, 'the proxy is tried again once the cooldown ends');
});

test('Federal Court — PROXY_ROUTES_FEDERAL without "residential" keeps the browser direct', async () => {
  process.env.PROXY_ROUTES_FEDERAL = 'direct';
  try {
    const browser = fakeBrowser(() => fixture('fed-none.html'));
    await fetchFederalPage('https://x/a', { _fetchWithBrowser: browser.fetch, _proxy: PROXY });
    assert.equal(browser.calls[0].proxy, null);
  } finally {
    delete process.env.PROXY_ROUTES_FEDERAL;
  }
});
