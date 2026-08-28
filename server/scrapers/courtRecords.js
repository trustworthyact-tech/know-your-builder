const axios = require('axios');
const cheerio = require('cheerio');
const { fetchWithBrowser } = require('./browser');

// Jurisdiction labels shown in the report and used as SearchResult.jurisdiction.
const JURISDICTION_LABELS = {
  federal: 'Federal',
  qld: 'QLD',
  nsw: 'NSW',
  vic: 'VIC',
  wa: 'WA',
  sa: 'SA',
  nt: 'NT',
  act: 'ACT',
  tas: 'TAS',
};

// Key courts and tribunals per jurisdiction for the report — carried forward from the
// retired AustLII scraper, still accurate regardless of which source backs the search.
const JURISDICTION_SOURCES = {
  federal: [
    'Federal Court of Australia',
    'Federal Circuit Court',
    'High Court of Australia',
    'Fair Work Commission',
    'Fair Work Australia',
  ],
  qld: [
    'QLD Supreme Court',
    'QLD District Court',
    'QLD Magistrates Court',
    'Queensland Civil & Administrative Tribunal (QCAT)',
    'Queensland Industrial Relations Commission',
    'Queensland Planning & Environment Court',
  ],
  nsw: [
    'NSW Supreme Court',
    'NSW District Court',
    'NSW Local Court',
    'NSW Land & Environment Court',
    'NSW Civil & Administrative Tribunal (NCAT)',
    'NSW Industrial Relations Commission',
  ],
  vic: [
    'VIC Supreme Court',
    'VIC County Court',
    'VIC Magistrates Court',
    'Victorian Civil & Administrative Tribunal (VCAT)',
  ],
  wa: [
    'WA Supreme Court',
    'WA District Court',
    'WA Magistrates Court',
    'WA State Administrative Tribunal (SAT)',
    'WA Industrial Relations Commission',
  ],
  sa: [
    'SA Supreme Court',
    'SA District Court',
    'SA Magistrates Court',
    'SA Employment Tribunal (SAET)',
    'SA Environment Resources & Development Court',
  ],
  nt: ['NT Supreme Court', 'NT Local Court', 'NT Civil & Administrative Tribunal (NTCAT)'],
  act: [
    'ACT Supreme Court',
    'ACT Magistrates Court',
    'ACT Civil & Administrative Tribunal (ACAT)',
  ],
  tas: ['TAS Supreme Court', 'TAS Magistrates Court'],
};

// Official judgments pages for jurisdictions with no free, unauthenticated, full-text
// search available (checked 2026-08-25/26 — see CLAUDE.md's court-records investigation
// notes for the reachability/ToS findings behind each of these). Used as the manual
// "search this yourself" link surfaced via ReportSection's supplementalLinks prop.
// federal/act/nt are no longer in this map — they moved to live searches (2026-08-26).
const MANUAL_SEARCH_URLS = {
  qld: 'https://www.courts.qld.gov.au/decisions',
  vic: 'https://courts.vic.gov.au/court-system/transcripts-and-judgments/judgments-decisions-and-orders',
  wa: 'https://www.supremecourt.wa.gov.au/D/decisions_and_publications.aspx',
  sa: 'https://www.courts.sa.gov.au/court-decisions/judgments/',
  tas: 'https://www.supremecourt.tas.gov.au/publications/decisions-of-the-court/judgments/',
};

// Words too generic to use as an entity-match signal in case titles.
const COMMON_WORDS = new Set([
  'pty', 'ltd', 'limited', 'the', 'and', 'of', 'a', 'in', 'for', 'by', 'no',
  'trading', 'services', 'group', 'australia', 'australian', 'holdings',
  'trust', 'construction', 'constructions', 'building', 'builders',
  'management', 'solutions', 'operations', 'projects', 'enterprise', 'enterprises',
]);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// NSW Caselaw's search scores matches across every word in the query, same as AustLII's
// did — generic company-type suffixes ("Pty Ltd" etc.) are common enough across the
// corpus that they dilute relevance. Stripping the suffix before searching avoids that.
const COMPANY_SUFFIX_RE = /\s+(pty\.?\s*ltd\.?|proprietary\s+limited|limited|ltd\.?|pty\.?)\s*$/i;
function stripCompanySuffix(name) {
  if (!name) return name;
  const stripped = name.replace(COMPANY_SUFFIX_RE, '').trim();
  return stripped || name; // don't return an empty string if stripping consumed everything
}

// Returns true only when `term` appears as a contiguous phrase in `title` — i.e. the
// searched entity is actually named as a party, not just sharing one word with an
// unrelated party. These search engines (NSW Caselaw, Federal Court, NT) rank by
// full-text relevance, so a plain "any distinctive word" match let through cases about a
// completely different entity that merely shares a word — e.g. searching "BHP Group
// Limited" (2026-08-26 production report, ABN 49004028077) returned "BHP Coal Pty Ltd v
// Mining and Energy Union", "BHP Steel v Oliver", "BHP Titanium Minerals", "BHP
// Refractories Pty Ltd" and similar — all real but legally distinct BHP-group entities,
// not BHP Group Limited itself. Requiring the full name together (word-boundary,
// punctuation/whitespace-insensitive between words) fixes that: only titles containing
// "BHP Group Limited" itself (e.g. "Impiombato v BHP Group Limited (No 6)") pass.
//
// Single-word fallback: only used when the term ITSELF is a single word after stripping
// company suffixes (e.g. "Multiplex", "Bunter") — there's no multi-word phrase to require
// in that case, so word-boundary match on that one word is the strictest available check,
// not a loosened substitute for the phrase match above.
function titleMatchesTerm(title, term) {
  const lower = title.toLowerCase();
  const allWords = term.toLowerCase().split(/\W+/).filter(Boolean);

  if (allWords.length > 1) {
    const phrase = allWords.map(escapeRegExp).join('\\W+');
    if (new RegExp(`\\b${phrase}\\b`).test(lower)) return true;
    return false;
  }

  if (allWords.length === 1) {
    const [w] = allWords;
    if ((w.length > 2 || /^\d+$/.test(w)) && !COMMON_WORDS.has(w)) {
      return new RegExp(`\\b${escapeRegExp(w)}\\b`).test(lower);
    }
  }

  return true; // no distinctive words at all in the term — can't filter
}

// Returns a per-jurisdiction term memoizer: dedupes concurrent calls for the same term
// (e.g. company name + a director name that happen to coincide) so only one HTTP
// request is made per term per search. Each jurisdiction gets its OWN cache instance —
// sharing one Map across jurisdictions would let one domain's results leak into
// another's when the same term is searched for two jurisdictions inside the same
// 30s window.
function makeTermCache(fetchFn) {
  const pending = new Map();
  return function fetchTermResults(term) {
    if (pending.has(term)) return pending.get(term);

    const promise = fetchFn(term).then(
      (results) => {
        // Success: keep cached for 30 s so concurrent calls for the same term share it.
        setTimeout(() => pending.delete(term), 30_000);
        return results;
      },
      (err) => {
        // Failure: evict immediately so the next request retries rather than replaying
        // a stale rejection.
        pending.delete(term);
        throw err;
      }
    );

    pending.set(term, promise);
    return promise;
  };
}

const fetchNswTermResults = makeTermCache(async (term) => {
  const searchUrl = `https://www.caselaw.nsw.gov.au/search?query=${encodeURIComponent(term)}`;
  const { data } = await axios.get(searchUrl, {
    timeout: 30_000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; know-your-builder/1.0)' },
  });
  const $ = cheerio.load(data);
  const results = [];

  $('.result').each((_, el) => {
    const link = $(el).find('.cntn h4 a').first();
    const href = link.attr('href');
    const title = link.text().trim();
    if (!href || !title) return;

    const fullUrl = href.startsWith('http') ? href : `https://www.caselaw.nsw.gov.au${href}`;
    const snippet = $(el)
      .find('.cntn')
      .text()
      .replace(title, '')
      .replace(/^\s*Catchwords:\s*/i, '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 300);

    results.push({ title, url: fullUrl, description: snippet || undefined, matchedTerm: term });
  });

  return results;
});

// ACT's own judgment search — https://www.courts.act.gov.au/judgment?query=<term>. Plain
// axios/cheerio, no Cloudflare gate (confirmed 2026-08-26). The site's own banner warns
// "search functions are currently being updated" — working as of this writing, but worth
// checking that banner first if this scraper starts returning nothing.
const fetchActTermResults = makeTermCache(async (term) => {
  const searchUrl = `https://www.courts.act.gov.au/judgment?query=${encodeURIComponent(term)}`;
  const { data } = await axios.get(searchUrl, {
    timeout: 30_000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; know-your-builder/1.0)' },
  });
  const $ = cheerio.load(data);
  const results = [];

  $('li.search-result').each((_, el) => {
    const link = $(el).find('h3 a').first();
    // The href is a Funnelback redirect wrapper (search.act.gov.au/s/redirect?...&url=<real>);
    // the title attribute already holds the clean destination URL — use that, not href.
    const url = link.attr('title');
    // Matched keywords are wrapped in <strong> tags interspersed with plain text — a
    // naive .contents().first() only grabs the text node before the first <strong>,
    // silently truncating every title with a highlighted match. .text() concatenates
    // all descendant text (including the trailing <small> citation), same as every
    // other jurisdiction's title here.
    const title = link.text().trim().replace(/\s+/g, ' ');
    if (!url || !title) return;

    const judge = $(el).find('.search-staff').first().text().trim();
    const summary = $(el).find('.search-summary').first().text().trim().replace(/\s+/g, ' ');
    const description = [judge, summary].filter(Boolean).join(' — ').slice(0, 300);

    results.push({ title, url, description: description || undefined, matchedTerm: term });
  });

  return results;
});

// Federal Court's dedicated judgments search (distinct from the general site search) —
// behind a Cloudflare managed challenge across the whole fedcourt.gov.au estate, so this
// goes through fetchWithBrowser rather than plain axios. Confirmed 2026-08-26: a solved
// Cloudflare session's cookies do NOT work for a subsequent plain-HTTP request (the gate
// is fingerprint-based, not cookie-based) — there is no cheaper path than a real browser
// round-trip per request here.
//
// num_ranks=100 (Funnelback's page-size param) is not optional — the default page size
// is 20, and for a heavily-litigated entity that's nowhere near enough. Confirmed live:
// "BHP" returns 1,514 total hits sorted by genuine relevance (not a sort bug), but zero
// of the top 20 have "BHP" in the case title — real BHP litigation (e.g. "Impiombato v
// BHP Group Limited (No 6) [2025] FCA 1594") only appears once the window is widened.
// 100 is a pragmatic ceiling, not a proven-sufficient one — BHP still has cases beyond
// the top 100 that this won't surface — but multi-page pagination would mean multiple
// Puppeteer round-trips per term, adding real cost to the concurrency problem already
// documented for this scraper. NSW Caselaw has the identical page-1-only limitation
// (1,897 total hits for "BHP", capped at 20) but no equivalent page-size override param
// was found — its pagination is a `pagenumber` param, i.e. genuinely separate requests —
// left unfixed here as a known follow-up, not folded into this fix.
const fetchFederalTermResults = makeTermCache(async (term) => {
  const searchUrl = `https://search.judgments.fedcourt.gov.au/s/search.html?collection=fca~sp-judgments-internet&profile=judgments-internet&num_ranks=100&query=${encodeURIComponent(term)}`;
  const html = await fetchWithBrowser(searchUrl, { challengeTimeoutMs: 25_000 });
  const $ = cheerio.load(html);
  const results = [];

  $('div.result').each((_, el) => {
    const link = $(el).find('h3 a').first();
    const url = link.attr('href');
    const title = link.text().trim();
    if (!url || !title) return;

    const summary = $(el).find('p.summary').first().text().trim().replace(/\s+/g, ' ').slice(0, 300);
    results.push({ title, url, description: summary || undefined, matchedTerm: term });
  });

  return results;
});

// NT Supreme Court's sitewide search, which does index judgment documents. Same
// Cloudflare-managed-challenge situation as Federal Court — fetchWithBrowser required.
// category_type is left blank ("Everything") rather than querying per-category twice;
// the "Decisions" type filter below (applied in code, not via a second request) already
// captures both Supreme Court and Court of Appeal decisions from one request.
const fetchNtTermResults = makeTermCache(async (term) => {
  const searchUrl = `https://supremecourt.nt.gov.au/search?queries_name_query=${encodeURIComponent(term)}`;
  const html = await fetchWithBrowser(searchUrl, { challengeTimeoutMs: 25_000 });
  const $ = cheerio.load(html);
  const results = [];

  $('.ntg-search-listing__item').each((_, el) => {
    const type = $(el).find('.ntg-search-listing__type').first().text().trim();
    if (!/Decisions/i.test(type)) return; // drop generic "Pages" / "Sentencing Remarks"

    const title = $(el).find('.ntg-search-listing__title').first().text().trim();
    if (!title) return;

    // No title-level link on this site — pull the first document link instead
    // (prefer HTML over PDF/RTF if more than one format is offered).
    const links = $(el).find('a[href]');
    const htmlLink = links.filter((_, a) => /\.html?(\?|$)/i.test($(a).attr('href') || '')).first();
    const url = (htmlLink.length ? htmlLink : links.first()).attr('href');
    if (!url) return;

    // No catchwords/summary field is exposed by this search — thinner metadata than
    // every other jurisdiction here. Do not assume `description` is populated downstream.
    results.push({ title, url, matchedTerm: term });
  });

  return results;
});

// Shared plumbing for every live jurisdiction search: builds the term list (company name
// + director/trading names, suffix-stripped), fetches each term via `fetchFn`, filters
// with titleMatchesTerm, dedupes by URL, and tags each item with `jurisdiction`.
//
// `concurrent: true` runs the term loop via Promise.all instead of sequentially — used
// for the Puppeteer-backed fetchers (Federal, NT), where each term already queues
// through browser.js's own MAX_CONCURRENT_PAGES gate, so a second sequential layer here
// would just add redundant wall-clock latency without reducing total Puppeteer load.
// NSW/ACT (plain axios, no shared resource to queue for) stay sequential — there's no
// gate downstream for a sequential loop to be redundant with.
async function runJurisdictionSearch(companyName, directors, { fetchFn, jurisdiction, source, searchUrlFor, sourcesKey, concurrent = false }) {
  const strippedCompanyName = stripCompanySuffix(companyName);
  const terms = [strippedCompanyName, ...(directors || []).filter(Boolean).map(stripCompanySuffix)].filter(Boolean);

  // Retry once on failure (mirroring the retry pattern already established for the
  // retired asicDisqualified.js CAPTCHA/browser flow) before giving up on a term.
  // Distinguishes "this term genuinely returned 0 results" from "the fetch failed" —
  // without this, a Cloudflare-challenge timeout or a Puppeteer page-slot contention
  // failure (both real, expected-to-happen-sometimes conditions for the Federal/NT
  // fetchers) silently produced `results: []` with no error signal, indistinguishable
  // from an honest "no cases found." Confirmed in production: a BHP search returned
  // "no cases found" for Federal Court despite BHP having a substantial Federal Court
  // history — this is exactly that failure mode.
  const fetchOne = async (term) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const results = await fetchFn(term);
        return { results: results.filter((r) => titleMatchesTerm(r.title, term)), failed: false };
      } catch (err) {
        if (attempt === 1) return { results: [], failed: true, error: err };
      }
    }
  };

  let gathered;
  if (concurrent) {
    gathered = await Promise.all(terms.map(fetchOne));
  } else {
    gathered = [];
    for (const term of terms) gathered.push(await fetchOne(term));
  }

  const anyFailed = gathered.some((g) => g.failed);
  const allFailed = terms.length > 0 && gathered.every((g) => g.failed);

  // De-duplicate by URL, tagging each item with its jurisdiction so ReportSection's
  // showJurisdiction badge (already wired through to ResultCard) has something to render.
  const seen = new Set();
  const unique = gathered
    .flatMap((g) => g.results)
    .filter(({ url }) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .map((r) => ({ ...r, jurisdiction }));

  const manualSearchUrl = searchUrlFor(strippedCompanyName);

  // Every term failed (both attempts each) — an honest "search failed", not a fabricated
  // "checked, clean". Mirrors buildManualFallback's shape so this reads the same way in
  // the UI as a jurisdiction with no automated source at all.
  if (allFailed) {
    return {
      source,
      jurisdiction,
      category: 'legal',
      status: 'error',
      results: [],
      searchUrl: manualSearchUrl,
      sources: JURISDICTION_SOURCES[sourcesKey],
      error: 'Search failed',
      summary: `Could not complete the ${jurisdiction} courts search after retrying — try again or search manually`,
    };
  }

  const incompleteNote = anyFailed
    ? ' (search incomplete — one or more name variants could not be checked after retrying)'
    : '';

  return {
    source,
    jurisdiction,
    category: 'legal',
    results: unique,
    searchUrl: manualSearchUrl,
    sources: JURISDICTION_SOURCES[sourcesKey],
    summary:
      (unique.length > 0
        ? `Found ${unique.length} case(s) in ${jurisdiction} courts and tribunals`
        : `No cases found in ${jurisdiction} courts and tribunals`) + incompleteNote,
  };
}

function searchNswCaselaw(companyName, directors = []) {
  return runJurisdictionSearch(companyName, directors, {
    fetchFn: fetchNswTermResults,
    jurisdiction: 'NSW',
    source: 'NSW Caselaw',
    sourcesKey: 'nsw',
    searchUrlFor: (term) => `https://www.caselaw.nsw.gov.au/search?query=${encodeURIComponent(term)}`,
  });
}

function searchActJudgments(companyName, directors = []) {
  return runJurisdictionSearch(companyName, directors, {
    fetchFn: fetchActTermResults,
    jurisdiction: 'ACT',
    source: 'ACT Courts',
    sourcesKey: 'act',
    searchUrlFor: (term) => `https://www.courts.act.gov.au/judgment?query=${encodeURIComponent(term)}`,
  });
}

function searchFederalCourtJudgments(companyName, directors = []) {
  return runJurisdictionSearch(companyName, directors, {
    fetchFn: fetchFederalTermResults,
    jurisdiction: 'Federal',
    source: 'Federal Court of Australia — Judgments Search',
    sourcesKey: 'federal',
    searchUrlFor: (term) =>
      `https://search.judgments.fedcourt.gov.au/s/search.html?collection=fca~sp-judgments-internet&profile=judgments-internet&query=${encodeURIComponent(term)}`,
    concurrent: true,
  });
}

function searchNtSupremeCourt(companyName, directors = []) {
  return runJurisdictionSearch(companyName, directors, {
    fetchFn: fetchNtTermResults,
    jurisdiction: 'NT',
    source: 'NT Supreme Court',
    sourcesKey: 'nt',
    searchUrlFor: (term) => `https://supremecourt.nt.gov.au/search?queries_name_query=${encodeURIComponent(term)}`,
    concurrent: true,
  });
}

// qld, vic, wa, sa and tas have no free, unauthenticated, full-text search — see
// CLAUDE.md for the per-jurisdiction reachability findings. Returns an honest
// `status: 'error'` result (zero fabricated "checked, clean" claims) with a manual
// search link, rather than silently reporting no records found.
function buildManualFallback(jurisdiction) {
  const jLabel = JURISDICTION_LABELS[jurisdiction] || jurisdiction.toUpperCase();
  return {
    source: `${jLabel} Courts & Tribunals`,
    jurisdiction: jLabel,
    category: 'legal',
    status: 'error',
    results: [],
    searchUrl: MANUAL_SEARCH_URLS[jurisdiction],
    sources: JURISDICTION_SOURCES[jurisdiction] || [],
    error: 'No automated source',
    summary: `No automated full-text search available for ${jLabel} courts — search manually`,
  };
}

async function searchCourtRecords(companyName, directors = [], jurisdiction = 'federal') {
  if (jurisdiction === 'nsw') return searchNswCaselaw(companyName, directors);
  if (jurisdiction === 'act') return searchActJudgments(companyName, directors);
  if (jurisdiction === 'federal') return searchFederalCourtJudgments(companyName, directors);
  if (jurisdiction === 'nt') return searchNtSupremeCourt(companyName, directors);
  return buildManualFallback(jurisdiction);
}

module.exports = {
  searchCourtRecords,
  searchNswCaselaw,
  searchActJudgments,
  searchFederalCourtJudgments,
  searchNtSupremeCourt,
  buildManualFallback,
};
