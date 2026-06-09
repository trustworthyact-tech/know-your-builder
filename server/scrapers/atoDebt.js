const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://insolvencynotices.asic.gov.au';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: 'https://insolvencynotices.asic.gov.au/',
};

// Keywords identifying ATO tax debt disclosure notices (Tax Administration Act s260-45)
const ATO_KEYWORDS = [
  'ato',
  'tax debt',
  'listed tax debt',
  '260-45',
  'tax administration act',
  'australian taxation office',
];

function isAtoDebtNotice(text) {
  const lower = (text || '').toLowerCase();
  return ATO_KEYWORDS.some((k) => lower.includes(k));
}

function buildSearchUrl(companyName, abn, acn) {
  // The ATO debt notice category uses a distinct filter on the same notices register
  const q = abn ? abn.replace(/\s/g, '') :
            acn ? acn.replace(/\s/g, '') :
            companyName || '';
  return `${BASE}/notices?q=${encodeURIComponent(q)}&noticeType=ATP`;
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

    const texts = $cells.map((_, c) => $(c).text().trim()).get();
    const fullText = texts.join(' ');
    if (!isAtoDebtNotice(fullText)) return;

    const noticeType = texts.find((t) => isAtoDebtNotice(t)) || 'ATO Listed Tax Debt';
    const entityName = texts.find((t) => t && !isAtoDebtNotice(t) && t.length > 2) || '';
    const date = texts.find((t) => /\d{1,2}[\s/.-]\w{3,}[\s/.-]\d{4}|\d{4}-\d{2}-\d{2}/.test(t)) || '';
    const amount = texts.find((t) => /\$[\d,]+/.test(t)) || '';

    results.push({
      title: entityName ? `${entityName} — ${noticeType}` : noticeType,
      url,
      date,
      status: 'ATO Tax Debt Disclosed',
      description: `ATO tax debt notice published by ASIC under Tax Administration Act s260-45${amount ? ` — ${amount}` : ''}`,
      metadata: {
        'Notice Type': noticeType,
        Entity: entityName,
        Date: date,
        Amount: amount,
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
      if (!isAtoDebtNotice(fullText)) return;

      const $link = $el.find('a').first();
      const href = $link.attr('href') || '';
      const url = resolveUrl(href) || searchUrl;

      const noticeType =
        $el.find('[class*="type"], [class*="category"]').first().text().trim() ||
        'ATO Listed Tax Debt';
      const entityName = $el.find('[class*="entity"], [class*="company"], [class*="name"]').text().trim();
      const date = $el.find('[class*="date"], time').first().text().trim();
      const amount = (fullText.match(/\$[\d,]+/) || [])[0] || '';

      results.push({
        title: entityName ? `${entityName} — ${noticeType}` : noticeType,
        url,
        date,
        status: 'ATO Tax Debt Disclosed',
        description: `ATO tax debt notice published by ASIC under Tax Administration Act s260-45${amount ? ` — ${amount}` : ''}`,
        metadata: {
          'Notice Type': noticeType,
          Entity: entityName,
          Date: date,
          Amount: amount,
        },
      });
    });

    if (results.length > 0) break;
  }

  return results;
}

async function searchAtoDebt(companyName, abn, acn) {
  const searchUrl = buildSearchUrl(companyName, abn, acn);
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
    source: 'ASIC Published Notices — ATO Tax Debt',
    jurisdiction: 'Federal',
    category: 'financial',
    results,
    searchUrl,
    summary:
      results.length > 0
        ? `${results.length} ATO tax debt disclosure(s) found — entity has a listed tax debt published by ASIC`
        : 'No ATO tax debt notices found in ASIC Published Notices',
  };
}

module.exports = { searchAtoDebt };
