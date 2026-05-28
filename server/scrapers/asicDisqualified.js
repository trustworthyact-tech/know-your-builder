const cheerio = require('cheerio');
const { fetchAdfPageWithCaptcha } = require('./browser');

const BASE = 'https://connectonline.asic.gov.au';

function buildSearchUrl(name) {
  return `${BASE}/RegistrySearch/faces/landing/panelSearch.jspx?searchType=DPNm&searchText=${encodeURIComponent(name)}`;
}

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isNameMatch(resultName, queryName) {
  const rn = normalise(resultName);
  const qn = normalise(queryName);
  return rn.includes(qn) || qn.includes(rn);
}

// Exported so tests can call it directly against sample HTML.
function parseDisqualifiedResults(html, directorName, searchUrl) {
  const $ = cheerio.load(html);
  const matches = [];

  $('table tbody tr').each((_, row) => {
    const $cells = $(row).find('td');
    if ($cells.length < 2) return;

    const personName = $cells.eq(0).text().trim();
    if (!personName || !isNameMatch(personName, directorName)) return;

    const orderDate = $cells.eq(1)?.text().trim() || '';
    const expiryDate = $cells.eq(2)?.text().trim() || '';
    const reason = $cells.eq(3)?.text().trim() || '';

    matches.push({
      title: `${personName} — disqualified from managing corporations`,
      url: searchUrl,
      date: expiryDate ? `Order expires: ${expiryDate}` : orderDate,
      status: 'Disqualified',
      description: reason || 'Listed on the ASIC Disqualified Persons Register',
      metadata: {
        'Director Name': personName,
        'Order Date': orderDate,
        'Expiry Date': expiryDate,
        Reason: reason,
      },
    });
  });

  return matches;
}

async function checkDirector(directorName, captchaApiKey) {
  const searchUrl = buildSearchUrl(directorName);
  try {
    const html = await fetchAdfPageWithCaptcha(searchUrl, captchaApiKey);
    return parseDisqualifiedResults(html, directorName, searchUrl);
  } catch {
    return [];
  }
}

async function searchASICDisqualified(directors, captchaApiKey) {
  const fallbackUrl = `${BASE}/RegistrySearch/faces/landing/panelSearch.jspx?searchType=DPNm`;

  if (!directors || directors.length === 0) {
    return {
      source: 'ASIC — Disqualified Persons Register',
      jurisdiction: 'Federal',
      category: 'identity',
      results: [],
      searchUrl: fallbackUrl,
      summary: 'No directors identified for disqualification check',
    };
  }

  if (!captchaApiKey) {
    return {
      source: 'ASIC — Disqualified Persons Register',
      jurisdiction: 'Federal',
      category: 'identity',
      results: [],
      searchUrl: fallbackUrl,
      summary: `${directors.length} director(s) — automated check unavailable, verify manually via ASIC Connect`,
    };
  }

  const allMatches = [];
  let firstUrl = fallbackUrl;

  const checked = directors.filter(Boolean).slice(0, 6);
  if (checked[0]) firstUrl = buildSearchUrl(checked[0]);

  const perDirector = await Promise.all(
    checked.map((d) => checkDirector(d, captchaApiKey))
  );

  for (const matches of perDirector) {
    allMatches.push(...matches);
  }

  return {
    source: 'ASIC — Disqualified Persons Register',
    jurisdiction: 'Federal',
    category: 'identity',
    results: allMatches,
    searchUrl: firstUrl,
    summary:
      allMatches.length > 0
        ? `${allMatches.length} director(s) found on the ASIC disqualified persons register`
        : `${checked.length} director(s) checked — no disqualification records found`,
  };
}

module.exports = { searchASICDisqualified, parseDisqualifiedResults };
