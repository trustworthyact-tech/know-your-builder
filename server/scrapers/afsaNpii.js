const axios = require('axios');
const cheerio = require('cheerio');

// HARD BLOCKED (investigated 2026-07-07): npii.afsa.gov.au is decommissioned.
// AFSA migrated the NPII to the Bankruptcy Register Search (BRS) at
// services.afsa.gov.au/brs/. The BRS 3-step POST flow was fully reverse-engineered:
//   1. GET /brs/search → CSRF token + cookies
//   2. POST /brs/search-add-email → name criteria → "Your email address" page
//   3. POST /brs/searchbyname → customerEmailOpted=false → REDIRECTS to payment
// Every search (including fictitious names) redirects to:
//   https://services.afsa.gov.au/payment-service/pay/transaction/paymentoptions
// There is NO free tier — viewing any result requires per-search payment.
// This scraper returns empty results until an AFSA BRS account + payment is arranged.
// See server/tests/README.md "Common failure patterns" for full investigation notes.
const BASE = 'https://services.afsa.gov.au';
const SEARCH_PATH = '/brs/search';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: `${BASE}/`,
};

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z\s]/g, '').trim();
}

function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { surname: '', givenNames: '' };
  if (parts.length === 1) return { surname: parts[0], givenNames: '' };
  // ASIC Connect officer tables use SURNAME-first format (e.g. "ROBERTS Digby").
  // Detect: first word is 2+ uppercase letters only.
  const firstWord = parts[0];
  if (/^[A-Z]{2,}$/.test(firstWord)) {
    return { surname: firstWord, givenNames: parts.slice(1).join(' ') };
  }
  // Standard given-name-first: surname is the last word.
  return { surname: parts[parts.length - 1], givenNames: parts.slice(0, -1).join(' ') };
}

// Fetch the BRS search page and extract session state.
// The old NPII used JSF ViewState; the new BRS uses CSRF tokens.
// viewState is returned as empty string so callers that check it
// will bail out gracefully rather than submitting a malformed POST.
async function fetchSearchPage() {
  const url = `${BASE}${SEARCH_PATH}`;
  const res = await axios.get(url, {
    headers: HEADERS,
    timeout: 15000,
    maxRedirects: 5,
  });
  const $ = cheerio.load(res.data);
  const viewState = '';
  const cookies = [].concat(res.headers['set-cookie'] || []).join('; ');
  return { viewState, cookies };
}

// POST the search form and parse results
async function postSearch(surname, givenNames, viewState, cookies) {
  const url = `${BASE}${SEARCH_PATH}`;
  const results = [];

  // Build a form-style POST body as URLSearchParams
  const params = new URLSearchParams();
  if (viewState) params.set('javax.faces.ViewState', viewState);
  // Common JSF form field naming — try both flat and namespaced variants
  params.set('searchForm', 'searchForm');
  params.set('searchForm:surname', surname);
  params.set('searchForm:givenName', givenNames);
  params.set('searchForm:searchType', 'DEBTOR_NAME');
  params.set('searchForm:searchButton', 'Search');
  params.set('javax.faces.source', 'searchForm:searchButton');
  params.set('javax.faces.partial.execute', '@all');
  params.set('javax.faces.partial.render', '@all');

  const res = await axios.post(url, params.toString(), {
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies,
    },
    timeout: 20000,
    maxRedirects: 5,
  });

  const $ = cheerio.load(res.data);

  $('table tbody tr').each((_, row) => {
    const $cells = $(row).find('td');
    if ($cells.length < 2) return;

    // Verify name appears in the row text so we don't collect unrelated results
    const rowText = $(row).text();
    if (!normalise(rowText).includes(normalise(surname))) return;

    // Columns vary across NPII page versions — read defensively
    const col0 = $cells.eq(0).text().trim();
    const col1 = $cells.eq(1).text().trim();
    const col2 = $cells.eq(2)?.text().trim() || '';
    const col3 = $cells.eq(3)?.text().trim() || '';
    const col4 = $cells.eq(4)?.text().trim() || '';

    // Determine which column is the administration type and which is the name
    // Common layouts: (AdminType | Name | DOB | AdminNo | Date | Status)
    //             or: (Name | AdminType | AdminNo | Status)
    let adminType = '';
    let personName = '';
    let adminNo = '';
    let date = '';
    let status = '';

    const adminTypePattern = /bankruptcy|debt agreement|personal insolvency|part ix|part x/i;

    if (adminTypePattern.test(col0)) {
      adminType = col0;
      personName = col1;
      adminNo = col2;
      date = col3;
      status = col4;
    } else if (adminTypePattern.test(col1)) {
      personName = col0;
      adminType = col1;
      adminNo = col2;
      status = col3;
    } else {
      // Fallback: treat first column as person name, second as type
      personName = col0;
      adminType = col1;
      adminNo = col2;
      date = col3;
      status = col4;
    }

    if (!personName && !adminType) return;

    results.push({
      title: [personName, adminType].filter(Boolean).join(' — '),
      url: `${BASE}${SEARCH_PATH}`,
      date: date || undefined,
      status: status || undefined,
      description: adminType || undefined,
      metadata: {
        'Administration Type': adminType,
        'Administration Number': adminNo,
        Date: date,
        Status: status,
      },
    });
  });

  return results;
}

async function searchPersonNpii(fullName) {
  const { surname, givenNames } = splitName(fullName);
  if (!surname) return [];

  try {
    const { viewState, cookies } = await fetchSearchPage();
    return await postSearch(surname, givenNames, viewState, cookies);
  } catch {
    return [];
  }
}

async function searchAfsaNpii(directorNames) {
  const searchUrl = `${BASE}${SEARCH_PATH}`;

  if (!directorNames || directorNames.length === 0) {
    return {
      source: 'AFSA — National Personal Insolvency Index (Deep Check)',
      jurisdiction: 'Federal',
      category: 'financial',
      results: [],
      searchUrl,
      summary: 'No directors identified for personal insolvency check',
    };
  }

  // Check up to 5 directors
  const directorsToCheck = directorNames.slice(0, 5);
  const allResults = [];

  for (const director of directorsToCheck) {
    if (!director) continue;
    const records = await searchPersonNpii(director);
    allResults.push(...records);
  }

  return {
    source: 'AFSA — National Personal Insolvency Index (Deep Check)',
    jurisdiction: 'Federal',
    category: 'financial',
    results: allResults,
    searchUrl,
    summary:
      allResults.length > 0
        ? `${allResults.length} personal insolvency record(s) found for director(s) (deep check)`
        : `${directorsToCheck.length} director(s) checked — no NPII records found`,
  };
}

module.exports = { searchAfsaNpii };
