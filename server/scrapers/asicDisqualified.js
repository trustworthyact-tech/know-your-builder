// Name-matching helpers for the ASIC Banned and Disqualified Persons check.
//
// The live ASIC Connect scrape that used to live in this file (searchASICDisqualified,
// checkDirector, parseDisqualifiedResults, fetchAdfDpnSearch) was retired 2026-08-19 in
// favour of ASIC's own bulk dataset on data.gov.au — see asicDpnDataset.js and
// asicDpnMatch.js for the current implementation, and
// ASIC_DPN_BULK_DATASET_MIGRATION_PLAN.md / CLAUDE.md's "Incomplete work" section
// (2026-08-18/19 entries) for why. These helpers are still shared, unchanged, by
// asicDpnMatch.js.

const BASE = 'https://connectonline.asic.gov.au';
const DPN_FALLBACK_URL = `${BASE}/RegistrySearch/faces/landing/panelSearch.jspx?searchType=DPNm`;

function buildSearchUrl(name) {
  return `${DPN_FALLBACK_URL}&searchText=${encodeURIComponent(name)}`;
}

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

// Order-independent word match — handles ASIC surname-first formatting.
// "ROBERTS Veronica" correctly matches query "Veronica Roberts".
function isNameMatch(resultName, queryName) {
  const rWords = new Set(normalise(resultName).split(/\s+/));
  const qWords = normalise(queryName).split(/\s+/).filter(Boolean);
  return qWords.length > 0 && qWords.every((w) => rWords.has(w));
}

module.exports = { isNameMatch, normalise, buildSearchUrl };
