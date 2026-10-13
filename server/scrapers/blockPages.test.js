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
const { isFunnelbackResultsPage, searchCourtRecords } = require('./courtRecords');
const { isFwoSearchPage, searchFWO } = require('./fwo');
const { isSearchResponse, isDetailsResponse } = require('./nswFairTrading');
const { _resetForTests } = require('./proxyLimiter');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const CHALLENGE = fixture('act-challenge.html');
const AKAMAI_DENIED = '<html><head><title>Access Denied</title></head><body>You don\'t have permission to access this resource.</body></html>';

beforeEach(() => {
  _resetForTests();
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
  const prev = process.env.SCRAPEOPS_API_KEY;
  delete process.env.SCRAPEOPS_API_KEY; // direct route only, as in local dev
  mock.method(axios, 'get', async () => ({ status: 200, data: page }));
  mock.method(axios, 'post', async () => ({ status: 200, data: page }));
  return () => {
    if (prev !== undefined) process.env.SCRAPEOPS_API_KEY = prev;
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
