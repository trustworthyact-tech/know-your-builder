const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

// Ensure SCRAPERAPI_KEY is available even when this module is loaded outside the
// main server process (e.g. `node server/tests/test-austlii.js` directly, without
// the `--env-file=.env` flag used by the npm start/dev scripts). dotenv does not
// override already-set env vars, so this is a no-op when the server itself already
// loaded server/.env via --env-file.
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// URL path prefixes used to filter results by jurisdiction.
// mask_path is NOT sent to AustLII — it excludes specialist tribunals (QCAT, VCAT, SAT etc.)
// from its search index even when their cases live under the same path. Instead we do a
// global search and post-filter by URL prefix here.
const JURISDICTION_PATH = {
  federal: '/au/cases/cth',
  qld: '/au/cases/qld',
  nsw: '/au/cases/nsw',
  vic: '/au/cases/vic',
  wa: '/au/cases/wa',
  sa: '/au/cases/sa',
  nt: '/au/cases/nt',
  act: '/au/cases/act',
  tas: '/au/cases/tas',
};

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

// Key courts and tribunals per jurisdiction for the report
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

// Words too generic to use as an entity-match signal in case titles.
const COMMON_WORDS = new Set([
  'pty', 'ltd', 'limited', 'the', 'and', 'of', 'a', 'in', 'for', 'by', 'no',
  'trading', 'services', 'group', 'australia', 'australian', 'holdings',
  'trust', 'construction', 'constructions', 'building', 'builders',
  'management', 'solutions', 'operations', 'projects', 'enterprise', 'enterprises',
]);

// Returns true when at least one distinctive word from `term` appears in `title`.
// Prevents AustLII's word-OR search from returning cases that only share a
// generic word (e.g. "Services") with the searched entity.
function titleMatchesTerm(title, term) {
  const words = term
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !COMMON_WORDS.has(w));
  if (words.length === 0) return true; // no distinctive words — can't filter
  const lower = title.toLowerCase();
  return words.some((w) => lower.includes(w));
}

// Pending-promise cache: term → Promise<ResultItem[]>
// Deduplicates concurrent calls from all 9 jurisdiction searches for the same term
// so only one ScraperAPI request is made per term per search.
const pendingFetches = new Map();

function fetchTermResults(term) {
  if (pendingFetches.has(term)) return pendingFetches.get(term);

  const promise = (async () => {
    const scraperApiKey = process.env.SCRAPERAPI_KEY;
    const searchUrl = `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(term)}&results=20`;
    const fetchUrl = scraperApiKey
      ? `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(searchUrl)}`
      : searchUrl;

    const { data } = await axios.get(fetchUrl, { timeout: 30_000 });
    const $ = cheerio.load(data);
    const results = [];

    $('li').each((_, el) => {
      const link = $(el).find('a').first();
      const href = link.attr('href');
      const title = link.text().trim();
      if (!href || !title || !href.includes('/cases/')) return;

      const snippet = $(el).text().replace(title, '').trim().replace(/\s+/g, ' ').slice(0, 200);
      const fullUrl = href.startsWith('http') ? href : `https://www.austlii.edu.au${href}`;
      results.push({ title, url: fullUrl, description: snippet || undefined, matchedTerm: term });
    });

    // Fallback: older AustLII numbered-list format
    if (results.length === 0) {
      $('ol li').each((_, el) => {
        const link = $(el).find('a').first();
        const href = link.attr('href');
        const title = link.text().trim();
        if (!href || !title) return;
        const fullUrl = href.startsWith('http') ? href : `https://www.austlii.edu.au${href}`;
        const snippet = $(el).text().replace(title, '').trim().replace(/\s+/g, ' ').slice(0, 200);
        results.push({ title, url: fullUrl, description: snippet || undefined, matchedTerm: term });
      });
    }

    return results;
  })().then(
    (results) => {
      // Success: keep cached for 30 s so all 9 concurrent jurisdiction calls share it.
      setTimeout(() => pendingFetches.delete(term), 30_000);
      return results;
    },
    (err) => {
      // Failure: evict immediately so the next request retries rather than replaying
      // a stale rejection.
      pendingFetches.delete(term);
      throw err;
    }
  );

  pendingFetches.set(term, promise);
  return promise;
}

async function searchAustLII(companyName, directors = [], jurisdiction = 'federal') {
  const pathPrefix = JURISDICTION_PATH[jurisdiction] || '';
  const jLabel = JURISDICTION_LABELS[jurisdiction] || jurisdiction.toUpperCase();

  const terms = [companyName, ...(directors || []).filter(Boolean)];
  const allResults = [];

  for (const term of terms) {
    if (!term) continue;
    try {
      const results = await fetchTermResults(term);
      // Keep only results whose URL falls under this jurisdiction's path
      // AND whose case title contains at least one distinctive word from the search term.
      const filtered = results.filter(r => r.url.includes(pathPrefix) && titleMatchesTerm(r.title, term));
      allResults.push(...filtered);
    } catch {
      // skip this term on error
    }
  }

  // De-duplicate by URL
  const seen = new Set();
  const unique = allResults.filter(({ url }) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  const primarySearchUrl = `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(companyName)}&results=20`;

  return {
    source: `${jLabel} Courts & Tribunals`,
    jurisdiction: jLabel,
    category: 'legal',
    results: unique,
    searchUrl: primarySearchUrl,
    sources: JURISDICTION_SOURCES[jurisdiction] || [],
    summary:
      unique.length > 0
        ? `Found ${unique.length} case(s) in ${jLabel} courts and tribunals`
        : `No cases found in ${jLabel} courts and tribunals`,
  };
}

module.exports = { searchAustLII };
