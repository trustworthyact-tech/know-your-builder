const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://www.vba.vic.gov.au';
const REGISTER_URL = `${BASE}/about/current-disciplinary-proceedings/register-of-disciplinary-proceedings`;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: 'https://www.vba.vic.gov.au/',
};

const DISCIPLINARY_KEYWORDS = [
  'cancel',
  'suspend',
  'disciplin',
  'caution',
  'reprimand',
  'revok',
  'prohibit',
  'order',
  'condition',
  'penalty',
  'deregistr',
  'show cause',
];

function isDisciplinaryEntry(text) {
  const lower = (text || '').toLowerCase();
  return DISCIPLINARY_KEYWORDS.some((k) => lower.includes(k));
}

// Every significant word must appear in the row text. Handles trading names and company suffixes.
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

function resolveUrl(href) {
  if (!href) return '';
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}

function parseTableRows($, companyName) {
  const results = [];

  $('table tbody tr').each((_, row) => {
    const $cells = $(row).find('td');
    if ($cells.length < 2) return;

    const fullText = $(row).text();
    if (!nameMatchesEntity(fullText, companyName)) return;

    const texts = $cells.map((_, c) => $(c).text().trim()).get();
    const $link = $(row).find('a').first();
    const href = $link.attr('href') || '';
    const url = resolveUrl(href) || REGISTER_URL;

    const name = texts[0] || '';
    const action = texts.find((t) => isDisciplinaryEntry(t)) || texts[1] || '';
    const date =
      texts.find((t) => /\d{1,2}[\s/.-]\w{3,}[\s/.-]\d{4}|\d{4}-\d{2}-\d{2}/.test(t)) || '';

    results.push({
      title: name || fullText.slice(0, 80),
      url,
      date,
      status: action || 'Disciplinary action',
      description: `VBA disciplinary proceeding — ${action || 'see register for details'}`,
      jurisdiction: 'VIC',
      metadata: {
        Source: 'Victorian Building Authority',
        Action: action,
        Date: date,
      },
    });
  });

  return results;
}

function parseCardLayout($, companyName) {
  const results = [];

  const selectors = ['article', '.field-items p', '.wysiwyg p', '.content-body p', 'li'];

  for (const sel of selectors) {
    const $items = $(sel);
    if ($items.length === 0) continue;

    $items.each((_, el) => {
      const $el = $(el);
      const fullText = $el.text();
      if (!nameMatchesEntity(fullText, companyName)) return;
      if (!isDisciplinaryEntry(fullText)) return;

      const $link = $el.find('a').first();
      const href = $link.attr('href') || '';
      const url = resolveUrl(href) || REGISTER_URL;

      results.push({
        title: $el.find('strong, b').first().text().trim() || fullText.slice(0, 100),
        url,
        date: '',
        status: 'Disciplinary action',
        description: fullText.slice(0, 200),
        jurisdiction: 'VIC',
        metadata: { Source: 'Victorian Building Authority' },
      });
    });

    if (results.length > 0) break;
  }

  return results;
}

async function searchVicBpc(companyName, abn) {
  let results = [];

  try {
    const { data } = await axios.get(REGISTER_URL, {
      headers: HEADERS,
      timeout: 20000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(data);

    results = parseTableRows($, companyName);
    if (results.length === 0) {
      results = parseCardLayout($, companyName);
    }
  } catch {
    // non-fatal — return empty results
  }

  return {
    source: 'Victorian Building Authority — Disciplinary Register',
    jurisdiction: 'VIC',
    category: 'regulatory',
    results,
    searchUrl: REGISTER_URL,
    summary:
      results.length > 0
        ? `${results.length} VBA disciplinary proceeding(s) found`
        : 'No VBA disciplinary proceedings found for this entity',
  };
}

module.exports = { searchVicBpc };
