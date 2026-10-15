'use strict';

// NSW Caselaw: several result pages per name, a page check, and names searched four at a time
// (2026-10-15). Fixtures are trimmed real pages saved that day: a results page ("Displaying 1 -
// 20 of 1908 results", first 3 results kept) and a no-results page.
const { test, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { fetchNswAllPages, nswResultsTotal, searchCourtRecords } = require('./courtRecords');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const PAGE = fixture('nsw-caselaw-page.html');
const NONE = fixture('nsw-caselaw-none.html');
const CHALLENGE = fixture('act-challenge.html');

beforeEach(() => mock.restoreAll());

// A results page with `count` results (copies of the fixture's first result, each with its own
// URL) and the site's stated `total`.
const cheerio = require('cheerio');
function resultsPage(count, total, page = 0) {
  const $ = cheerio.load(PAGE);
  const one = $('.result').first();
  assert.ok(one.length, 'fixture has a result block');
  const items = Array.from({ length: count }, (_, i) => {
    const copy = one.clone();
    const link = copy.find('.cntn h4 a').first();
    link.attr('href', `${link.attr('href')}-p${page}-${i}`);
    return $.html(copy);
  }).join('\n');
  return `<html><body><div>Displaying 1 - ${count} of ${total} results</div>\n${items}\n</body></html>`;
}

function fakeHttp(pageFor) {
  const pages = [];
  return {
    pages,
    get: async (url) => {
      const page = Number(new URL(url).searchParams.get('page') ?? 0);
      pages.push(page);
      const html = pageFor(page, url);
      if (html instanceof Error) throw html;
      return { data: html };
    },
  };
}

test('nswResultsTotal — reads the site\'s count, 0 on an empty page, null on anything else', () => {
  assert.equal(nswResultsTotal(PAGE), 1908);
  assert.equal(nswResultsTotal(NONE), 0);
  assert.equal(nswResultsTotal(CHALLENGE), null);
  assert.equal(nswResultsTotal(undefined), null);
});

test('fetchNswAllPages — reads up to five pages for a name with many results', async () => {
  const http = fakeHttp((page) => resultsPage(20, 1908, page));
  const results = await fetchNswAllPages('many-results-name', http);
  assert.deepEqual(http.pages, [0, 1, 2, 3, 4]);
  assert.equal(results.length, 100);
});

test('fetchNswAllPages — stops at the site\'s total and at a short page', async () => {
  const exact = fakeHttp((page) => resultsPage(20, 40, page));
  assert.equal((await fetchNswAllPages('forty', exact)).length, 40);
  assert.deepEqual(exact.pages, [0, 1]);
  const short = fakeHttp((page) => resultsPage(page === 0 ? 20 : 7, 1000, page));
  assert.equal((await fetchNswAllPages('short', short)).length, 27);
  assert.deepEqual(short.pages, [0, 1]);
  const none = fakeHttp(() => NONE);
  assert.deepEqual(await fetchNswAllPages('nothing', none), []);
  assert.deepEqual(none.pages, [0]);
});

test('fetchNswAllPages — a block page, on any page, fails the name rather than reading as no cases', async () => {
  await assert.rejects(fetchNswAllPages('blocked', fakeHttp(() => CHALLENGE)), /not a results page/);
  await assert.rejects(fetchNswAllPages('blocked-later', fakeHttp((page) => (page === 2 ? CHALLENGE : resultsPage(20, 500, page)))), /page 2/);
});

test('NSW search — at most four names at a time; a blocked site reports a failure, not "no cases"', async () => {
  let inFlight = 0;
  let peak = 0;
  mock.method(axios, 'get', async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    return { data: CHALLENGE };
  });
  const names = Array.from({ length: 9 }, (_, i) => `Concurrency Test Person ${i} Unique`);
  const out = await searchCourtRecords('Concurrency Test Company Unique Pty Ltd', names, 'nsw');
  assert.ok(peak <= 4 && peak > 1, `peak ${peak}`);
  assert.equal(out.status, 'error');
  assert.equal(out.completeness, 'unavailable');
});
