const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://insolvencynotices.asic.gov.au';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: 'https://insolvencynotices.asic.gov.au/',
};

// Notice types that indicate insolvency, administration, or winding-up
const INSOLVENCY_KEYWORDS = [
  'external administration',
  'voluntary administration',
  'administrator appointed',
  'liquidat',
  'winding up',
  'winding-up',
  'receiver',
  'deed of company arrangement',
  'doca',
  'provisional liquidator',
  'court-ordered',
];

function isInsolvencyNotice(text) {
  const lower = (text || '').toLowerCase();
  return INSOLVENCY_KEYWORDS.some((k) => lower.includes(k));
}

function buildSearchUrl(companyName, abn) {
  const q = abn ? abn.replace(/\s/g, '') : companyName || '';
  return `${BASE}/notices?q=${encodeURIComponent(q)}`;
}

function resolveUrl(href) {
  if (!href) return '';
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}

function parseTableRows($, searchUrl) {
  const results = [];

  $('table tbody tr').each((_, row) => {
    const $cells = $(row).find('td');
    if ($cells.length < 2) return;

    const $link = $(row).find('a').first();
    const href = $link.attr('href') || '';
    const url = resolveUrl(href) || searchUrl;

    // Notice type is typically first or second column; entity name in another column
    const texts = $cells.map((_, c) => $(c).text().trim()).get();
    const noticeType = texts.find((t) => isInsolvencyNotice(t)) || texts[0] || '';
    if (!noticeType || !isInsolvencyNotice(noticeType)) return;

    const entityName = texts.find((t, i) => i > 0 && t && !isInsolvencyNotice(t)) || '';
    const date = texts.find((t) => /\d{1,2}[\s/.-]\w{3,}[\s/.-]\d{4}|\d{4}-\d{2}-\d{2}/.test(t)) || '';

    results.push({
      title: entityName ? `${entityName} — ${noticeType}` : noticeType,
      url,
      date,
      status: noticeType,
      description: `Published in ASIC Insolvency Notices — ${noticeType}`,
      metadata: {
        'Notice Type': noticeType,
        Entity: entityName,
        Date: date,
      },
    });
  });

  return results;
}

function parseCardLayout($, searchUrl) {
  const results = [];

  const selectors = [
    '.notice-item',
    '.search-result-item',
    '[class*="notice-result"]',
    '[class*="notice-card"]',
    'article',
  ];

  for (const sel of selectors) {
    const $items = $(sel);
    if ($items.length === 0) continue;

    $items.each((_, el) => {
      const $el = $(el);
      const fullText = $el.text();
      if (!isInsolvencyNotice(fullText)) return;

      const $link = $el.find('a').first();
      const href = $link.attr('href') || '';
      const url = resolveUrl(href) || searchUrl;

      const noticeType =
        $el.find('[class*="type"], [class*="category"], [class*="notice-type"]').first().text().trim() ||
        $el.find('strong, h3, h4').first().text().trim();
      const entityName = $el.find('[class*="entity"], [class*="company"], [class*="name"]').text().trim();
      const date = $el.find('[class*="date"], time').first().text().trim();

      results.push({
        title: entityName ? `${entityName} — ${noticeType}` : noticeType || fullText.slice(0, 80),
        url,
        date,
        status: noticeType,
        description: `Published in ASIC Insolvency Notices`,
        metadata: {
          'Notice Type': noticeType,
          Entity: entityName,
          Date: date,
        },
      });
    });

    if (results.length > 0) break;
  }

  return results;
}

async function searchAsicInsolvency(companyName, abn) {
  const searchUrl = buildSearchUrl(companyName, abn);
  let results = [];

  try {
    const { data } = await axios.get(searchUrl, {
      headers: HEADERS,
      timeout: 20000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(data);

    results = parseTableRows($, searchUrl);
    if (results.length === 0) {
      results = parseCardLayout($, searchUrl);
    }
  } catch {
    // non-fatal — return empty results
  }

  return {
    source: 'ASIC Published Notices',
    jurisdiction: 'Federal',
    category: 'financial',
    results,
    searchUrl,
    summary:
      results.length > 0
        ? `${results.length} insolvency notice(s) found (external administration, winding up, or liquidation)`
        : 'No insolvency notices found in ASIC Published Notices',
  };
}

module.exports = { searchAsicInsolvency };
