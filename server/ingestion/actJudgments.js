'use strict';

// Facts-only index of ACT Supreme Court judgments and ACAT decisions (DATA_SOURCES_PLAN.md
// Phase 3), replacing courts_act's live per-name searches through ScrapeOps.
//
// Where the facts come from (checked 2026-10-14):
// - Both sites run Funnelback search. An empty query lists every decision newest first, and
//   `num_ranks=500` returns 500 per page: about 11,010 Supreme Court judgments (back to the 1980s)
//   and 1,732 ACAT decisions (back to about 2010). So a full copy is about 27 requests, and a day's
//   new decisions are one request per site. Both block Railway's IP (Cloudflare), so requests go
//   through proxyLimiter.proxiedRequest, i.e. ScrapeOps today.
// - Each listing item gives the title (with citation), the decision date, the judge or member,
//   and the decision's URL. ACAT shortens long titles with "…", but the URL slug carries the full
//   title, so matching runs on title + slug. Many ACAT titles include a company's ACN, which is
//   matched as an identifier.
// - Stored: title, citation, date, judge/member, URL and any ACNs in the title. Not the
//   catchwords summary.
//
// Matching uses courtRecords.js's own titleMatchesTerm, the rule the live search applied to each
// result title, so the index finds what the live search found, and more: the live search only
// saw the first page of each site's full-text results. Search rule 4 (local sources search every
// term) applies: no business-name cap.
//
// Each run: for each site, a full copy if none has completed yet or the last is over 7 days old
// (pages resume across runs and restarts); otherwise just the newest 500.

const { registerJob, freshness, isReady } = require('./runner');
const { transaction, getState } = require('./localIndex');
const { proxiedRequest } = require('../scrapers/proxyLimiter');
const {
  isFunnelbackResultsPage,
  titleMatchesTerm,
  isFilterableTerm,
  stripCompanySuffix,
  JURISDICTION_SOURCES,
  ACAT_MANUAL_SEARCH_URL,
} = require('../scrapers/courtRecords');
const { normaliseDigits } = require('../scrapers/licenceMatching');
const cheerio = require('cheerio');

const JOB_KEY = 'actJudgments';
const PAGE_SIZE = 500;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; know-your-builder/1.0)' };
const SOURCES = {
  courts: {
    site: 'act-courts',
    label: 'ACT Supreme Court',
    listUrl: (start) => `https://www.courts.act.gov.au/judgment?query=&sort=date&num_ranks=${PAGE_SIZE}&start_rank=${start}`,
    minTotal: 5_000, // about 11,010 on 2026-10-14
  },
  acat: {
    site: 'acat',
    label: 'ACAT',
    listUrl: (start) => `https://www.acat.act.gov.au/decisions2/search-decisions?query=&sort=date&num_ranks=${PAGE_SIZE}&start_rank=${start}`,
    minTotal: 1_000, // 1,732 on 2026-10-14
  },
};
const INTERVAL_MS = 6 * 60 * 60 * 1000;
const FRESHNESS_SLA_MS = 72 * 60 * 60 * 1000;
const FULL_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_NEWEST_PAGE = 100; // the newest page of either site is always full
const PAGE_DELAY_MS = 5_000; // courts.act.gov.au asks for Crawl-delay: 3

const SCHEMA = `
CREATE TABLE IF NOT EXISTS act_judgment (
  url        TEXT PRIMARY KEY,
  source     TEXT NOT NULL,
  title      TEXT NOT NULL,
  citation   TEXT,
  decided    TEXT,
  judge      TEXT,
  match_text TEXT NOT NULL,
  acns       TEXT,
  seen_at    TEXT
) WITHOUT ROWID;
`;

function ensureSchema(db) {
  db.exec(SCHEMA);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function isoDate(text) {
  const m = String(text ?? '').trim().match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// A listing page → decisions. Funnelback also marks a few non-result list items with the same
// class; only items with a linked title count.
function parseListing(html, source) {
  const $ = cheerio.load(html);
  const out = [];
  $('li.search-result').each((_, el) => {
    const link = $(el).find('h3 a').first();
    const url = link.attr('title');
    if (!url || !/^https?:\/\//.test(url)) return;
    const citation = link.find('small').text().replace(/\s+/g, ' ').trim();
    const title = link.text().replace(/\s+/g, ' ').trim();
    if (!title) return;
    const slug = decodeURIComponent(url.split('/').filter(Boolean).pop() || '').replace(/-/g, ' ');
    const matchText = `${title} ${slug}`;
    const acns = [...new Set([...matchText.matchAll(/\bACN\s*((?:\d\s*){9})\b/gi)].map((m) => normaliseDigits(m[1])))];
    out.push({
      url,
      source,
      title,
      citation: citation || null,
      decided: isoDate($(el).find('.search-date').first().text()),
      judge: $(el).find('.search-staff').first().text().replace(/\s+/g, ' ').trim() || null,
      matchText,
      acns: acns.join(','),
    });
  });
  return out;
}

function upsert(db, rows) {
  const stmt = db.prepare(
    `INSERT INTO act_judgment (url, source, title, citation, decided, judge, match_text, acns, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET title = excluded.title, citation = excluded.citation, decided = excluded.decided,
       judge = excluded.judge, match_text = excluded.match_text, acns = excluded.acns, seen_at = excluded.seen_at`
  );
  const now = new Date().toISOString();
  transaction(db, () => {
    for (const r of rows) stmt.run(r.url, r.source, r.title, r.citation, r.decided, r.judge, r.matchText, r.acns, now);
  });
}

// The site's own count of decisions, from the line every listing page shows — "Results (1 - 10
// of approximately 11,010)" (courts) or "1 - 10 of 1,732 search results" (ACAT) — including a
// page past the last result, which has the line but no decisions. Null on anything else (a
// Cloudflare challenge has neither).
function listingTotal(html) {
  if (typeof html !== 'string') return null;
  const text = cheerio.load(html)('body').text().replace(/\s+/g, ' ');
  const m = text.match(/\bof\s+(?:approximately\s+)?([\d,]+)(?:\)|\s+search results)/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

const isListingPage = (html) => isFunnelbackResultsPage(html) || listingTotal(html) != null;

async function fetchPage(source, start, _request) {
  const cfg = SOURCES[source];
  const html = await _request({
    site: cfg.site,
    url: cfg.listUrl(start),
    headers: HEADERS,
    validate: isListingPage,
    label: `actJudgments ${source}`,
    deadlineMs: 90_000,
    directTimeoutMs: 5_000,
  });
  return { rows: parseListing(html, source), total: listingTotal(html) };
}

function makeRun(_request = proxiedRequest, { pageDelayMs = PAGE_DELAY_MS, minTotals = {}, minNewest = MIN_NEWEST_PAGE } = {}) {
  return async (ctx) => {
    const { db } = ctx;
    ensureSchema(db);
    for (const source of Object.keys(SOURCES)) {
      const p = (ctx.progress[source] ??= { backfillComplete: false, nextStart: 1, lastFullAt: null, total: 0 });
      const due = !p.backfillComplete || !p.lastFullAt || Date.now() - new Date(p.lastFullAt).getTime() > FULL_REFRESH_MS;
      if (!due) {
        const { rows: newest } = await fetchPage(source, 1, _request);
        if (newest.length < minNewest) throw new Error(`${source}: newest page had ${newest.length} decisions (expected at least ${minNewest})`);
        upsert(db, newest);
        continue;
      }
      // A full copy, resuming where the last run stopped. It ends at the first page with no
      // decisions; a page only gets that far if it passed isListingPage (a real listing page), so
      // a block page fails the run rather than ending the copy early. The copy must then hold at
      // least 95% of the site's own stated total.
      let seen = p.nextStart > 1 ? p.seenSoFar ?? 0 : 0;
      let siteTotal = null;
      for (;;) {
        await ctx.yieldToSearches();
        const { rows, total } = await fetchPage(source, p.nextStart, _request);
        siteTotal = total ?? siteTotal;
        if (rows.length === 0) break;
        upsert(db, rows);
        seen += rows.length;
        p.nextStart += PAGE_SIZE;
        p.seenSoFar = seen;
        ctx.checkpoint();
        await ctx.pace(pageDelayMs);
      }
      const min = Math.max(minTotals[source] ?? SOURCES[source].minTotal, siteTotal ? Math.floor(siteTotal * 0.95) : 0);
      if (seen < min) {
        p.nextStart = 1;
        p.seenSoFar = 0;
        throw new Error(`${source}: a full copy listed ${seen} decisions (expected at least ${min}${siteTotal ? `; the site reports ${siteTotal}` : ''}) — not marked complete`);
      }
      Object.assign(p, { backfillComplete: true, lastFullAt: new Date().toISOString(), nextStart: 1, seenSoFar: 0, total: seen });
      ctx.log(`${source}: full copy complete, ${seen} decisions`);
    }
  };
}

function describe(db) {
  ensureSchema(db);
  const counts = db.prepare('SELECT source, COUNT(*) AS n, MIN(decided) AS oldest FROM act_judgment GROUP BY source').all();
  if (counts.length === 0) return 'no decisions copied yet';
  return counts.map((c) => `${SOURCES[c.source]?.label ?? c.source}: ${c.n.toLocaleString()} (from ${c.oldest ?? '?'})`).join('; ');
}

function register(_request, options) {
  registerJob({
    key: JOB_KEY,
    label: 'ACT courts and ACAT decisions',
    scraperKeys: ['courts_act'],
    needsProxy: true,
    intervalMs: INTERVAL_MS,
    freshnessSlaMs: FRESHNESS_SLA_MS,
    firstRunDelayMs: 60_000,
    run: makeRun(_request, options),
    describe,
    isReady: (db) => {
      const { progress } = getState(db, JOB_KEY);
      return Object.keys(SOURCES).every((s) => progress[s]?.backfillComplete === true);
    },
  });
}

// ── Search time ──────────────────────────────────────────────────────────────────────────

let cache = { key: null, rows: [] };
function allRows(db) {
  const key = getState(db, JOB_KEY).lastSuccessAt;
  if (cache.key !== key || cache.rows.length === 0) {
    ensureSchema(db);
    cache = { key, rows: db.prepare('SELECT * FROM act_judgment').all() };
  }
  return cache.rows;
}

// Same result shape as courtRecords.js's runJurisdictionSearch for 'act', so the orchestrator's
// term provenance labelling and the report work unchanged.
function searchActFromIndex(db, { companyName, terms = [], acn }) {
  const strippedCompanyName = stripCompanySuffix(companyName);
  // Terms with no distinctive words would match every decision (see isFilterableTerm), so they're
  // skipped — and the result is then partial, never a clean "no cases found".
  const allTerms = [...new Set([strippedCompanyName, ...terms.filter(Boolean).map(stripCompanySuffix)].filter(Boolean))];
  const searchTerms = allTerms.filter(isFilterableTerm);
  const skipped = allTerms.filter((t) => !isFilterableTerm(t));
  const ownAcn = normaliseDigits(acn);
  const results = [];
  const seen = new Set();
  for (const row of allRows(db)) {
    let matchedTerm = searchTerms.find((t) => titleMatchesTerm(row.match_text, t));
    const acnMatch = ownAcn.length === 9 && row.acns && row.acns.split(',').includes(ownAcn);
    if (!matchedTerm && acnMatch) matchedTerm = companyName;
    if (!matchedTerm || seen.has(row.url)) continue;
    seen.add(row.url);
    results.push({
      title: row.title,
      url: row.url,
      date: row.decided || '',
      description: [row.judge, row.source === 'acat' ? 'ACAT' : 'ACT Supreme Court'].filter(Boolean).join(' — '),
      matchedTerm,
      jurisdiction: 'ACT',
      ...(acnMatch ? { metadata: { MatchedBy: 'ACN in case title' } } : {}),
    });
  }
  results.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const { stale, asOf } = freshness(JOB_KEY);
  return {
    source: 'ACT Courts & ACAT',
    jurisdiction: 'ACT',
    category: 'legal',
    results,
    searchUrl: `https://www.courts.act.gov.au/judgment?query=${encodeURIComponent(strippedCompanyName || '')}`,
    acatSearchUrl: ACAT_MANUAL_SEARCH_URL,
    sources: JURISDICTION_SOURCES.act,
    completeness: stale ? 'stale' : skipped.length > 0 ? 'partial' : 'complete',
    ...(stale && asOf ? { asOf } : {}),
    summary:
      (results.length > 0 ? `Found ${results.length} case(s) in ACT courts and tribunals` : 'No cases found in ACT courts and tribunals') +
      ` (searched ${searchTerms.length} name(s) against every ACT Supreme Court judgment and ACAT decision title)` +
      (skipped.length > 0 ? `; not searched, too generic to match on: ${skipped.map((t) => `"${t}"`).join(', ')}` : ''),
    dataSource: 'local-index',
  };
}

const indexReady = () => isReady(JOB_KEY);

function _resetCacheForTests() {
  cache = { key: null, rows: [] };
}

module.exports = { JOB_KEY, register, makeRun, indexReady, searchActFromIndex, parseListing, listingTotal, isoDate, ensureSchema, _resetCacheForTests };
