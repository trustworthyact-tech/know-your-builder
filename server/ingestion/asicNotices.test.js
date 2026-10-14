'use strict';

// ASIC published notices index (DATA_SOURCES_PLAN.md Phase 3) and the shared ingestion runner.
// Fixtures in scrapers/fixtures are trimmed real pages saved 2026-10-14: a joint notice naming
// two companies, a single-company meeting notice, and three entries of a real monthly sitemap.
const { test, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const localIndex = require('./localIndex');
const runner = require('./runner');
const asicNotices = require('./asicNotices');

const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'scrapers', 'fixtures', name), 'utf8');
const JOINT = fixture('asic-notice-joint.html');
const MEETING = fixture('asic-notice-meeting.html');
const SITEMAP_SAMPLE = fixture('asic-sitemap-sample.xml');

const BASE = 'https://publishednotices.asic.gov.au';
const noticeUrl = (slug, acn, id) => `${BASE}/browsesearch-notices/notice-details/${slug}-${acn}/${id}`;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let db;
beforeEach(() => {
  runner._resetForTests();
  db = localIndex._openMemoryForTests();
  localIndex._useDatabaseForTests(db);
  mock.restoreAll();
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
});

// ── Parsing ───────────────────────────────────────────────────────────────────────────────

test('parseSitemap — reads id, ACN, name and date from each notice URL', () => {
  const entries = asicNotices.parseSitemap(SITEMAP_SAMPLE);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], {
    id: '4c6b686c-123b-4cad-a832-f977cbf5143b',
    url: `${BASE}/browsesearch-notices/notice-details/Okami-Distribution-Pty-Ltd-614594731/4c6b686c-123b-4cad-a832-f977cbf5143b`,
    acn: '614594731',
    name: 'Okami Distribution Pty Ltd',
    listedDate: '2026-08-31',
  });
  assert.equal(entries[2].name, 'ACN 160 835 941 Pty Ltd');
});

test('parseSitemapIndex — lists monthly sitemaps in order with their lastmod', () => {
  const xml = `<sitemapindex><sitemap><loc>${BASE}/sitemap/sitemap-1012.xml</loc><lastmod>2012-10-19</lastmod></sitemap>
    <sitemap><loc>${BASE}/sitemap/sitemap-0326-1.xml</loc><lastmod>2026-03-31</lastmod></sitemap></sitemapindex>`;
  assert.deepEqual(asicNotices.parseSitemapIndex(xml), [
    { name: '1012', url: `${BASE}/sitemap/sitemap-1012.xml`, lastmod: '2012-10-19' },
    { name: '0326-1', url: `${BASE}/sitemap/sitemap-0326-1.xml`, lastmod: '2026-03-31' },
  ]);
});

test('parseNoticePage — a joint notice yields every company and ACN, the status and the date', () => {
  const facts = asicNotices.parseNoticePage(JOINT);
  assert.equal(facts.title, 'NOTICE INVITING FORMAL PROOF OF DEBT OR CLAIM');
  assert.equal(facts.legislation, 'Corporations Act 2001 — Subregulation 5.6.48 (2) and (3)');
  assert.deepEqual(facts.companies, [
    { name: 'Projex Management & Construction Pty Ltd', acn: '114605408' },
    { name: 'Nicheliving Holdings Ltd', acn: '151663946' },
  ]);
  assert.equal(facts.status, 'Subject to a Deed of Company Arrangement');
  assert.equal(facts.noticeDate, '31 August 2026');
  assert.equal(facts.isAto, false);
});

test('parseNoticePage — a WAF challenge or any other page is not a notice', () => {
  assert.equal(asicNotices.parseNoticePage(''), null);
  assert.equal(asicNotices.parseNoticePage('<html><title>Please Wait...</title></html>'), null);
  assert.equal(asicNotices.parseNoticePage(fixture('act-challenge.html')), null);
  assert.equal(asicNotices.parseNoticePage(undefined), null);
});

test('parseNoticePage — an ATO tax debt notice is classified from its title and legislation line', () => {
  const ato = MEETING.replace(/<div class="boxinnertop">[\s\S]*?<\/div>/, '<div class="boxinnertop">Taxation Administration Act 1953<br>Section 260-45</div>');
  assert.equal(asicNotices.parseNoticePage(ato).isAto, true);
  assert.equal(asicNotices.parseNoticePage(MEETING).isAto, false, 'an insolvency notice is not an ATO notice');
});

// ── The job ───────────────────────────────────────────────────────────────────────────────

// A fake ASIC site: `months` maps sitemap name → [{ slug, acn, id, date }]; `pages` maps notice id
// → HTML (or an Error). Records every URL requested.
function fakeAsic({ months, pages = {}, indexOverride }) {
  const requested = [];
  const get = async (url) => {
    requested.push(url);
    if (url.endsWith('sitemap-index.xml')) {
      if (indexOverride) return { data: indexOverride };
      const body = Object.keys(months)
        .map((m) => `<sitemap><loc>${BASE}/sitemap/sitemap-${m}.xml</loc><lastmod>2026-01-01</lastmod></sitemap>`)
        .join('');
      return { data: `<sitemapindex>${body}</sitemapindex>` };
    }
    const month = url.match(/sitemap-([0-9-]+)\.xml$/)?.[1];
    if (month) {
      const body = months[month]
        .map((e) => `<url><loc>${noticeUrl(e.slug, e.acn, e.id)}</loc><lastmod>${e.date}</lastmod></url>`)
        .join('');
      return { data: `<urlset>${body}</urlset>` };
    }
    const id = url.split('/').pop();
    const page = pages[id];
    if (page instanceof Error) throw page;
    if (page === undefined) throw Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } });
    return { data: page };
  };
  return { get, requested };
}

const LIMITS = { minSitemaps: 2, minUrls: 1 };
const NO_PACING = { _sleep: async () => {} };

function standardSite(extraPages = {}) {
  return fakeAsic({
    months: {
      '0826': [{ slug: 'Okami-Distribution-Pty-Ltd', acn: '614594731', id: uuid(1), date: '2026-08-02' }],
      '0926': [
        { slug: 'Nicheliving-Holdings-Ltd', acn: '151663946', id: uuid(2), date: '2026-09-01' },
        { slug: 'Okami-Distribution-Pty-Ltd', acn: '614594731', id: uuid(3), date: '2026-09-03' },
      ],
    },
    pages: { [uuid(1)]: MEETING, [uuid(2)]: JOINT, [uuid(3)]: MEETING, ...extraPages },
  });
}

async function runJob(http) {
  asicNotices.register(http, LIMITS);
  return runner.runJobOnce(asicNotices.JOB_KEY, NO_PACING);
}

test('job — copies every sitemap, reads every page, and becomes ready', async () => {
  const site = standardSite();
  assert.equal(asicNotices.indexReady(), false);
  assert.deepEqual(await runJob(site), { ok: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM asic_notice').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM asic_notice WHERE enriched_at IS NULL').get().n, 0);
  assert.equal(asicNotices.indexReady(), true);
  const pageOrder = site.requested.filter((u) => u.includes('notice-details')).map((u) => u.split('/').pop());
  assert.deepEqual(pageOrder, [uuid(3), uuid(2), uuid(1)], 'newest notices are read first');
  const health = runner.getIngestionHealth()[0];
  assert.equal(health.ready, true);
  assert.equal(health.lastError, null);
  assert.match(health.summary, /3 notices from 2 monthly sitemaps; 3 pages read/);
});

test('job — a joint notice makes its second company findable by ACN', async () => {
  await runJob(standardSite());
  const out = await asicNotices.searchNoticesFromIndex(db, { kind: 'insolvency', acn: '114605408' });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].metadata.Entity, 'Projex Management & Construction Pty Ltd');
  assert.equal(out.results[0].metadata['Notice Type'], 'NOTICE INVITING FORMAL PROOF OF DEBT OR CLAIM');
  assert.equal(out.results[0].metadata.Status, 'Subject to a Deed of Company Arrangement');
  assert.equal(out.results[0].date, '31 August 2026');
});

test('job — an index listing too few sitemaps fails and writes nothing', async () => {
  const site = fakeAsic({ months: {}, indexOverride: '<sitemapindex></sitemapindex>' });
  const out = await runJob(site);
  assert.equal(out.ok, false);
  assert.match(out.error, /listed 0 sitemaps/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM asic_notice').get().n, 0);
  assert.equal(asicNotices.indexReady(), false);
  assert.equal(runner.getIngestionHealth()[0].consecutiveFailures, 1);
});

test('job — a completed month with too few notices stops the run; the copy is never shrunk', async () => {
  const site = standardSite();
  await runJob(site);
  runner._resetForTests();
  const shrunk = fakeAsic({ months: { '0726': [], '0826': [], '0926': [] } });
  asicNotices.register(shrunk, { minSitemaps: 2, minUrls: 1 });
  const out = await runner.runJobOnce(asicNotices.JOB_KEY, NO_PACING);
  assert.equal(out.ok, false);
  assert.match(out.error, /sitemap 0726 had 0 notices/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM asic_notice').get().n, 3, 'earlier rows are kept');
});

test('job — notice pages older than the read-back window are not read in the background', async () => {
  process.env.ASIC_NOTICES_READ_BACK_DAYS = '30';
  try {
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const site = fakeAsic({
      months: { '0825': [{ slug: 'Old-Co-Pty-Ltd', acn: '222222222', id: uuid(30), date: old }], '0926': [{ slug: 'New-Co-Pty-Ltd', acn: '333333333', id: uuid(31), date: recent }] },
      pages: { [uuid(30)]: MEETING, [uuid(31)]: MEETING },
    });
    await runJob(site);
    const pages = site.requested.filter((u) => u.includes('notice-details')).map((u) => u.split('/').pop());
    assert.deepEqual(pages, [uuid(31)]);
    const out = await asicNotices.searchNoticesFromIndex(db, { kind: 'insolvency', acn: '222222222' }, { _http: site });
    assert.equal(out.results.length, 1, 'an old notice is still found by its main ACN, and read when it matches');
    const none = await asicNotices.searchNoticesFromIndex(db, { kind: 'insolvency', acn: '999999999' });
    assert.match(none.summary, /Notices naming several companies are checked in full from .*; older ones only under their main company\./);
  } finally {
    delete process.env.ASIC_NOTICES_READ_BACK_DAYS;
  }
});

test('job — five notice pages failing in a row stops the run with an error', async () => {
  const months = { '0826': [], '0926': Array.from({ length: 7 }, (_, i) => ({ slug: 'X-Pty-Ltd', acn: '111111111', id: uuid(i + 10), date: `2026-09-0${i + 1}` })) };
  const out = await runJob(fakeAsic({ months, pages: {} }));
  assert.equal(out.ok, false);
  assert.match(out.error, /5 notice pages in a row failed \(last: 404\)/);
});

test('job — a WAF challenge served in place of a notice page counts as a failure, not a notice', async () => {
  const months = { '0826': [], '0926': [{ slug: 'X-Pty-Ltd', acn: '111111111', id: uuid(20), date: '2026-09-01' }] };
  await runJob(fakeAsic({ months, pages: { [uuid(20)]: '<html><title>Please Wait...</title></html>' } }));
  assert.equal(db.prepare('SELECT enriched_at FROM asic_notice WHERE id = ?').get(uuid(20)).enriched_at, null);
});

// ── Search time ──────────────────────────────────────────────────────────────────────────

test('search — matches by ACN; ATO results only include ATO notices', async () => {
  await runJob(standardSite());
  const insolvency = await asicNotices.searchNoticesFromIndex(db, { kind: 'insolvency', acn: '614 594 731' });
  assert.equal(insolvency.results.length, 2);
  assert.equal(insolvency.completeness, undefined);
  assert.match(insolvency.summary, /2 ASIC published notice\(s\) found for ACN 614594731 \(insolvency, winding-up and deregistration notices since August 2026\)/);
  const ato = await asicNotices.searchNoticesFromIndex(db, { kind: 'ato', acn: '614594731' });
  assert.equal(ato.results.length, 0);
  assert.match(ato.summary, /No ATO tax debt notices found for ACN 614594731/);
});

test('search — nothing found is worded as what was searched, never as a pass', async () => {
  await runJob(standardSite());
  const out = await asicNotices.searchNoticesFromIndex(db, { kind: 'insolvency', acn: '999999999' });
  assert.deepEqual(out.results, []);
  assert.equal(out.summary, 'No ASIC published notices found for ACN 999999999 (all notices since August 2026).', 'the date comes from the oldest notice actually copied');
});

test('search — a matched notice not yet read is read at search time', async () => {
  const site = standardSite();
  await runJob(site);
  db.prepare('UPDATE asic_notice SET enriched_at = NULL, notice_type = NULL WHERE id = ?').run(uuid(3));
  const out = await asicNotices.searchNoticesFromIndex(db, { kind: 'insolvency', acn: '614594731' }, { _http: site });
  assert.equal(out.completeness, undefined);
  assert.ok(out.results.every((r) => r.metadata['Notice Type'] === 'NOTICE OF MEETING OF ELIGIBLE EMPLOYEE CREDITORS'));
});

test('search — a matched notice that cannot be read is shown, and the result is partial', async () => {
  const site = standardSite();
  await runJob(site);
  db.prepare('UPDATE asic_notice SET enriched_at = NULL, notice_type = NULL WHERE id = ?').run(uuid(3));
  const broken = fakeAsic({ months: {}, pages: { [uuid(3)]: new Error('ETIMEDOUT') } });
  const out = await asicNotices.searchNoticesFromIndex(db, { kind: 'insolvency', acn: '614594731' }, { _http: broken });
  assert.equal(out.completeness, 'partial');
  assert.equal(out.results.length, 2);
  assert.ok(out.results.some((r) => /not yet read/.test(r.metadata['Notice Type'])));
  assert.match(out.summary, /1 matched notice\(s\) could not be opened/);
});

test('search — linked companies are tagged so they never count as the entity\'s own notices', async () => {
  await runJob(standardSite());
  const linked = [{ name: 'Okami Distribution Pty Ltd', acn: '614594731', confidence: 'confirmed', person: 'Jane Citizen', via: 'NSW licence' }];
  const out = await asicNotices.searchNoticesFromIndex(db, { kind: 'insolvency', acn: '151663946', linked });
  const own = out.results.filter((r) => !r.metadata.LinkedCompany);
  const theirs = out.results.filter((r) => r.metadata.LinkedCompany);
  assert.equal(own.length, 1);
  assert.equal(theirs.length, 2);
  assert.equal(theirs[0].metadata.MatchedBy, 'Linked company — via Jane Citizen');
  assert.match(out.summary, /1 ASIC published notice\(s\) found.*Also 2 for linked companies/);
});

test('search — with no ACN, an exact legal-name match is shown as name only — verify', async () => {
  await runJob(standardSite());
  const out = await asicNotices.searchNoticesFromIndex(db, { kind: 'insolvency', name: 'Nicheliving Holdings Limited' });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].metadata.MatchedBy, 'Name only — verify');
});

test('search — an index whose last successful run is older than 48 hours is stale', async () => {
  await runJob(standardSite());
  const state = localIndex.getState(db, asicNotices.JOB_KEY);
  localIndex.saveState(db, { ...state, lastSuccessAt: new Date(Date.now() - 49 * 3600 * 1000).toISOString() });
  const out = await asicNotices.searchNoticesFromIndex(db, { kind: 'insolvency', acn: '614594731' });
  assert.equal(out.completeness, 'stale');
  assert.equal(out.asOf, localIndex.getState(db, asicNotices.JOB_KEY).lastSuccessAt);
});

test('search — summaries say how far back joint notices are covered while history is still being read', async () => {
  const site = standardSite();
  await runJob(site);
  const state = localIndex.getState(db, asicNotices.JOB_KEY);
  localIndex.saveState(db, { ...state, progress: { ...state.progress, coveredFrom: '2012-10-19', unreadFrom: '2019-05-31' } });
  const out = await asicNotices.searchNoticesFromIndex(db, { kind: 'insolvency', acn: '999999999' });
  assert.equal(
    out.summary,
    'No ASIC published notices found for ACN 999999999 (all notices since October 2012). Notices naming several companies are checked in full from 31 May 2019; older ones only under their main company.'
  );
});

// ── Runner ───────────────────────────────────────────────────────────────────────────────

test('runner — a job never overlaps itself, and a throwing job never throws to the caller', async () => {
  let release;
  let calls = 0;
  runner.registerJob({ key: 'slow', intervalMs: 1, freshnessSlaMs: 1, run: () => { calls++; return new Promise((r) => { release = r; }); } });
  const a = runner.runJobOnce('slow');
  const b = runner.runJobOnce('slow');
  release();
  assert.deepEqual(await a, { ok: true });
  assert.equal(await b, await a);
  assert.equal(calls, 1);
  runner.registerJob({ key: 'boom', intervalMs: 1, freshnessSlaMs: 1, run: () => { throw new Error('kaput'); } });
  assert.deepEqual(await runner.runJobOnce('boom'), { ok: false, error: 'kaput' });
});

test('runner — jobs wait while a search is running', async () => {
  let ran = false;
  runner.registerJob({ key: 'polite', intervalMs: 1, freshnessSlaMs: 1, run: async (ctx) => { await ctx.yieldToSearches(5_000); ran = true; } });
  runner.searchStarted();
  const run = runner.runJobOnce('polite');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(ran, false);
  runner.searchEnded();
  await run;
  assert.equal(ran, true);
});

test('runner — LOCAL_INDEX_DISABLED sends a ready index\'s checks back to the live scraper', async () => {
  await runJob(standardSite());
  assert.equal(asicNotices.indexReady(), true);
  process.env.LOCAL_INDEX_DISABLED = 'asicNotices';
  try {
    assert.equal(asicNotices.indexReady(), false);
  } finally {
    delete process.env.LOCAL_INDEX_DISABLED;
  }
});

test('runner — a job that crawls through the proxy starts only when named in PROXY_INGESTION_JOBS', () => {
  const started = [];
  const timers = { _setTimeout: (fn, ms) => started.push(ms), _setInterval: () => ({ unref() {} }) };
  runner.registerJob({ key: 'proxied', scraperKeys: ['fwo'], needsProxy: true, intervalMs: 1, freshnessSlaMs: 1, firstRunDelayMs: 5, run: async () => {} });
  runner.startIngestionJobs([{ key: 'fwo', inScope: true }], timers);
  assert.deepEqual(started, []);
  assert.equal(runner.getIngestionHealth()[0].started, false);
  process.env.PROXY_INGESTION_JOBS = 'proxied';
  try {
    runner.startIngestionJobs([{ key: 'fwo', inScope: true }], timers);
    assert.deepEqual(started, [5]);
  } finally {
    delete process.env.PROXY_INGESTION_JOBS;
  }
});

test('runner — a job starts only when one of its checks is in launch scope', () => {
  const started = [];
  const timers = { _setTimeout: (fn, ms) => started.push(ms), _setInterval: () => ({ unref() {} }) };
  runner.registerJob({ key: 'outOfScope', scraperKeys: ['vicBpc'], intervalMs: 1, freshnessSlaMs: 1, run: async () => {} });
  runner.registerJob({ key: 'inScope', scraperKeys: ['atoDebt'], intervalMs: 1, freshnessSlaMs: 1, firstRunDelayMs: 7, run: async () => {} });
  runner.startIngestionJobs([{ key: 'vicBpc', inScope: false }, { key: 'atoDebt', inScope: true }], timers);
  assert.deepEqual(started, [7]);
});
