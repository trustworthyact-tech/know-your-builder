'use strict';

// FWO media releases index (DATA_SOURCES_PLAN.md Phase 3). Fixtures are trimmed real pages saved
// 2026-10-14: the newest listing page, the listing past its last page, and one release (Barco
// Traders Pty Ltd, penalised; director Daniel John McGettigan).
const { test, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const localIndex = require('./localIndex');
const runner = require('./runner');
const fwo = require('./fwoReleases');
const { InvalidResponseError } = require('../scrapers/proxyLimiter');

const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'scrapers', 'fixtures', name), 'utf8');
const LISTING = fixture('fwo-listing.html');
const LISTING_END = fixture('fwo-listing-end.html');
const RELEASE = fixture('fwo-release.html');
const CHALLENGE = fixture('act-challenge.html');

let db;
beforeEach(() => {
  runner._resetForTests();
  fwo._resetCacheForTests();
  db = localIndex._openMemoryForTests();
  localIndex._useDatabaseForTests(db);
  mock.restoreAll();
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
});

// A fake FWO site: `listing` pages in order (then the end page); every release URL serves
// `release(url)` (default: the Barco release). Applies validate() as proxiedRequest does.
function fakeFwo({ listing = [LISTING], release = () => RELEASE } = {}) {
  const calls = [];
  const request = async ({ url, validate }) => {
    calls.push(url);
    const page = url.includes('/newsroom/media-releases/20') ? null : Number(new URL(url).searchParams.get('page') ?? 0);
    const html = page === null ? release(url) : listing[page] ?? LISTING_END;
    if (html instanceof Error) throw html;
    if (!validate(html)) throw new InvalidResponseError('block page');
    return html;
  };
  return { request, calls };
}

const LIMITS = { pageDelayMs: 0, minReleases: 1 };
const NO_PACING = { _sleep: async () => {} };
async function runJob(request, limits = LIMITS) {
  fwo.register(request, limits);
  return runner.runJobOnce(fwo.JOB_KEY, NO_PACING);
}

test('parseListing — title, link and date of each release; the page past the end is an empty listing', () => {
  const items = fwo.parseListing(LISTING);
  assert.equal(items.length, 10);
  assert.deepEqual(items[0], {
    url: 'https://www.fairwork.gov.au/newsroom/media-releases/2026-media-releases/october-2026/20261014-sunnyfield-eu-media-release',
    title: 'Disability services provider Sunnyfield signs EU after $5 million underpayment',
    published: '2026-10-14',
  });
  assert.deepEqual(fwo.parseListing(LISTING_END), []);
  assert.equal(fwo.isListingPage(LISTING_END), true);
  assert.equal(fwo.isListingPage(CHALLENGE), false);
});

test('parseRelease — records the names mentioned and the outcome, not the text', () => {
  const facts = fwo.parseRelease(RELEASE);
  assert.equal(facts.title, 'Food waste road transport company penalised');
  assert.equal(facts.published, '2026-09-23');
  assert.equal(facts.enforcement, true);
  assert.ok(facts.names.includes('Barco Traders Pty Ltd'));
  assert.ok(facts.names.includes('Daniel John McGettigan'));
  assert.deepEqual(Object.keys(facts).sort(), ['enforcement', 'names', 'published', 'title']);
  assert.equal(fwo.parseRelease(CHALLENGE), null);
});

test('extractNames — keeps joined names together and splits at sentence and paragraph ends', () => {
  assert.deepEqual(
    fwo.extractNames('The operators of Sushi Hub; Smith & Jones Pty Ltd was penalised. Mr John Smith said nothing.').sort(),
    ['Mr John Smith', 'Smith & Jones Pty Ltd', 'Sushi Hub'].sort()
  );
});

test('nameMatches — every significant word within one mentioned name', () => {
  assert.equal(fwo.nameMatches('Daniel John McGettigan', 'Daniel McGettigan'), true);
  assert.equal(fwo.nameMatches('Barco Traders Pty Ltd', 'Barco Traders Pty Limited'), true);
  assert.equal(fwo.nameMatches('Barco Traders Pty Ltd', 'Barco Removals Pty Ltd'), false);
  assert.equal(fwo.nameMatches('Sunnyfield', 'Sunnyfield Association Inc'), false);
});

test('job — copies the listing, reads every release, then becomes ready', async () => {
  const site = fakeFwo();
  assert.deepEqual(await runJob(site.request), { ok: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fwo_release WHERE read_at IS NOT NULL').get().n, 10);
  assert.equal(fwo.indexReady(), true);
  assert.equal(site.calls.filter((u) => u.includes('?page=') || u.endsWith('media-releases')).length, 2, 'one listing page, then the end page');
});

test('job — not ready while any listed release is still unread', async () => {
  let n = 0;
  const site = fakeFwo({ release: () => (++n === 3 ? new Error('ETIMEDOUT') : RELEASE) });
  assert.deepEqual(await runJob(site.request), { ok: true });
  assert.equal(fwo.indexReady(), false);
  assert.equal(localIndex.getState(db, fwo.JOB_KEY).progress.unread, 1);
});

test('job — a block page fails the listing; it never ends the copy early', async () => {
  const out = await runJob(fakeFwo({ listing: [LISTING, CHALLENGE] }).request);
  assert.equal(out.ok, false);
  assert.equal(localIndex.getState(db, fwo.JOB_KEY).progress.listingComplete, undefined);
  assert.equal(fwo.indexReady(), false);
});

test('job — a listing much shorter than expected is not marked complete', async () => {
  const out = await runJob(fakeFwo().request, { pageDelayMs: 0, minReleases: 1_500 });
  assert.equal(out.ok, false);
  assert.match(out.error, /listing ended after 10 releases \(expected at least 1500\)/);
});

test('job — five release pages failing in a row stops the run', async () => {
  const out = await runJob(fakeFwo({ release: () => CHALLENGE }).request);
  assert.equal(out.ok, false);
  assert.match(out.error, /5 release pages in a row failed/);
});

test('search — finds a release by a company or person it mentions, in searchFWO\'s result shape', async () => {
  await runJob(fakeFwo().request);
  const company = fwo.searchFwoFromIndex(db, { companyName: 'Barco Traders Pty Ltd' });
  assert.equal(company.source, 'Fair Work Ombudsman');
  assert.equal(company.completeness, 'complete');
  assert.equal(company.results.length, 10, 'the fake site serves this release at all ten listed URLs');
  assert.equal(company.results[0].title, 'Food waste road transport company penalised');
  assert.equal(company.results[0].matchedTerm, 'Barco Traders Pty Ltd');
  const person = fwo.searchFwoFromIndex(db, { companyName: 'Unrelated Pty Ltd', terms: ['Daniel McGettigan'] });
  assert.equal(person.results[0].matchedTerm, 'Daniel McGettigan');
});

test('search — nothing found says what was searched; a generic name is skipped and makes it partial', async () => {
  await runJob(fakeFwo().request);
  const none = fwo.searchFwoFromIndex(db, { companyName: 'Zqxwv Plorkington Pty Ltd' });
  assert.equal(none.summary, 'No Fair Work Ombudsman enforcement outcomes found (searched 1 name(s) against every FWO media release since January 2014)');
  const generic = fwo.searchFwoFromIndex(db, { companyName: 'Building Pty Ltd' });
  assert.equal(generic.completeness, 'partial');
  assert.match(generic.summary, /not searched, too generic to match on: "Building Pty Ltd"/);
});

test('search — a name mentioned in more than 20 releases is ignored unless it is a company name', async () => {
  // 25 distinct releases, all mentioning the Ombudsman by name (as real releases do).
  const listing = [
    LISTING.replace(/href="\/newsroom\/media-releases\/2026-media-releases\/[^"]+"/g, (m, i) => m.replace('-media-release"', `-a${i}"`)),
    LISTING.replace(/href="\/newsroom\/media-releases\/2026-media-releases\/[^"]+"/g, (m, i) => m.replace('-media-release"', `-b${i}"`)),
    LISTING.replace(/href="\/newsroom\/media-releases\/2026-media-releases\/[^"]+"/g, (m, i) => m.replace('-media-release"', `-c${i}"`)),
  ];
  await runJob(fakeFwo({ listing }).request);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM fwo_release').get().n > 20);
  assert.deepEqual(fwo.searchFwoFromIndex(db, { companyName: 'Anna Booth' }).results, [], 'the Ombudsman is named in every release');
  assert.ok(fwo.searchFwoFromIndex(db, { companyName: 'Barco Traders Pty Ltd' }).results.length > 20, 'company names are always matchable');
});
