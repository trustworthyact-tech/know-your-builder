const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://www.fairwork.gov.au';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: 'https://www.fairwork.gov.au/',
};

const ENFORCEMENT_KEYWORDS = [
  'penalty',
  'penalised',
  'penalized',
  'court',
  'litigation',
  'underpaid',
  'underpayment',
  'back pay',
  'backpay',
  'back-pay',
  'enforceable undertaking',
  'contravent',
  'fine',
  'prosecution',
  'ordered to pay',
  'compliance notice',
  'infringement notice',
  'injunction',
];

function isEnforcementOutcome(text) {
  const lower = (text || '').toLowerCase();
  return ENFORCEMENT_KEYWORDS.some((k) => lower.includes(k));
}

// Every significant word in the entity name must appear in the text to avoid false positives.
function nameMatchesEntity(text, companyName) {
  if (!companyName) return true;
  const words = companyName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((w) => lower.includes(w));
}

function buildSearchUrl(companyName, abn) {
  const q = abn ? abn.replace(/\s/g, '') : companyName || '';
  return `${BASE}/newsroom/news-and-media-search?keys=${encodeURIComponent(q)}`;
}

function resolveUrl(href) {
  if (!href) return '';
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}

function parseNewsItems($, searchUrl, companyName) {
  const results = [];

  // Primary selector for /newsroom/news-and-media-search?keys= results page
  // Structure: ol.searchResultsInfo > li.media
  //   title: .search-highlight a  (href is relative)
  //   description: .clsResultDescr span
  const $primary = $('ol.searchResultsInfo li.media, li.media');
  if ($primary.length > 0) {
    $primary.each((_, el) => {
      const $el = $(el);
      const $link = $el.find('.search-highlight a').first();
      const title = $link.text().trim();
      if (!title) return;

      const href = $link.attr('href') || '';
      const url = resolveUrl(href) || searchUrl;
      const description = $el.find('.clsResultDescr span').first().text().trim() || '';
      const fullText = title + ' ' + description;

      if (!isEnforcementOutcome(fullText)) return;
      if (!nameMatchesEntity(fullText, companyName)) return;

      results.push({
        title,
        url,
        date: '',
        status: 'FWO enforcement outcome',
        description: description || 'Fair Work Ombudsman enforcement action or litigation outcome',
        jurisdiction: 'Federal',
        metadata: {
          Source: 'Fair Work Ombudsman',
          Date: '',
        },
      });
    });

    if (results.length > 0) return results;
  }

  // Fallback selectors for legacy page structure
  const selectors = [
    'article',
    '.news-item',
    '.search-result-item',
    '.listing-item',
    '.module-content li',
    '[class*="news-list"] li',
    'li.result',
    '.views-row',
  ];

  for (const sel of selectors) {
    const $items = $(sel);
    if ($items.length === 0) continue;

    $items.each((_, el) => {
      const $el = $(el);
      const fullText = $el.text();

      if (!isEnforcementOutcome(fullText)) return;
      if (!nameMatchesEntity(fullText, companyName)) return;

      const $link = $el.find('a').first();
      const href = $link.attr('href') || '';
      const url = resolveUrl(href) || searchUrl;
      const title =
        $el.find('h2, h3, h4, .title, .heading').first().text().trim() ||
        $link.text().trim() ||
        fullText.slice(0, 100);
      const date =
        $el.find('time').attr('datetime') ||
        $el.find('time, [class*="date"], .date').first().text().trim() ||
        '';
      const description = $el.find('p').first().text().trim() || '';

      if (!title) return;

      results.push({
        title,
        url,
        date,
        status: 'FWO enforcement outcome',
        description: description || 'Fair Work Ombudsman enforcement action or litigation outcome',
        jurisdiction: 'Federal',
        metadata: {
          Source: 'Fair Work Ombudsman',
          Date: date,
        },
      });
    });

    if (results.length > 0) break;
  }

  return results;
}

async function fetchFwoResults(query, entityName) {
  const url = `${BASE}/newsroom/news-and-media-search?keys=${encodeURIComponent(query)}`;
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 20000, maxRedirects: 5 });
    const $ = cheerio.load(data);
    return parseNewsItems($, url, entityName);
  } catch {
    return [];
  }
}

async function searchFWO(companyName, abn, directors) {
  const searchUrl = buildSearchUrl(companyName, abn);
  const allResults = [];

  // Company/ABN search
  const companyResults = await fetchFwoResults(
    abn ? abn.replace(/\s/g, '') : companyName,
    companyName
  );
  allResults.push(...companyResults);

  // Per-director searches
  for (const director of (directors || [])) {
    if (!director) continue;
    const hits = await fetchFwoResults(director, director);
    allResults.push(...hits);
  }

  // Deduplicate by URL
  const seen = new Set();
  const results = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  return {
    source: 'Fair Work Ombudsman',
    jurisdiction: 'Federal',
    category: 'payment',
    results,
    searchUrl,
    summary:
      results.length > 0
        ? `${results.length} FWO enforcement outcome(s) found — wage underpayment, litigation, or compliance action`
        : 'No Fair Work Ombudsman enforcement outcomes found',
  };
}

module.exports = { searchFWO };
