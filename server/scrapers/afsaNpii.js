const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://npii.afsa.gov.au';
const SEARCH_PATH = '/search.xhtml';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: `${BASE}/`,
};

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z\s]/g, '').trim();
}

// Split "Given Family" → { givenNames, surname }
function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { surname: '', givenNames: '' };
  if (parts.length === 1) return { surname: parts[0], givenNames: '' };
  return { surname: parts[parts.length - 1], givenNames: parts.slice(0, -1).join(' ') };
}

// Fetch the NPII search page and extract JSF session state
async function fetchSearchPage() {
  const url = `${BASE}${SEARCH_PATH}`;
  const res = await axios.get(url, {
    headers: HEADERS,
    timeout: 15000,
    maxRedirects: 5,
  });
  const $ = cheerio.load(res.data);
  const viewState = $('input[name="javax.faces.ViewState"]').val() || '';
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
