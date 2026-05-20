const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://connectonline.asic.gov.au';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: 'https://connectonline.asic.gov.au/',
};

function buildSearchUrl(name) {
  return `${BASE}/RegistrySearch/faces/landing/SearchRegisters.jspx?searchType=DPNm&searchText=${encodeURIComponent(name)}`;
}

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isNameMatch(resultName, queryName) {
  const rn = normalise(resultName);
  const qn = normalise(queryName);
  return rn.includes(qn) || qn.includes(rn);
}

async function checkDirector(directorName) {
  const searchUrl = buildSearchUrl(directorName);
  const matches = [];

  try {
    const { data } = await axios.get(searchUrl, {
      headers: HEADERS,
      timeout: 15000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(data);

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
  } catch {
    // non-fatal — leave matches empty
  }

  return matches;
}

async function searchASICDisqualified(directors) {
  const fallbackUrl = `${BASE}/RegistrySearch/faces/landing/SearchRegisters.jspx?searchType=DPNm`;

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

  const allMatches = [];
  let firstUrl = fallbackUrl;

  for (const director of directors) {
    if (!director) continue;
    if (firstUrl === fallbackUrl) firstUrl = buildSearchUrl(director);
    const matches = await checkDirector(director);
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
        : `${directors.length} director(s) checked — no disqualification records found`,
  };
}

module.exports = { searchASICDisqualified };
