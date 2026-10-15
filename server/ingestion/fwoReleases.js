'use strict';

// Facts-only index of Fair Work Ombudsman media releases (DATA_SOURCES_PLAN.md Phase 3),
// replacing fwo's live per-name searches through ScrapeOps.
//
// Where the facts come from (checked 2026-10-14):
// - /newsroom/media-releases lists every release newest first, 10 per page (the size can't be
//   raised), back to January 2014: 213 pages, about 2,133 releases. Each item gives the title,
//   link and date. robots.txt allows the listing and the release pages (it disallows the search
//   page the live check uses).
// - Each release page gives the full text, which is read once to record facts: the names it
//   mentions (companies, trading names, people) and whether it reports an enforcement outcome
//   (penalty, enforceable undertaking, litigation, compliance notice, back-pay order). The text
//   itself is not stored: FWO licenses its material for non-commercial use only, and names and
//   outcomes are facts.
// - fairwork.gov.au blocks Railway (Akamai), so requests go through proxyLimiter.proxiedRequest,
//   i.e. ScrapeOps today. A full copy is about 2,350 requests; after that a run fetches the
//   newest listing page and any new releases (a few a week).
//
// Matching: the live check required every significant word of the name in a search result's
// title and excerpt. Here the name must appear as a phrase inside one of the release's
// mentioned names (or its title), using courtRecords.js's titleMatchesTerm, the same rule the
// court index uses. Names mentioned in more than COMMON_NAME_RELEASES releases (FWO officials,
// courts, cities) are ignored unless they carry a company suffix, so a person who shares an
// official's name doesn't match every release.
//
// The index is ready only once every listed release has been read: unlike ASIC notices, a
// release can't be matched before its names are known.

const cheerio = require('cheerio');
const { registerJob, freshness, isReady, retrying } = require('./runner');
const { transaction, getState } = require('./localIndex');
const { proxiedRequest } = require('../scrapers/proxyLimiter');
const { isEnforcementOutcome } = require('../scrapers/fwo');
const { titleMatchesTerm, isFilterableTerm, stripCompanySuffix } = require('../scrapers/courtRecords');
const { significantWords, normaliseEntityName } = require('../scrapers/licenceMatching');

const JOB_KEY = 'fwoReleases';
const BASE = 'https://www.fairwork.gov.au';
const LISTING_URL = (page) => `${BASE}/newsroom/media-releases${page > 0 ? `?page=${page}` : ''}`;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  Referer: `${BASE}/newsroom`,
};
const INTERVAL_MS = 6 * 60 * 60 * 1000;
const FRESHNESS_SLA_MS = 72 * 60 * 60 * 1000;
const PAGE_DELAY_MS = 3_000;
const READ_PER_RUN = () => parseInt(process.env.FWO_READ_PER_RUN, 10) || 400;
const MIN_RELEASES = 1_500; // about 2,133 listed on 2026-10-14
const MAX_CONSECUTIVE_FAILURES = 5;
const COMMON_NAME_RELEASES = 20;
const COMPANY_SUFFIX = /\b(pty|ltd|limited|inc|incorporated|corporation|group|holdings|trust)\b/i;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fwo_release (
  url        TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  published  TEXT,
  read_at    TEXT,
  enforcement INTEGER,
  names      TEXT
) WITHOUT ROWID;
`;

function ensureSchema(db) {
  db.exec(SCHEMA);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function isoDate(text) {
  const m = String(text ?? '').match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// ── Parsing ───────────────────────────────────────────────────────────────────────────────

const isListingPage = (html) => typeof html === 'string' && html.includes('id="news-media-releases"');

function parseListing(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('#news-media-releases .views-row').each((_, row) => {
    const link = $(row).find('h2 a').first();
    const href = link.attr('href');
    const title = link.text().replace(/\s+/g, ' ').trim();
    if (!href || !title) return;
    out.push({ url: href.startsWith('http') ? href : `${BASE}${href}`, title, published: isoDate($(row).find('.date-line').text()) });
  });
  return out;
}

// Runs of capitalised words — company and trading names, people, places — as they appear in the
// text. Lower-case joining words (and, of, the, &, t/a, trading as) are kept inside a run when a
// capitalised word follows. A leading "The" is dropped. Returns distinct names, longest first.
const JOINERS = new Set(['and', 'of', 'the', '&', 'de', 'da', 'van', 'von', 'la', 'le', 'du', 'for']);
function extractNames(text) {
  const tokens = String(text ?? '').replace(/[’]/g, "'").match(/[A-Za-z0-9][A-Za-z0-9'.\-&/]*|&|[(),;:"“”]/g) || [];
  const names = new Set();
  let run = [];
  const flush = () => {
    while (run.length && JOINERS.has(run[run.length - 1].toLowerCase())) run.pop();
    if (run.length && /^the$/i.test(run[0])) run.shift();
    const name = run.join(' ').replace(/[.,]+$/, '').trim();
    if (name && /[A-Za-z]/.test(name) && !(run.length === 1 && name.length < 3)) names.add(name);
    run = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const capitalised = /^[A-Z0-9]/.test(t) && /[A-Za-z]/.test(t);
    if (capitalised) {
      run.push(t.replace(/[.,;:]+$/, ''));
      if (/[.;:]$/.test(t) && !/^(Pty|Ltd|Co|Mr|Ms|Mrs|Dr|No|St)\.?$/.test(t.replace(/[.;:]+$/, ''))) flush();
    } else if (run.length && JOINERS.has(t.toLowerCase()) && /^[A-Z0-9]/.test(tokens[i + 1] || '')) {
      run.push(t);
    } else {
      flush();
    }
  }
  flush();
  return [...names].sort((a, b) => b.length - a.length);
}

// A release page → facts, or null if it isn't one (a block page, an error page).
function parseRelease(html) {
  if (typeof html !== 'string') return null;
  const $ = cheerio.load(html);
  const title = $('h1.page-title').first().text().replace(/\s+/g, ' ').trim();
  const body = $('.node--type-news-media-releases .field--name-body').first();
  if (!title || !body.length) return null;
  body.find('p, li, h2, h3, h4, br').after(' ; ');
  const text = body.text().replace(/\s+/g, ' ');
  return {
    title,
    published: isoDate(text.slice(0, 80)),
    enforcement: isEnforcementOutcome(`${title} ${text}`),
    names: extractNames(text),
  };
}

// ── The job ───────────────────────────────────────────────────────────────────────────────

// Each page gets up to 3 attempts (see runner.retrying); listing pages are ~430KB and can take
// over a minute through ScrapeOps.
async function fetchHtml(ctx, _request, url, validate, label, attempts = 3) {
  return retrying(ctx, () => _request({ site: 'fwo', url, headers: HEADERS, validate, label, deadlineMs: 90_000, directTimeoutMs: 5_000 }), { attempts });
}

function insertListed(db, items) {
  const stmt = db.prepare(
    `INSERT INTO fwo_release (url, title, published) VALUES (?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET title = excluded.title, published = COALESCE(excluded.published, fwo_release.published)`
  );
  transaction(db, () => {
    for (const i of items) stmt.run(i.url, i.title, i.published);
  });
}

function saveRead(db, url, facts) {
  db.prepare('UPDATE fwo_release SET read_at = ?, title = ?, published = COALESCE(published, ?), enforcement = ?, names = ? WHERE url = ?').run(
    new Date().toISOString(),
    facts.title,
    facts.published,
    facts.enforcement ? 1 : 0,
    JSON.stringify(facts.names),
    url
  );
}

function makeRun(_request = proxiedRequest, { pageDelayMs = PAGE_DELAY_MS, minReleases = MIN_RELEASES } = {}) {
  return async (ctx) => {
    const { db } = ctx;
    ensureSchema(db);
    const p = ctx.progress;

    // 1. Listing: every page once (resuming), then just the newest two pages each run.
    if (!p.listingComplete) {
      p.nextPage ??= 0;
      for (;;) {
        await ctx.yieldToSearches();
        const items = parseListing(await fetchHtml(ctx, _request, LISTING_URL(p.nextPage), isListingPage, 'fwoReleases listing'));
        if (items.length === 0) break;
        insertListed(db, items);
        p.nextPage++;
        ctx.checkpoint();
        await ctx.pace(pageDelayMs);
      }
      const listed = db.prepare('SELECT COUNT(*) AS n FROM fwo_release').get().n;
      if (listed < minReleases) {
        p.nextPage = 0;
        throw new Error(`listing ended after ${listed} releases (expected at least ${minReleases}) — not marked complete`);
      }
      p.listingComplete = true;
      p.nextPage = 0;
      ctx.log(`listing complete: ${listed} releases`);
    } else {
      for (const page of [0, 1]) {
        const items = parseListing(await fetchHtml(ctx, _request, LISTING_URL(page), isListingPage, 'fwoReleases listing'));
        if (page === 0 && items.length === 0) throw new Error('newest listing page had no releases');
        insertListed(db, items);
        await ctx.pace(pageDelayMs);
      }
    }

    // 2. Read unread releases, newest first.
    const batch = db.prepare('SELECT url FROM fwo_release WHERE read_at IS NULL ORDER BY published DESC LIMIT ?').all(READ_PER_RUN());
    let read = 0;
    let failures = 0;
    for (const { url } of batch) {
      await ctx.yieldToSearches();
      try {
        const facts = parseRelease(await fetchHtml(ctx, _request, url, (html) => parseRelease(html) != null, 'fwoReleases release', 2));
        saveRead(db, url, facts);
        read++;
        failures = 0;
      } catch (err) {
        failures++;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          throw new Error(`${failures} release pages in a row failed (last: ${err.response?.status || err.code || err.message}) — stopped after reading ${read}`);
        }
      }
      await ctx.pace(pageDelayMs);
    }
    p.unread = db.prepare('SELECT COUNT(*) AS n FROM fwo_release WHERE read_at IS NULL').get().n;
    if (read) ctx.log(`read ${read} release(s); ${p.unread} unread`);
  };
}

function describe(db) {
  ensureSchema(db);
  const { n, unread, oldest } = db
    .prepare('SELECT COUNT(*) AS n, SUM(read_at IS NULL) AS unread, MIN(published) AS oldest FROM fwo_release')
    .get();
  return `${n.toLocaleString()} releases listed (from ${oldest ?? '?'}); ${(n - (unread ?? 0)).toLocaleString()} read`;
}

function register(_request, options) {
  registerJob({
    key: JOB_KEY,
    label: 'Fair Work Ombudsman media releases',
    scraperKeys: ['fwo'],
    needsProxy: true,
    intervalMs: INTERVAL_MS,
    freshnessSlaMs: FRESHNESS_SLA_MS,
    firstRunDelayMs: 90_000,
    run: makeRun(_request, options),
    describe,
    // Ready once the whole listing is copied and every release has been read.
    isReady: (db) => {
      const { progress } = getState(db, JOB_KEY);
      return progress.listingComplete === true && progress.unread === 0;
    },
  });
}

// ── Search time ──────────────────────────────────────────────────────────────────────────

let cache = { key: null, releases: [] };
function enforcementReleases(db) {
  const key = getState(db, JOB_KEY).lastSuccessAt;
  if (cache.key !== key || cache.releases.length === 0) {
    ensureSchema(db);
    const rows = db.prepare('SELECT url, title, published, names FROM fwo_release WHERE enforcement = 1').all();
    const releases = rows.map((r) => ({ ...r, names: JSON.parse(r.names || '[]') }));
    const df = new Map();
    for (const r of releases) for (const n of new Set(r.names.map((x) => x.toLowerCase()))) df.set(n, (df.get(n) ?? 0) + 1);
    for (const r of releases) {
      r.matchable = r.names.filter((n) => COMPANY_SUFFIX.test(n) || (df.get(n.toLowerCase()) ?? 0) <= COMMON_NAME_RELEASES);
    }
    cache = { key, releases };
  }
  return cache.releases;
}

// A searched name matches a mentioned name when every significant word of it appears there as a
// whole word ("Daniel McGettigan" in "Daniel John McGettigan"; "Barco Traders" in "Barco Traders
// Pty Ltd"). A one-word name uses titleMatchesTerm, which ignores common words.
function nameMatches(mentioned, term) {
  const words = significantWords(term);
  if (words.length <= 1) return titleMatchesTerm(mentioned, stripCompanySuffix(term));
  const hay = ` ${normaliseEntityName(mentioned)} `;
  return words.every((w) => hay.includes(` ${w} `));
}

// Same result shape as fwo.js's searchFWO.
function searchFwoFromIndex(db, { companyName, terms = [] }) {
  // Terms with no distinctive words would match every release (see isFilterableTerm), so they're
  // skipped — and the result is then partial, never a clean "nothing found".
  const allTerms = [...new Set([companyName, ...terms].filter(Boolean))];
  const searchTerms = allTerms.filter((t) => isFilterableTerm(stripCompanySuffix(t)));
  const skipped = allTerms.filter((t) => !searchTerms.includes(t));
  const results = [];
  for (const r of enforcementReleases(db)) {
    const matchedTerm = searchTerms.find((term) => nameMatches(r.title, term) || r.matchable.some((n) => nameMatches(n, term)));
    if (!matchedTerm) continue;
    results.push({
      title: r.title,
      url: r.url,
      date: r.published || '',
      status: 'FWO enforcement outcome',
      description: 'Fair Work Ombudsman enforcement action or litigation outcome',
      jurisdiction: 'Federal',
      matchedTerm,
      metadata: { Source: 'Fair Work Ombudsman', Date: r.published || '' },
    });
  }
  results.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const { stale, asOf } = freshness(JOB_KEY);
  return {
    source: 'Fair Work Ombudsman',
    jurisdiction: 'Federal',
    category: 'payment',
    results,
    searchUrl: `${BASE}/newsroom/media-releases`,
    completeness: stale ? 'stale' : skipped.length > 0 ? 'partial' : 'complete',
    ...(stale && asOf ? { asOf } : {}),
    summary:
      (results.length > 0
        ? `${results.length} FWO enforcement outcome(s) found — wage underpayment, litigation, or compliance action`
        : 'No Fair Work Ombudsman enforcement outcomes found') +
      ` (searched ${searchTerms.length} name(s) against every FWO media release since January 2014)` +
      (skipped.length > 0 ? `; not searched, too generic to match on: ${skipped.map((t) => `"${t}"`).join(', ')}` : ''),
    dataSource: 'local-index',
  };
}

const indexReady = () => isReady(JOB_KEY);

function _resetCacheForTests() {
  cache = { key: null, releases: [] };
}

module.exports = {
  JOB_KEY,
  register,
  makeRun,
  indexReady,
  searchFwoFromIndex,
  parseListing,
  parseRelease,
  extractNames,
  nameMatches,
  isListingPage,
  ensureSchema,
  _resetCacheForTests,
};
