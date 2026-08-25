'use strict';

const { fetchDpnRows } = require('./asicDpnDataset');
const { isNameMatch, buildSearchUrl } = require('./asicDisqualified');

const BASE = 'https://connectonline.asic.gov.au';
const DPN_FALLBACK_URL = `${BASE}/RegistrySearch/faces/landing/panelSearch.jspx?searchType=DPNm`;

// No type-based filtering — every row in this dataset already belongs to the Banned
// and Disqualified Persons register (REGISTER_NAME is constant across the whole
// file), so unlike the live ASIC Connect scrape (which had to filter noisy shared
// HTML down to disqualification-type rows via a /disqualif/i regex on the rendered
// type text), there's no noise here to filter. All BD_PER_TYPE values surface:
// "Disq. Director", "Banned Securities", "Credit Banned & Disqualified",
// "AFS Banned & Disqualified" — decided 2026-08-19, see
// ASIC_DPN_BULK_DATASET_MIGRATION_PLAN.md.

function formatDate(row) {
  return row.BD_PER_END_DT ? `Order expires: ${row.BD_PER_END_DT}` : row.BD_PER_START_DT;
}

// Groups a director's matching rows by BD_PER_DOC_NUM — one result per
// disqualification order, rather than one per name/address variant (decided
// 2026-08-19: the live scrape's per-variant behaviour was itself an artifact of an
// unreliable dedup key, not a deliberate design — see the plan doc).
function buildResultsForDirector(rows, directorName) {
  const matchingRows = rows.filter((r) => r.BD_PER_NAME && isNameMatch(r.BD_PER_NAME, directorName));
  if (matchingRows.length === 0) return [];

  const byDocNum = new Map();
  for (const row of matchingRows) {
    const key = row.BD_PER_DOC_NUM || row.BD_PER_NAME;
    if (!byDocNum.has(key)) byDocNum.set(key, []);
    byDocNum.get(key).push(row);
  }

  const results = [];
  for (const groupRows of byDocNum.values()) {
    const primary = groupRows[0];
    const names = [...new Set(groupRows.map((r) => r.BD_PER_NAME).filter(Boolean))];
    const addresses = [
      ...new Set(
        groupRows
          .map((r) => [r.BD_PER_ADD_LOCAL, r.BD_PER_ADD_STATE].filter(Boolean).join(' '))
          .filter(Boolean)
      ),
    ];
    const primaryAddress = [primary.BD_PER_ADD_LOCAL, primary.BD_PER_ADD_STATE].filter(Boolean).join(' ');

    const metadata = {
      'Director Name': primary.BD_PER_NAME,
      'Order Date': primary.BD_PER_START_DT,
      'Expiry Date': primary.BD_PER_END_DT,
      Type: primary.BD_PER_TYPE,
      Address: primaryAddress,
    };
    if (names.length > 1) metadata['Also Known As'] = names.filter((n) => n !== primary.BD_PER_NAME).join('; ');
    if (addresses.length > 1) metadata['Known Addresses'] = addresses.join('; ');

    results.push({
      title: `${primary.BD_PER_NAME} — disqualified from managing corporations`,
      url: buildSearchUrl(directorName),
      date: formatDate(primary),
      status: 'Disqualified',
      description: primaryAddress
        ? `Address: ${primaryAddress}`
        : 'Listed on the ASIC Disqualified Persons Register',
      metadata,
    });
  }
  return results;
}

/**
 * Checks each director name against the cached ASIC Banned and Disqualified Persons
 * dataset (data.gov.au, refreshed weekly — see asicDpnDataset.js). Same output shape
 * as the live-scrape searchASICDisqualified() in asicDisqualified.js — riskGrouper.ts
 * and ReportContent.tsx need no changes to consume this.
 *
 * No per-director cap: unlike the live scrape (capped at 6 directors because each one
 * cost a real captcha solve + browser page), checking a name against an in-memory
 * dataset is effectively free, so every supplied director is checked.
 *
 * _fetchDpnRows is injectable so tests can simulate dataset-unavailable and
 * stale-cache scenarios without touching the network.
 */
async function searchASICDisqualifiedFromDataset(directors, _fetchDpnRows = fetchDpnRows) {
  if (!directors || directors.length === 0) {
    return {
      source: 'ASIC — Disqualified Persons Register',
      jurisdiction: 'Federal',
      category: 'identity',
      results: [],
      searchUrl: DPN_FALLBACK_URL,
      summary: 'No directors identified for disqualification check',
    };
  }

  const checked = directors.filter(Boolean);
  const firstUrl = checked[0] ? buildSearchUrl(checked[0]) : DPN_FALLBACK_URL;

  let rows, stale, cachedAt;
  try {
    ({ rows, stale, cachedAt } = await _fetchDpnRows());
  } catch (err) {
    // Equivalent to checkDirector's failed:true — the dataset itself is unavailable
    // (no live fetch succeeded, and no cached copy exists either), not a genuine
    // clean result. Distinct from "checked, found nothing" — see the plan doc.
    return {
      source: 'ASIC — Disqualified Persons Register',
      jurisdiction: 'Federal',
      category: 'identity',
      results: [],
      searchUrl: DPN_FALLBACK_URL,
      summary: `${checked.length} director(s) — register data unavailable, verify manually via ASIC Connect`,
    };
  }

  const allResults = checked.flatMap((name) => buildResultsForDirector(rows, name));

  const staleNote = stale
    ? ` (register data may be a few days old — live refresh failed, showing cached copy from ${cachedAt.toDateString()})`
    : '';

  const summary =
    allResults.length > 0
      ? `${allResults.length} director(s) found on the ASIC disqualified persons register${staleNote}`
      : `${checked.length} director(s) checked — no disqualification records found${staleNote}`;

  return {
    source: 'ASIC — Disqualified Persons Register',
    jurisdiction: 'Federal',
    category: 'identity',
    results: allResults,
    searchUrl: firstUrl,
    summary,
  };
}

module.exports = { searchASICDisqualifiedFromDataset, buildResultsForDirector };
