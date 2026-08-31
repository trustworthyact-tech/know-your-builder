const axios = require('axios');

// VIC Victorian Building Authority — Practitioner Licence Register.
//
// Previously scraped live via Puppeteer against the BAMS Salesforce Experience
// Cloud SPA (https://bams.vba.vic.gov.au/bams/s/practitioner-search), driving
// the browser and intercepting an internal Aura ApexAction.execute response.
// That register is also published as a CKAN datastore on Victoria's open-data
// portal — same underlying data, updated weekly, no auth, no browser needed.
//
// API: https://discover.data.vic.gov.au/api/3/action/datastore_search
// Resource: 3599fa1f-29f3-417e-8679-1842e2e6e2df
// `q` does full-text search against Account Name; `filters` (JSON) supports
// exact-match lookups, e.g. by ACN.

const DATASTORE_URL = 'https://discover.data.vic.gov.au/api/3/action/datastore_search';
const RESOURCE_ID = '3599fa1f-29f3-417e-8679-1842e2e6e2df';
const SEARCH_URL = 'https://www.vba.vic.gov.au/tools/find-practitioner';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameMatchesEntity(text, query) {
  if (!query) return false;
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(lower));
}

async function fetchByName(query) {
  const { data } = await axios.get(DATASTORE_URL, {
    params: {
      resource_id: RESOURCE_ID,
      q: query,
      limit: 50,
    },
    headers: { Accept: 'application/json' },
    timeout: 20000,
  });
  return data?.result?.records || [];
}

function toResultItem(record) {
  return {
    title: record['Account Name'] || '',
    url: SEARCH_URL,
    date: record['Expires'] || '',
    status: record['Accreditation Status'] || '',
    description: `${record['Limitation'] || 'VIC Building Licence'} — Accreditation ${record['Accreditation ID'] || 'N/A'}`,
    jurisdiction: 'VIC',
    metadata: {
      Source: 'Victorian Building Authority',
      AccreditationID: record['Accreditation ID'],
      Limitation: record['Limitation'],
      Status: record['Accreditation Status'],
      ABN: record['ABN'],
      ACN: record['ACN'],
      Commenced: record['Commenced'],
      Expires: record['Expires'],
    },
  };
}

async function searchVicVbaLicence(companyName, abn, directors) {
  const allResults = [];
  const seen = new Set();

  function addHits(records, query) {
    for (const record of records) {
      const name = record['Account Name'] || '';
      if (!nameMatchesEntity(name, query)) continue;
      const key = record['Accreditation ID'] || `${name}|${record['Limitation']}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allResults.push(toResultItem(record));
    }
  }

  const strippedName = (companyName || '').replace(/\s*(?:pty|proprietary)?\.?\s*(?:ltd|limited)\.?\s*$/i, '').trim();
  const queries = [strippedName, ...(directors || []).filter(Boolean)].filter(Boolean);

  for (const query of queries) {
    try {
      addHits(await fetchByName(query), query);
    } catch (err) {
      console.warn('[vicVbaLicence] query failed:', query, err.message);
      // non-fatal — continue with remaining queries
    }
  }

  return {
    source: 'Victorian Building Authority — Licence Register',
    jurisdiction: 'VIC',
    category: 'license',
    results: allResults,
    searchUrl: SEARCH_URL,
    summary:
      allResults.length > 0
        ? `${allResults.length} VBA licence record(s) found`
        : 'No VBA licence records found for this entity',
  };
}

module.exports = { searchVicVbaLicence };
