const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://www.buildingandenergywa.gov.au';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: 'https://www.buildingandenergywa.gov.au/',
};

const ENFORCEMENT_KEYWORDS = [
  'prosecut',
  'penalt',
  'fine',
  'suspend',
  'cancel',
  'prohibit',
  'unlicensed',
  'unregistered',
  'illegal',
  'offence',
  'conviction',
  'court',
  'tribunal',
  'order',
  'disciplin',
  'caution',
  'infringement',
];

function isEnforcementOutcome(text) {
  const lower = (text || '').toLowerCase();
  return ENFORCEMENT_KEYWORDS.some((k) => lower.includes(k));
}

// Every significant word must appear in the text.
function nameMatchesEntity(text, companyName) {
  if (!companyName) return false;
  const words = companyName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((w) => lower.includes(w));
}

function buildSearchUrl(companyName, abn) {
  const q = abn ? abn.replace(/\s/g, '') : companyName || '';
  return `${BASE}/about/publications/media-releases?q=${encodeURIComponent(q)}`;
}

function resolveUrl(href) {
  if (!href) return '';
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}

function parseResults($, searchUrl, companyName) {
  const results = [];

  const selectors = [
    'article',
    '.news-item',
    '.media-release',
    '.search-result',
    '.listing-item',
    '[class*="release"] li',
    'li.result',
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
        status: 'WA Building & Energy enforcement action',
        description: description || 'WA Building and Energy enforcement or prosecution outcome',
        jurisdiction: 'WA',
        metadata: {
          Source: 'WA Building and Energy',
          Date: date,
        },
      });
    });

    if (results.length > 0) break;
  }

  return results;
}

async function searchWABuildingEnergy(companyName, abn) {
  const searchUrl = buildSearchUrl(companyName, abn);
  let results = [];

  try {
    const { data } = await axios.get(searchUrl, {
      headers: HEADERS,
      timeout: 20000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(data);
    results = parseResults($, searchUrl, companyName);
  } catch {
    // non-fatal — return empty results
  }

  return {
    source: 'WA Building and Energy',
    jurisdiction: 'WA',
    category: 'regulatory',
    results,
    searchUrl,
    summary:
      results.length > 0
        ? `${results.length} WA Building and Energy enforcement action(s) found`
        : 'No WA Building and Energy enforcement actions found for this entity',
  };
}

module.exports = { searchWABuildingEnergy };
