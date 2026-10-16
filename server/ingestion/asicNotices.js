'use strict';

// Facts-only index of ASIC published notices (DATA_SOURCES_PLAN.md Phase 3), replacing the live
// browser searches behind `asicInsolvency` (53% healthy) and `atoDebt` (58%).
//
// Where the facts come from (all checked from the Railway container, 2026-10-14):
// - publishednotices.asic.gov.au publishes a sitemap per month back to October 2012
//   (/sitemap/sitemap-index.xml → /sitemap/sitemap-MMYY.xml, about 15,000–25,000 notices a
//   month, most of them proposed deregistrations). robots.txt allows everything except
//   /my-notices. Both load directly from Railway: no proxy, no browser, no WAF challenge — only
//   the search page is challenged.
// - Each sitemap entry's URL carries the notice's main company and ACN
//   (/notice-details/<Name-Slug>-<ACN>/<id>), plus a date (`lastmod`).
// - A notice page names every company it covers. Some notices cover several (2 of 21 non-
//   deregistration notices in a 200-notice sample), and the URL carries only one, so each page
//   is read once ("enrichment") for its type, every company and ACN, status and date.
//
// What's stored is facts only: names, ACNs, notice type and legislation line, status, dates and
// links. No notice text. The ATO check classifies a notice from its title and legislation line,
// as the live check classified a search result's heading.
//
// Each run: (1) sync sitemaps — every month once, then the two newest months and any whose
// lastmod changed; (2) read up to ENRICH_PER_RUN un-read notice pages, newest first, one at a
// time. New notices are read within an hour or two; history is read in the background at about
// one page a second (several weeks for the full 2.7 million). Until a notice is read, a search
// that matches it by its main ACN reads it then. A company named only as a second company on an
// older, not-yet-read notice can't be found yet; summaries say how far back joint notices are
// covered.

const axios = require('axios');
const cheerio = require('cheerio');
const { registerJob, freshness, isReady } = require('./runner');
const { transaction, getState } = require('./localIndex');
const { isAtoDebtNotice } = require('../scrapers/atoDebt');
const { normaliseEntityName, normaliseDigits } = require('../scrapers/licenceMatching');

const JOB_KEY = 'asicNotices';
const BASE = 'https://publishednotices.asic.gov.au';
const SITEMAP_INDEX_URL = `${BASE}/sitemap/sitemap-index.xml`;
const SEARCH_URL = `${BASE}/browsesearch-notices`;
// Stored links drop this prefix (it's identical on every notice), saving ~70 bytes a row across
// ~2.7 million rows.
const NOTICE_PREFIX = `${BASE}/browsesearch-notices/notice-details/`;
const shortUrl = (url) => (url.startsWith(NOTICE_PREFIX) ? url.slice(NOTICE_PREFIX.length) : url);
const fullUrl = (stored) => (stored.startsWith('http') ? stored : NOTICE_PREFIX + stored);
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-AU,en;q=0.9',
};

const INTERVAL_MS = 60 * 60 * 1000;
const FRESHNESS_SLA_MS = 48 * 60 * 60 * 1000;
const ENRICH_PER_RUN = () => parseInt(process.env.ASIC_NOTICES_ENRICH_PER_RUN, 10) || 1_500;
const ENRICH_DELAY_MS = () => parseInt(process.env.ASIC_NOTICES_ENRICH_DELAY_MS, 10) || 2_000;
// How far back notice pages are read in the background. Reading all ~2.7 million would mean
// ~60,000 requests a day to ASIC for weeks, to find second companies on old joint notices
// (about 1% of notices). Two years is about 400,000 pages, ten days at one every 2 seconds;
// after that only new notices are read (500–800 a day). Older notices stay searchable by their
// main company's ACN, and their type is read at search time when they match.
const READ_BACK_DAYS = () => parseInt(process.env.ASIC_NOTICES_READ_BACK_DAYS, 10) || 730;
const SITEMAP_DELAY_MS = 2_000;
const MIN_SITEMAPS = 100; // the index listed 171 on 2026-10-14
const MIN_URLS_COMPLETE_MONTH = 500; // a sample of six months had 14,000–25,000 each
const MAX_CONSECUTIVE_PAGE_FAILURES = 5;
const MAX_LIVE_ENRICH = 15;
const LIVE_ENRICH_TIMEOUT_MS = 8_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS asic_sitemap (
  name       TEXT PRIMARY KEY,
  lastmod    TEXT,
  url_count  INTEGER,
  synced_at  TEXT
);
CREATE TABLE IF NOT EXISTS asic_notice (
  id           TEXT PRIMARY KEY,
  url          TEXT NOT NULL,
  listed_date  TEXT,
  enriched_at  TEXT,
  notice_type  TEXT,
  legislation  TEXT,
  notice_date  TEXT,
  status       TEXT,
  is_ato       INTEGER
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS asic_notice_company (
  notice_id  TEXT NOT NULL,
  acn        TEXT NOT NULL,
  name       TEXT,
  name_norm  TEXT,
  PRIMARY KEY (notice_id, acn)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_asic_notice_company_acn ON asic_notice_company(acn);
CREATE INDEX IF NOT EXISTS idx_asic_notice_company_name ON asic_notice_company(name_norm);
-- Only unread notices are indexed, so this shrinks to nothing as history is read.
CREATE INDEX IF NOT EXISTS idx_asic_notice_unread ON asic_notice(listed_date) WHERE enriched_at IS NULL;
`;

function ensureSchema(db) {
  db.exec(SCHEMA);
}

// ── Parsing ───────────────────────────────────────────────────────────────────────────────

// Sitemap index → [{ name, url, lastmod }] in the index's own order (oldest month first).
function parseSitemapIndex(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]*)<\/lastmod>)?/g)) {
    const url = m[1].trim();
    const name = (url.match(/sitemap-([0-9-]+)\.xml$/) || [])[1];
    if (name) out.push({ name, url, lastmod: m[2] ?? null });
  }
  return out;
}

// Monthly sitemap → [{ id, url, acn, name, listedDate }]. Entries whose URL doesn't end in
// <slug>-<9-digit ACN>/<id> are skipped (none did in a six-month sample).
function parseSitemap(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]*)<\/lastmod>)?/g)) {
    const url = m[1].trim();
    const parts = url.match(/\/notice-details\/(.+)-(\d{9})\/([0-9a-fA-F-]{36})$/);
    if (!parts) continue;
    out.push({ id: parts[3].toLowerCase(), url, acn: parts[2], name: parts[1].replace(/-/g, ' '), listedDate: m[2] ?? null });
  }
  return out;
}

const cellText = ($, el) => $(el).text().replace(/\s+/g, ' ').trim();

// A notice page → facts, or null if it isn't a notice page (a WAF challenge, an error page).
function parseNoticePage(html) {
  if (typeof html !== 'string' || !html.includes('xmlxslt-form')) return null;
  const $ = cheerio.load(html);
  const box = $('.xmlxslt-form .shadow').first();
  if (!box.length) return null;
  const title = cellText($, box.find('h2').first());
  box.find('.boxinnertop br').replaceWith(' — ');
  const legislation = cellText($, box.find('.boxinnertop').first());
  const companies = [];
  let status = null;
  let noticeDate = null;
  let current = null;
  box.find('table.tbl tr').each((_, tr) => {
    const label = cellText($, $(tr).find('th').first()).replace(/:$/, '').toLowerCase();
    const value = cellText($, $(tr).find('td').first());
    if (label === 'company') {
      current = { name: value, acn: null };
      companies.push(current);
    } else if (label === 'acn' && current && !current.acn) {
      current.acn = normaliseDigits(value) || null;
    } else if (label === 'status') {
      status = value;
    } else if (label === 'date of notice') {
      noticeDate = value;
    }
  });
  if (!title && companies.length === 0) return null;
  return {
    title,
    legislation,
    companies: companies.filter((c) => c.acn && c.acn.length === 9),
    status,
    noticeDate,
    isAto: isAtoDebtNotice(`${title} ${legislation}`),
  };
}

// ── Storage ───────────────────────────────────────────────────────────────────────────────

// Written in chunks, handing control back to the server between them: one 25,000-row transaction
// on Railway's volume could hold the (synchronous) SQLite call, and every request, for seconds.
const UPSERT_CHUNK = 2_000;
const yieldToServer = () => new Promise((resolve) => setImmediate(resolve));

async function upsertSitemapEntries(db, entries) {
  const notice = db.prepare(
    `INSERT INTO asic_notice (id, url, listed_date) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET url = excluded.url, listed_date = COALESCE(asic_notice.listed_date, excluded.listed_date)`
  );
  const company = db.prepare(
    `INSERT INTO asic_notice_company (notice_id, acn, name, name_norm) VALUES (?, ?, ?, ?)
     ON CONFLICT(notice_id, acn) DO NOTHING`
  );
  for (let i = 0; i < entries.length; i += UPSERT_CHUNK) {
    transaction(db, () => {
      for (const e of entries.slice(i, i + UPSERT_CHUNK)) {
        notice.run(e.id, shortUrl(e.url), e.listedDate);
        company.run(e.id, e.acn, e.name, normaliseEntityName(e.name));
      }
    });
    await yieldToServer();
  }
}

function saveEnrichment(db, id, facts) {
  transaction(db, () => {
    db.prepare(
      `UPDATE asic_notice SET enriched_at = ?, notice_type = ?, legislation = ?, notice_date = ?, status = ?, is_ato = ? WHERE id = ?`
    ).run(new Date().toISOString(), facts.title || null, facts.legislation || null, facts.noticeDate, facts.status, facts.isAto ? 1 : 0, id);
    // The page's own company names replace the URL slug's (which loses punctuation).
    const upsert = db.prepare(
      `INSERT INTO asic_notice_company (notice_id, acn, name, name_norm) VALUES (?, ?, ?, ?)
       ON CONFLICT(notice_id, acn) DO UPDATE SET name = excluded.name, name_norm = excluded.name_norm`
    );
    for (const c of facts.companies) upsert.run(id, c.acn, c.name, normaliseEntityName(c.name));
  });
}

async function fetchText(_http, url, timeout) {
  const res = await _http.get(url, { headers: HEADERS, timeout, responseType: 'text', validateStatus: (s) => s === 200 });
  return res.data;
}

// ── The job ───────────────────────────────────────────────────────────────────────────────

async function syncSitemaps(ctx, _http, { minSitemaps = MIN_SITEMAPS, minUrls = MIN_URLS_COMPLETE_MONTH } = {}) {
  const { db } = ctx;
  const sitemaps = parseSitemapIndex(await fetchText(_http, SITEMAP_INDEX_URL, 30_000));
  if (sitemaps.length < minSitemaps) {
    throw new Error(`sitemap index listed ${sitemaps.length} sitemaps (expected at least ${minSitemaps}) — not a real index`);
  }
  const known = new Map(db.prepare('SELECT name, lastmod FROM asic_sitemap').all().map((r) => [r.name, r.lastmod]));
  const newest = new Set(sitemaps.slice(-2).map((s) => s.name));
  const todo = sitemaps.filter((s) => !known.has(s.name) || newest.has(s.name) || known.get(s.name) !== s.lastmod);
  let added = 0;
  for (const s of todo) {
    await ctx.yieldToSearches();
    const entries = parseSitemap(await fetchText(_http, s.url, 60_000));
    if (!newest.has(s.name) && entries.length < minUrls) {
      throw new Error(`sitemap ${s.name} had ${entries.length} notices (expected at least ${minUrls}) — stopped`);
    }
    await upsertSitemapEntries(db, entries);
    for (const e of entries) {
      if (e.listedDate && (!ctx.progress.coveredFrom || e.listedDate < ctx.progress.coveredFrom)) ctx.progress.coveredFrom = e.listedDate;
    }
    db.prepare(
      `INSERT INTO asic_sitemap (name, lastmod, url_count, synced_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET lastmod = excluded.lastmod, url_count = excluded.url_count, synced_at = excluded.synced_at`
    ).run(s.name, s.lastmod, entries.length, new Date().toISOString());
    added += entries.length;
    ctx.progress.sitemapsSynced = db.prepare('SELECT COUNT(*) AS n FROM asic_sitemap').get().n;
    ctx.checkpoint();
    await ctx.pace(SITEMAP_DELAY_MS);
  }
  // Reaching here means every sitemap in the index has now been copied at least once.
  ctx.progress.sitemapsTotal = sitemaps.length;
  ctx.progress.sitemapsComplete = true;
  if (todo.length) ctx.log(`synced ${todo.length} sitemap(s), ${added} entries`);
}

function readBackCutoff() {
  return new Date(Date.now() - READ_BACK_DAYS() * 86_400_000).toISOString().slice(0, 10);
}

async function enrichBatch(ctx, _http) {
  const { db } = ctx;
  const cutoff = readBackCutoff();
  const batch = db
    .prepare('SELECT id, url FROM asic_notice WHERE enriched_at IS NULL AND listed_date >= ? ORDER BY listed_date DESC, id LIMIT ?')
    .all(cutoff, ENRICH_PER_RUN());
  let read = 0;
  let failures = 0;
  for (const { id, url } of batch) {
    await ctx.yieldToSearches();
    try {
      const facts = parseNoticePage(await fetchText(_http, fullUrl(url), 20_000));
      if (!facts) throw new Error('not a notice page');
      saveEnrichment(db, id, facts);
      read++;
      ctx.progress.pagesRead = (ctx.progress.pagesRead ?? 0) + 1;
      failures = 0;
    } catch (err) {
      failures++;
      if (failures >= MAX_CONSECUTIVE_PAGE_FAILURES) {
        throw new Error(`${failures} notice pages in a row failed (last: ${err.response?.status || err.code || err.message}) — stopped after reading ${read}`);
      }
    }
    await ctx.pace(ENRICH_DELAY_MS());
  }
  // Joint notices are covered in full for notices listed after the newest one not yet read, or
  // from the read-back cutoff once the window has been read.
  const newestUnread = db
    .prepare('SELECT listed_date FROM asic_notice WHERE enriched_at IS NULL AND listed_date >= ? ORDER BY listed_date DESC LIMIT 1')
    .get(cutoff)?.listed_date;
  ctx.progress.unreadFrom = newestUnread ?? cutoff;
  if (read) ctx.log(`read ${read} notice page(s); joint notices covered in full from ${ctx.progress.unreadFrom}`);
}

// `limits` ({ minSitemaps, minUrls }) exist so tests can use small fake sitemaps.
function makeRun(_http = axios, limits = {}) {
  return async (ctx) => {
    ensureSchema(ctx.db);
    await syncSitemaps(ctx, _http, limits);
    await enrichBatch(ctx, _http);
  };
}

// Never counts the notices table: on Railway's volume a COUNT(*) over its 2.6M rows took 33.6s,
// freezing the server, each time the dashboard asked (found 2026-10-16). The figures come from
// the small sitemap table (entries per month; a notice listed in two months counts twice) and
// the job's own running count of pages read in the background.
function describe(db) {
  ensureSchema(db);
  const { sitemaps, entries } = db.prepare('SELECT COUNT(*) AS sitemaps, SUM(url_count) AS entries FROM asic_sitemap').get();
  const { pagesRead } = getState(db, JOB_KEY).progress;
  return `${(entries ?? 0).toLocaleString()} sitemap entries from ${sitemaps} monthly sitemaps; ${(pagesRead ?? 0).toLocaleString()} pages read in the background`;
}

function register(_http, limits) {
  registerJob({
    key: JOB_KEY,
    label: 'ASIC published notices',
    scraperKeys: ['asicInsolvency', 'atoDebt'],
    intervalMs: INTERVAL_MS,
    freshnessSlaMs: FRESHNESS_SLA_MS,
    run: makeRun(_http, limits),
    describe,
    // Ready once every monthly sitemap in the index has been copied at least once.
    isReady: (db) => getState(db, JOB_KEY).progress.sitemapsComplete === true,
  });
}

// ── Search time ──────────────────────────────────────────────────────────────────────────

function noticesFor(db, { acns, names }) {
  const rows = [];
  const byAcn = db.prepare(
    `SELECT n.*, c.acn AS matched_acn, c.name AS matched_name FROM asic_notice_company c JOIN asic_notice n ON n.id = c.notice_id WHERE c.acn = ?`
  );
  const byName = db.prepare(
    `SELECT n.*, c.acn AS matched_acn, c.name AS matched_name FROM asic_notice_company c JOIN asic_notice n ON n.id = c.notice_id WHERE c.name_norm = ?`
  );
  for (const q of acns) for (const r of byAcn.all(q.acn)) rows.push({ ...r, query: q, matchedBy: 'acn' });
  for (const q of names) for (const r of byName.all(normaliseEntityName(q.name))) rows.push({ ...r, query: q, matchedBy: 'name' });
  return rows;
}

// Reads any matched notice not yet read, at most MAX_LIVE_ENRICH, four at a time. Returns how
// many couldn't be read.
async function enrichMatched(db, rows, _http) {
  const unread = [...new Map(rows.filter((r) => !r.enriched_at).map((r) => [r.id, r])).values()].slice(0, MAX_LIVE_ENRICH);
  let failed = 0;
  for (let i = 0; i < unread.length; i += 4) {
    await Promise.all(
      unread.slice(i, i + 4).map(async (r) => {
        try {
          const facts = parseNoticePage(await fetchText(_http, fullUrl(r.url), LIVE_ENRICH_TIMEOUT_MS));
          if (!facts) throw new Error('not a notice page');
          saveEnrichment(db, r.id, facts);
        } catch {
          failed++;
        }
      })
    );
  }
  return failed + Math.max(0, new Set(rows.filter((r) => !r.enriched_at).map((r) => r.id)).size - unread.length);
}

// One report item per notice (a notice matched under two names appears once, under the first).
function toItems(rows, kind) {
  const seen = new Set();
  const items = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    if (kind === 'ato' && !r.is_ato) continue;
    seen.add(r.id);
    const type = r.notice_type || 'Notice type not yet read — open the notice';
    const entity = r.matched_name || '';
    const metadata = {
      'Notice Type': type,
      Entity: entity,
      ACN: r.matched_acn,
      Status: r.status || '',
      Date: r.notice_date || r.listed_date || '',
      ...(r.legislation ? { Legislation: r.legislation } : {}),
    };
    if (r.matchedBy === 'name') metadata.MatchedBy = 'Name only — verify';
    if (r.query.linked) {
      metadata.LinkedCompany = r.query.linked.name;
      metadata.LinkedVia = r.query.linked.via;
      metadata.MatchedBy = r.query.linked.confidence === 'confirmed' ? `Linked company — via ${r.query.linked.person}` : 'Name only — verify';
    }
    items.push({
      title: entity ? `${entity} — ${type}` : type,
      url: fullUrl(r.url),
      date: r.notice_date || r.listed_date || '',
      status: kind === 'ato' ? 'ATO Tax Debt Disclosed' : type,
      description:
        kind === 'ato' ? 'ATO tax debt notice published by ASIC under Tax Administration Act s260-45' : entity || 'ASIC Published Notices',
      metadata,
    });
  }
  return items;
}

// Builds the asicInsolvency (kind 'insolvency') or atoDebt (kind 'ato') result from the index.
// `acn`/`name` are the searched entity's (from identity); `linked` are linked companies.
async function searchNoticesFromIndex(db, { kind, acn, name, linked = [] }, { _http = axios } = {}) {
  ensureSchema(db);
  const acns = [];
  const names = [];
  if (acn) acns.push({ acn: normaliseDigits(acn) });
  else if (name) names.push({ name });
  for (const c of linked) {
    const linkedAcn = normaliseDigits(c.acn) || (normaliseDigits(c.abn).length === 11 ? normaliseDigits(c.abn).slice(2) : '');
    if (linkedAcn && linkedAcn.length === 9) acns.push({ acn: linkedAcn, linked: c });
  }

  let rows = noticesFor(db, { acns, names });
  let unreadFailed = 0;
  if (rows.some((r) => !r.enriched_at)) {
    unreadFailed = await enrichMatched(db, rows, _http);
    rows = noticesFor(db, { acns, names });
  }

  const results = toItems(rows, kind);
  const { stale, asOf } = freshness(JOB_KEY);
  const { unreadFrom, coveredFrom } = getState(db, JOB_KEY).progress;
  const since = coveredFrom ? `since ${formatMonth(coveredFrom)}` : 'in the copied notices';
  const coverage =
    unreadFrom && (!coveredFrom || unreadFrom > coveredFrom)
      ? ` Notices naming several companies are checked in full from ${formatDay(unreadFrom)}; older ones only under their main company.`
      : '';
  const searched = acn ? `ACN ${normaliseDigits(acn)}` : `the name "${name}"`;
  const own = results.filter((r) => !r.metadata.LinkedCompany);
  const noun = kind === 'ato' ? 'ATO tax debt disclosure(s)' : 'notice(s)';
  const summary =
    own.length > 0
      ? kind === 'ato'
        ? `${own.length} ATO tax debt disclosure(s) found — entity has a listed tax debt published by ASIC`
        : `${own.length} ASIC published ${noun} found for ${searched} (insolvency, winding-up and deregistration notices ${since})`
      : kind === 'ato'
        ? `No ATO tax debt notices found for ${searched} in ASIC Published Notices (${since}).${coverage}`
        : `No ASIC published notices found for ${searched} (all notices ${since}).${coverage}`;
  const linkedCount = results.length - own.length;

  return {
    source: kind === 'ato' ? 'ASIC Published Notices — ATO Tax Debt' : 'ASIC Published Notices',
    jurisdiction: 'Federal',
    category: 'financial',
    results,
    searchUrl: SEARCH_URL,
    summary: summary + (linkedCount > 0 ? ` Also ${linkedCount} for linked companies.` : '') + (unreadFailed > 0 ? ` ${unreadFailed} matched notice(s) could not be opened — check them via the links.` : ''),
    ...(unreadFailed > 0 ? { completeness: 'partial' } : {}),
    ...(stale ? { completeness: 'stale', ...(asOf ? { asOf } : {}) } : {}),
    dataSource: 'local-index',
  };
}

const indexReady = () => isReady(JOB_KEY);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function formatMonth(isoDate) {
  const [y, m] = String(isoDate).split('-');
  return MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : isoDate;
}
function formatDay(isoDate) {
  const [y, m, d] = String(isoDate).split('-');
  return MONTHS[Number(m) - 1] && d ? `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}` : isoDate;
}

module.exports = {
  JOB_KEY,
  register,
  makeRun,
  indexReady,
  searchNoticesFromIndex,
  parseSitemapIndex,
  parseSitemap,
  parseNoticePage,
  ensureSchema,
};
