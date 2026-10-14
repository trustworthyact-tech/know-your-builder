'use strict';

// ACT Supreme Court + ACAT decisions index (DATA_SOURCES_PLAN.md Phase 3). Fixtures are the
// trimmed real Funnelback pages saved for blockPages.test.js (2026-10-13): results pages from
// both sites, a no-results page, and the Cloudflare challenge served to Railway.
const { test, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const localIndex = require('./localIndex');
const runner = require('./runner');
const act = require('./actJudgments');
const { InvalidResponseError } = require('../scrapers/proxyLimiter');

const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'scrapers', 'fixtures', name), 'utf8');
const ACT_HIT = fixture('act-hit.html');
const ACAT_HIT = fixture('acat-hit.html');
const NONE = fixture('act-none.html');
const CHALLENGE = fixture('act-challenge.html');
const ACT_END = fixture('act-list-end.html');
const ACAT_END = fixture('acat-list-end.html');

let db;
beforeEach(() => {
  runner._resetForTests();
  act._resetCacheForTests();
  db = localIndex._openMemoryForTests();
  localIndex._useDatabaseForTests(db);
  mock.restoreAll();
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
});

// A fake proxiedRequest: `pages[site]` is a list of HTML pages served in order of start_rank
// (page 1 = start 1, page 2 = start 501, …); past the end, the no-results page. Applies the
// caller's validate() as the real one does.
function fakeRequest(pages) {
  const calls = [];
  const request = async ({ site, url, validate }) => {
    const start = Number(new URL(url).searchParams.get('start_rank'));
    calls.push(`${site}@${start}`);
    const list = pages[site] ?? [];
    const html = list[(start - 1) / 500] ?? NONE;
    if (html instanceof Error) throw html;
    if (!validate(html)) throw new InvalidResponseError('block page');
    return html;
  };
  return { request, calls };
}

const LIMITS = { pageDelayMs: 0, minTotals: { courts: 1, acat: 1 }, minNewest: 1 };
const NO_PACING = { _sleep: async () => {} };

async function runJob(request, limits = LIMITS) {
  act.register(request, limits);
  return runner.runJobOnce(act.JOB_KEY, NO_PACING);
}

test('parseListing — reads title, citation, date, judge and the full title from the URL', () => {
  const [first] = act.parseListing(ACAT_HIT, 'acat');
  assert.equal(first.title, 'GEOCON CONSTRUCTORS (ACT) PTY LTD v CONSTRUCTION OCCUPATIONS… [2025] ACAT 42');
  assert.equal(first.citation, '[2025] ACAT 42');
  assert.equal(first.decided, '2025-06-16');
  assert.equal(first.judge, 'Senior Member M Orlov');
  assert.match(first.matchText, /construction occupations registrar/, 'the slug restores the part of the title ACAT cut off');
  assert.deepEqual(act.parseListing(NONE, 'courts'), []);
});

test('parseListing — ACNs in a title are recorded as identifiers', () => {
  const html = ACAT_HIT.replace('GEOCON CONSTRUCTORS (ACT) PTY LTD v', 'WILLIAMS v LIVECOMFY REAL ESTATE PTY LTD ACN 656 799 012 v');
  assert.equal(act.parseListing(html, 'acat')[0].acns, '656799012');
});

test('listingTotal — reads each site\'s own count, including on the page past the last result', () => {
  assert.equal(act.listingTotal(ACT_END), 11010);
  assert.equal(act.listingTotal(ACAT_END), 1732);
  assert.equal(act.listingTotal(CHALLENGE), null);
  assert.deepEqual(act.parseListing(ACT_END, 'courts'), []);
});

test('job — a real page past the last result ends the copy (found live: it has a count but no decisions)', async () => {
  // End pages whose stated totals match what the hit pages hold.
  const courtsEnd = ACT_END.replaceAll('11,010', String(act.parseListing(ACT_HIT, 'courts').length));
  const acatEnd = ACAT_END.replaceAll('1,732', String(act.parseListing(ACAT_HIT, 'acat').length));
  const { request } = fakeRequest({ 'act-courts': [ACT_HIT, courtsEnd], acat: [ACAT_HIT, acatEnd] });
  const out = await runJob(request);
  assert.deepEqual(out, { ok: true });
  assert.equal(act.indexReady(), true);
});

test('job — a copy well short of the site\'s own total is not marked complete', async () => {
  // ACT_HIT has a handful of decisions; ACT_END says the site has 11,010.
  const { request } = fakeRequest({ 'act-courts': [ACT_HIT, ACT_END], acat: [ACAT_HIT] });
  const out = await runJob(request);
  assert.equal(out.ok, false);
  assert.match(out.error, /the site reports 11010/);
});

test('isoDate — converts the listing dates', () => {
  assert.equal(act.isoDate('7 Oct 2026'), '2026-10-07');
  assert.equal(act.isoDate(' 16 June 2025 '), '2025-06-16');
  assert.equal(act.isoDate('sometime'), null);
});

test('job — copies every page of both sites, then becomes ready', async () => {
  const { request, calls } = fakeRequest({ 'act-courts': [ACT_HIT, ACT_HIT], acat: [ACAT_HIT] });
  assert.deepEqual(await runJob(request), { ok: true });
  assert.deepEqual(calls, ['act-courts@1', 'act-courts@501', 'act-courts@1001', 'acat@1', 'acat@501']);
  assert.equal(act.indexReady(), true);
  const summary = runner.getIngestionHealth()[0].summary;
  assert.match(summary, /ACT Supreme Court: \d+/);
  assert.match(summary, /ACAT: \d+/);
});

test('job — once copied, a run fetches only each site\'s newest page', async () => {
  const site = fakeRequest({ 'act-courts': [ACT_HIT], acat: [ACAT_HIT] });
  await runJob(site.request);
  runner._resetForTests();
  const again = fakeRequest({ 'act-courts': [ACT_HIT], acat: [ACAT_HIT] });
  await runJob(again.request);
  assert.deepEqual(again.calls, ['act-courts@1', 'acat@1']);
});

test('job — a block page fails the run; it never ends the copy early or marks it complete', async () => {
  const { request } = fakeRequest({ 'act-courts': [ACT_HIT, CHALLENGE], acat: [ACAT_HIT] });
  const out = await runJob(request);
  assert.equal(out.ok, false);
  assert.equal(act.indexReady(), false);
  const { progress } = localIndex.getState(db, act.JOB_KEY);
  assert.equal(progress.courts.nextStart, 501, 'the next run resumes at the page that failed');
});

test('job — a full copy smaller than expected is not marked complete', async () => {
  const { request } = fakeRequest({ 'act-courts': [ACT_HIT], acat: [ACAT_HIT] });
  const out = await runJob(request, { ...LIMITS, minTotals: { courts: 5_000, acat: 1 } });
  assert.equal(out.ok, false);
  assert.match(out.error, /courts: a full copy listed \d+ decisions \(expected at least 5000\)/);
  assert.equal(act.indexReady(), false);
});

test('search — matches titles with the live search\'s own rule, across both sites, with the same result shape', async () => {
  await runJob(fakeRequest({ 'act-courts': [ACT_HIT], acat: [ACAT_HIT] }).request);
  const out = act.searchActFromIndex(db, { companyName: 'Geocon Constructors (ACT) Pty Ltd', terms: [] });
  assert.equal(out.source, 'ACT Courts & ACAT');
  assert.equal(out.completeness, 'complete');
  assert.ok(out.results.length >= 2);
  assert.ok(out.results.some((r) => r.url.includes('acat.act.gov.au')));
  assert.ok(out.results.some((r) => r.url.includes('courts.act.gov.au')));
  assert.ok(out.results.every((r) => r.matchedTerm && r.jurisdiction === 'ACT'));
  assert.match(out.summary, /^Found \d+ case\(s\) in ACT courts and tribunals \(searched 1 name\(s\)/);
});

test('search — nothing found says what was searched', async () => {
  await runJob(fakeRequest({ 'act-courts': [ACT_HIT], acat: [ACAT_HIT] }).request);
  const out = act.searchActFromIndex(db, { companyName: 'Zqxwv Plorkington Pty Ltd', terms: ['Someone Else'] });
  assert.deepEqual(out.results, []);
  assert.equal(out.summary, 'No cases found in ACT courts and tribunals (searched 2 name(s) against every ACT Supreme Court judgment and ACAT decision title)');
});

test('search — a name too generic to match on is skipped, and the result is partial, never clean', async () => {
  await runJob(fakeRequest({ 'act-courts': [ACT_HIT], acat: [ACAT_HIT] }).request);
  const out = act.searchActFromIndex(db, { companyName: 'Building Pty Ltd', terms: ['Geocon'] });
  assert.ok(out.results.length > 0, 'the distinctive name is still searched');
  assert.ok(out.results.every((r) => r.matchedTerm === 'Geocon'), 'the generic name matched nothing');
  assert.equal(out.completeness, 'partial');
  assert.match(out.summary, /not searched, too generic to match on: "Building"/);
});

test('search — a decision whose title carries the entity\'s ACN matches even under another name', async () => {
  const html = ACAT_HIT.replace('GEOCON CONSTRUCTORS (ACT) PTY LTD v', 'WILLIAMS v FORMER NAME PTY LTD ACN 656 799 012 v');
  await runJob(fakeRequest({ 'act-courts': [ACT_HIT], acat: [html] }).request);
  const out = act.searchActFromIndex(db, { companyName: 'Livecomfy Real Estate Pty Ltd', acn: '656799012' });
  const hit = out.results.find((r) => /FORMER NAME/.test(r.title));
  assert.ok(hit);
  assert.equal(hit.metadata.MatchedBy, 'ACN in case title');
  assert.equal(hit.matchedTerm, 'Livecomfy Real Estate Pty Ltd');
});

test('search — stale once the last successful run is older than 72 hours', async () => {
  await runJob(fakeRequest({ 'act-courts': [ACT_HIT], acat: [ACAT_HIT] }).request);
  const state = localIndex.getState(db, act.JOB_KEY);
  localIndex.saveState(db, { ...state, lastSuccessAt: new Date(Date.now() - 73 * 3600 * 1000).toISOString() });
  act._resetCacheForTests();
  const out = act.searchActFromIndex(db, { companyName: 'Geocon' });
  assert.equal(out.completeness, 'stale');
  assert.ok(out.asOf);
});
