const axios = require('axios');

// NSW contractor licence register via the Verify NSW public register API.
// The old OneGov SPA (www.onegov.nsw.gov.au/publicregister) has been retired —
// it now redirects straight to the Verify NSW homepage, which is why deep
// links into it landed on a landing page instead of the record. Verify NSW
// (verify.licence.nsw.gov.au) is the live replacement; its API still requires
// no auth, just Origin/Referer matching the SPA host.

const API_BASE = 'https://verify.licence.nsw.gov.au/publicregisterapi/api/v1/licence';
const SEARCH_URL = `${API_BASE}/search/advQuery`;
const REGISTER_BASE = 'https://verify.licence.nsw.gov.au';

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: REGISTER_BASE,
  Referer: `${REGISTER_BASE}/`,
};

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

async function fetchLicences(query) {
  const { data } = await axios.post(
    SEARCH_URL,
    {
      licenceGroup: 'Trades',
      search: query,
      autoComplete: false,
      pageNumber: 0,
      pageSize: 20,
      licenceTypes: [],
    },
    { headers: HEADERS, timeout: 20000 }
  );
  return Array.isArray(data?.results) ? data.results : [];
}

// A licence's current/expired status says nothing about whether it also
// carries compliance history (penalty notices, disciplinary action, etc) —
// that only shows up on the per-licence details endpoint, so it has to be
// fetched separately per hit.
async function fetchComplianceInfo(licenceType, licenceId) {
  const url = `${API_BASE}/search/details/${encodeURIComponent(licenceType)}/${encodeURIComponent(licenceId)}`;
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 20000 });
    const cd = data?.componentData;
    if (!cd) return null;
    const complianceSummary = Array.isArray(cd.complianceSummary) ? cd.complianceSummary : [];
    const totalEvents = complianceSummary.reduce((sum, c) => sum + (c.count || 0), 0);
    const flaggedByNotification = (cd.notifications || []).some(
      (n) => n.RelatedComponent === 'Compliance' || /compliance/i.test(n.type || '')
    );
    return { hasComplianceIssue: flaggedByNotification || totalEvents > 0, totalEvents, complianceSummary };
  } catch {
    return null; // non-fatal — leave ComplianceHistory unset rather than assert "none"
  }
}

async function searchNSWFairTrading(companyName, abn, directors) {
  const allResults = [];
  const seen = new Set();

  const queries = [
    companyName.replace(/\s*(?:pty|proprietary)?\.?\s*(?:ltd|limited)\.?\s*$/i, '').trim(),
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

        const url = hit.licenceId && hit.licenceType
          ? `${REGISTER_BASE}/details/${encodeURIComponent(hit.licenceType)}/${encodeURIComponent(hit.licenceId)}`
          : `${REGISTER_BASE}/home/trades`;

        const compliance = hit.licenceId && hit.licenceType
          ? await fetchComplianceInfo(hit.licenceType, hit.licenceId)
          : null;

        const complianceSuffix = compliance?.hasComplianceIssue ? ' — compliance history on record' : '';

        allResults.push({
          title: licensee,
          url,
          date: hit.expires || '',
          status: hit.status || '',
          description: `${hit.licenceTypeFriendly || 'NSW Contractor Licence'} — Licence ${hit.licenceNumber || ''}${complianceSuffix}`,
          jurisdiction: 'NSW',
          metadata: {
            Source: 'NSW Fair Trading',
            LicenceNumber: hit.licenceNumber,
            LicenceType: hit.licenceTypeFriendly,
            Status: hit.status,
            Expiry: hit.expires,
            ABN: hit.ABN,
            ...(compliance
              ? {
                  ComplianceHistory: compliance.hasComplianceIssue
                    ? `Yes (${compliance.totalEvents} recorded event(s)) — see licence record for details`
                    : 'None recorded',
                }
              : {}),
          },
        });
      }
    } catch {
      // non-fatal
    }
  }

  const searchUrl = `${REGISTER_BASE}/home/trades`;
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
