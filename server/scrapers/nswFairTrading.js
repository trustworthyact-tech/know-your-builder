const axios = require('axios');

// NSW Fair Trading contractor licence register via OneGov JSON API.
// POST /api/Search/PerformSearch with licenceGroupCode="Trades" covers
// all Home Building Act contractor licences (builders, contractors, etc).
// No auth required — Origin/Referer headers must match the SPA host.

const API_BASE = 'https://api.onegov.nsw.gov.au/LicenceCheckService';
const SEARCH_URL = `${API_BASE}/api/Search/PerformSearch`;
const REGISTER_BASE = 'https://www.onegov.nsw.gov.au/publicregister';

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: 'https://www.onegov.nsw.gov.au',
  Referer: 'https://www.onegov.nsw.gov.au/publicregister/',
};

function nameMatchesEntity(text, query) {
  if (!query) return false;
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((w) => lower.includes(w));
}

async function fetchLicences(query) {
  const { data } = await axios.post(
    SEARCH_URL,
    {
      searchCriteria: query,
      licenceGroupCode: 'Trades',
      searchType: 'fulltext',
      rowsPerPage: 20,
    },
    { headers: HEADERS, timeout: 20000 }
  );
  return Array.isArray(data?.licenceSearchResults) ? data.licenceSearchResults : [];
}

async function searchNSWFairTrading(companyName, abn, directors) {
  const allResults = [];
  const seen = new Set();

  const queries = [
    companyName.replace(/\s*pty\s*ltd\.?\s*$/i, '').trim(),
    ...(directors || []).filter(Boolean),
  ];

  for (const query of queries) {
    try {
      const hits = await fetchLicences(query);
      for (const hit of hits) {
        const licensee = hit.licensee || '';
        if (!nameMatchesEntity(licensee, query)) continue;
        const key = `${hit.licenceNumber}|${licensee}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const url = hit.licenceID
          ? `${REGISTER_BASE}/#/publicregisterdetails/${hit.licenceID}`
          : `${REGISTER_BASE}/#/publicregister/search/Trades`;

        allResults.push({
          title: licensee,
          url,
          date: hit.expiryDate || '',
          status: hit.status || '',
          description: `${hit.licenceType || 'NSW Contractor Licence'} — Licence ${hit.licenceNumber || ''}`,
          jurisdiction: 'NSW',
          metadata: {
            Source: 'NSW Fair Trading',
            LicenceNumber: hit.licenceNumber,
            LicenceType: hit.licenceType,
            Status: hit.status,
            Expiry: hit.expiryDate,
            ABN: hit.abn,
          },
        });
      }
    } catch {
      // non-fatal
    }
  }

  const searchUrl = `${REGISTER_BASE}/#/publicregister/search/Trades`;
  return {
    source: 'NSW Fair Trading — Contractor Licence Register',
    jurisdiction: 'NSW',
    category: 'license',
    results: allResults,
    searchUrl,
    summary:
      allResults.length > 0
        ? `${allResults.length} NSW contractor licence record(s) found`
        : 'No NSW Fair Trading contractor licence records found',
  };
}

module.exports = { searchNSWFairTrading };
