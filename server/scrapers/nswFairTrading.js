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
    // Strip punctuation from each token — see the identical fix + explanation in
    // actLicences.js's nameMatchesEntity (found live 2026-09-09 against a "(ACT)"-suffixed
    // company name). Same duplicated helper, same bug, same fix.
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
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

// A licence's current/expired status says nothing about whether it also carries compliance
// history (penalty notices, disciplinary action, etc), or who's associated with it — both
// only show up on the per-licence details endpoint, so it's fetched once per hit and shared
// by complianceFromDetails() and associatedNamesFromDetails() below, rather than fetching
// the same URL twice for two different purposes.
async function fetchLicenceDetails(licenceType, licenceId) {
  const url = `${API_BASE}/search/details/${encodeURIComponent(licenceType)}/${encodeURIComponent(licenceId)}`;
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 20000 });
    return data?.componentData ?? null;
  } catch {
    return null; // non-fatal — callers treat a null details fetch as "unknown", not "none"
  }
}

function complianceFromDetails(cd) {
  if (!cd) return null;
  const complianceSummary = Array.isArray(cd.complianceSummary) ? cd.complianceSummary : [];
  const totalEvents = complianceSummary.reduce((sum, c) => sum + (c.count || 0), 0);
  const flaggedByNotification = (cd.notifications || []).some(
    (n) => n.RelatedComponent === 'Compliance' || /compliance/i.test(n.type || '')
  );
  return { hasComplianceIssue: flaggedByNotification || totalEvents > 0, totalEvents, complianceSummary };
}

// Director / Nominated Supervisor names for this licence, straight from NSW Fair Trading's
// own register — reliability plan WS3: a free substitute for ASIC's own officer data, which
// requires DSP access currently paused until 2027 (see CLAUDE.md's WS3 entries). "Director"
// is a high-confidence signal (an actual company officer, per NSW's own labelling);
// "Nominated Supervisor" is the licence's required qualified-person role, which may or may
// not also be a company officer — both are returned, but tagged by role so downstream
// consumers/reports can tell them apart rather than treating them as equally certain.
const ASSOCIATED_ROLES = new Set(['director', 'nominated supervisor']);
function associatedNamesFromDetails(cd) {
  if (!cd || !Array.isArray(cd.associatedRoles)) return [];
  const names = [];
  for (const roleGroup of cd.associatedRoles) {
    if (!ASSOCIATED_ROLES.has((roleGroup.name || '').toLowerCase())) continue;
    for (const party of roleGroup.parties || []) {
      if (party?.name) names.push({ name: party.name, role: roleGroup.name });
    }
  }
  return names;
}

// Runs one query (company name or a director's name) against the licence search, dedupes
// against the shared `seen` set, and builds both the ResultItems for it and whatever
// associated names its licence detail fetches turn up. Shared by the primary company-name
// lookup (fetchNswCompanyLookup, below — what resolveDirectors() depends on) and the
// per-director enrichment loop in searchNSWFairTrading, so there's exactly one place that
// knows how to turn a raw licence hit into a ResultItem.
async function fetchAndBuildResultsForQuery(query, seen) {
  const items = [];
  const associatedNames = [];
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

      const details = hit.licenceId && hit.licenceType
        ? await fetchLicenceDetails(hit.licenceType, hit.licenceId)
        : null;
      const compliance = complianceFromDetails(details);
      const associated = associatedNamesFromDetails(details);
      associatedNames.push(...associated);

      const complianceSuffix = compliance?.hasComplianceIssue ? ' — compliance history on record' : '';
      const director = associated.find((a) => a.role.toLowerCase() === 'director');
      const supervisor = associated.find((a) => a.role.toLowerCase() === 'nominated supervisor');

      items.push({
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
          ...(director ? { Director: director.name } : {}),
          ...(supervisor ? { NominatedSupervisor: supervisor.name } : {}),
        },
      });
    }
  } catch {
    // non-fatal
  }
  return { items, associatedNames };
}

function stripCompanySuffix(companyName) {
  return companyName.replace(/\s*(?:pty|proprietary)?\.?\s*(?:ltd|limited)\.?\s*$/i, '').trim();
}

// The "Phase A" primary lookup — company name only, no director input. This is the piece
// index.js hoists once and resolveDirectors() depends on (reliability plan WS3): it's what
// discovers director/nominated-supervisor names in the first place, so it can't itself take
// resolveDirectors()'s output as an input without creating a circular dependency. Returns
// `seen` too, so searchNSWFairTrading below can reuse it directly instead of re-running this
// same query a second time.
async function fetchNswCompanyLookup(companyName) {
  const seen = new Set();
  const { items, associatedNames } = await fetchAndBuildResultsForQuery(stripCompanySuffix(companyName), seen);
  return { items, associatedNames, seen };
}

// `preFetchedPrimary` is fetchNswCompanyLookup()'s already-resolved result (from index.js's
// hoisted, timed-out, fail-open promise) — when present, the company-name query below is
// skipped entirely rather than re-fetched, since it's the exact same request. The per-director
// loop still makes its own live calls — those are genuinely different queries, not something
// Phase A could have already covered.
async function searchNSWFairTrading(companyName, abn, directors, preFetchedPrimary) {
  const allResults = [];
  const seen = preFetchedPrimary?.seen ?? new Set();

  if (preFetchedPrimary) {
    allResults.push(...preFetchedPrimary.items);
  } else {
    const { items } = await fetchAndBuildResultsForQuery(stripCompanySuffix(companyName), seen);
    allResults.push(...items);
  }

  for (const directorQuery of (directors || []).filter(Boolean)) {
    const { items } = await fetchAndBuildResultsForQuery(directorQuery, seen);
    allResults.push(...items);
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

module.exports = { searchNSWFairTrading, fetchNswCompanyLookup };
