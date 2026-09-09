const { fetchActLicenceRecords, fetchActDisciplinaryRecords } = require('./actLicencesDataset');

// ACT Access Canberra — List of Professionals (Socrata open-data API).
// No auth required. Company names are stored in the `surname` field;
// `given_names` is populated for individual practitioners.
// Building-relevant occupations: Builder, Building Surveyor, Building Assessor.
//
// This file also covers a second, separate dataset on the same Socrata portal:
// the Register of Disciplinary Actions (avib-prrz). Unlike the licence register
// above, it stores both company and individual names in a single combined
// `licensee_name` field (no surname/given_names split) and companies carry an
// `a_c_n` field instead of an ABN.
//
// WS1 (2026-09-09, reliability plan activities 1.5/1.6): both datasets moved from
// live per-query Socrata calls to bulk ingestion — see actLicencesDataset.js.
// Matching now happens locally against the full cached row set (same shape as
// vicBpc.js), which also removes the previous one-live-call-per-director-name cost.

const PORTAL_URL = 'https://www.data.act.gov.au/Business-and-Industry/List-of-Professionals/de4w-gbt3';
const DISCIPLINARY_PORTAL_URL = 'https://www.data.act.gov.au/Business-and-Industry/Register-Of-Disciplinary-Actions/avib-prrz';

const BUILDING_OCCUPATIONS = new Set(['Builder', 'Building Surveyor', 'Building Assessor']);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameMatchesEntity(text, query) {
  if (!query) return false;
  const words = query
    .toLowerCase()
    .split(/\s+/)
    // Strip punctuation from each token before building its \b-anchored regex. Found live
    // 2026-09-09 while verifying resolveActAssociatedNames against "Geocon Constructors
    // (ACT) Pty Ltd": a token that itself starts/ends with punctuation (e.g. "(act)") can
    // never satisfy \b at that position, since \b requires a word/non-word transition and
    // both the preceding space and the leading "(" are non-word — the match silently fails
    // regardless of whether the name is genuinely present in the text. Stripping punctuation
    // from the token (leaving the alphanumeric core, e.g. "act") lets \b anchor correctly
    // against the real word-boundary that still exists around it in the target text.
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(lower));
}

function toResultItem(hit, query) {
  const name = hit.surname
    ? `${hit.surname}${hit.given_names ? ', ' + hit.given_names : ''}`
    : query;

  const descParts = [hit.occupation, hit.description].filter(Boolean);
  if (hit.class_condition) descParts.push(hit.class_condition);
  if (hit.endorsement) descParts.push(hit.endorsement);

  return {
    title: name,
    url: PORTAL_URL,
    date: hit.expiry_date || '',
    status: hit.licence_status || '',
    description: descParts.join(' — ') || 'ACT Licence',
    jurisdiction: 'ACT',
    metadata: {
      Source: 'ACT Access Canberra',
      LicenceNumber: hit.cola_licence_number,
      Occupation: hit.occupation,
      Class: hit.description,
      Status: hit.licence_status,
      Expiry: hit.expiry_date,
      ACN: hit.licensee_acn,
      Partners: hit.partners,
      Nominees: hit.nominees,
    },
  };
}

// hit.nominees is a composite string like "NAME: licenceNumber-Occupation-Class", not a
// clean name — strips the trailing licence-detail portion before use. Defensively splits on
// ';' in case a firm has more than one partner/nominee — unverified against a multi-name
// fixture (only ever confirmed one name per field live), so this is a precaution, not a
// confirmed format.
function parseNames(field) {
  if (!field) return [];
  return field
    .split(';')
    .map((segment) => segment.split(':')[0].trim())
    .filter(Boolean);
}

// Partner / Nominee names for a company's ACT builder licence, straight from Access
// Canberra's own register — reliability plan WS3: a free substitute for ASIC's own officer
// data (DSP access paused until 2027, see CLAUDE.md's WS3 entries). Deliberately independent
// of searchACTLicences below rather than a "Phase A/B" split: fetchActLicenceRecords() reads
// an already-local dataset cache (WS1), not a live call, so calling it a second time here
// costs a cache read, not a duplicate HTTP request — not worth the complexity a hoisted-
// promise split would add. Fails open (returns []) on any error — director discovery is
// best-effort and must never block resolveDirectors()'s other 12 consumers.
async function resolveActAssociatedNames(companyName) {
  const strippedName = (companyName || '').replace(/\s*(?:pty|proprietary)?\.?\s*(?:ltd|limited)\.?\s*$/i, '').trim();
  if (!strippedName) return [];

  let records;
  try {
    ({ records } = await fetchActLicenceRecords());
  } catch {
    return [];
  }

  const names = [];
  for (const hit of records) {
    if (!BUILDING_OCCUPATIONS.has(hit.occupation)) continue;
    if (!nameMatchesEntity(hit.surname || '', strippedName)) continue;
    for (const name of parseNames(hit.partners)) names.push({ name, role: 'Partner' });
    for (const name of parseNames(hit.nominees)) names.push({ name, role: 'Nominee' });
  }
  return names;
}

async function searchACTLicences(companyName, abn, directors) {
  // Strip "Pty Ltd" so partial-word matches work against the registered name.
  const strippedName = companyName.replace(/\s*(?:pty|proprietary)?\.?\s*(?:ltd|limited)\.?\s*$/i, '').trim();
  const queries = [strippedName, ...(directors || [])].filter(Boolean);

  let records;
  try {
    ({ records } = await fetchActLicenceRecords());
  } catch (err) {
    return {
      source: 'ACT Access Canberra — Builder Licence Register',
      jurisdiction: 'ACT',
      category: 'license',
      status: 'error',
      results: [],
      searchUrl: PORTAL_URL,
      error: 'Search failed',
      summary: 'Could not reach the ACT licence register — try again or search manually',
    };
  }

  const allResults = [];
  const seen = new Set();

  for (const query of queries) {
    for (const hit of records) {
      if (!BUILDING_OCCUPATIONS.has(hit.occupation)) continue;
      const nameField = hit.given_names ? `${hit.given_names} ${hit.surname}` : hit.surname;
      if (!nameMatchesEntity(nameField, query)) continue;
      const key = hit.cola_licence_number || `${hit.surname}|${hit.expiry_date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allResults.push(toResultItem(hit, query));
    }
  }

  return {
    source: 'ACT Access Canberra — Builder Licence Register',
    jurisdiction: 'ACT',
    category: 'license',
    results: allResults,
    searchUrl: PORTAL_URL,
    summary:
      allResults.length > 0
        ? `${allResults.length} ACT builder licence record(s) found`
        : 'No ACT builder licence records found',
  };
}

// ── Register of Disciplinary Actions (avib-prrz) ────────────────────────────────

function toDisciplinaryResultItem(hit, query) {
  return {
    title: hit.licensee_name || query,
    url: DISCIPLINARY_PORTAL_URL,
    date: hit.action_date || '',
    status: hit.action_type || '',
    description: (hit.circumstances_reasons || '').slice(0, 300),
    jurisdiction: 'ACT',
    metadata: {
      Source: 'ACT Access Canberra',
      LicenceNumber: hit.licence_number,
      Occupation: hit.occupation,
      ActionType: hit.action_type,
      ActionDate: hit.action_date,
      Reasons: hit.circumstances_reasons,
      ACN: hit.a_c_n,
    },
  };
}

async function searchACTDisciplinary(companyName, abn, directors) {
  // A company's ABN is its two check digits followed by its ACN — derive a
  // candidate ACN from either a bare 9-digit ACN or an 11-digit ABN so a match
  // against a_c_n is still possible if the registered name in this dataset
  // doesn't textually match the searched company name.
  const abnDigits = (abn || '').replace(/\D/g, '');
  const acnDigits =
    abnDigits.length === 11 ? abnDigits.slice(2) : abnDigits.length === 9 ? abnDigits : '';

  // Strip "Pty Ltd" so partial-word matches work against the registered name.
  const strippedName = (companyName || '').replace(/\s*(?:pty|proprietary)?\.?\s*(?:ltd|limited)\.?\s*$/i, '').trim();
  const queries = [strippedName, ...(directors || [])].filter(Boolean);

  let records;
  try {
    ({ records } = await fetchActDisciplinaryRecords());
  } catch (err) {
    return {
      source: 'ACT Access Canberra — Register of Disciplinary Actions',
      jurisdiction: 'ACT',
      category: 'regulatory',
      status: 'error',
      results: [],
      searchUrl: DISCIPLINARY_PORTAL_URL,
      error: 'Search failed',
      summary: 'Could not reach the ACT disciplinary register — try again or search manually',
    };
  }

  const allResults = [];
  const seen = new Set();

  function addMatches(query) {
    for (const hit of records) {
      if (!BUILDING_OCCUPATIONS.has(hit.occupation)) continue;
      const hitAcnDigits = (hit.a_c_n || '').replace(/\D/g, '');
      const acnMatches = Boolean(acnDigits) && hitAcnDigits === acnDigits;
      if (!acnMatches && !nameMatchesEntity(hit.licensee_name, query)) continue;
      const key = `${hit.licence_number}|${hit.action_date}|${hit.action_type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allResults.push(toDisciplinaryResultItem(hit, query));
    }
  }

  // The ACN match is independent of any query string, so it needs to run at least
  // once even if `queries` is empty (e.g. no director names and an unmatchable name).
  if (queries.length > 0) {
    for (const query of queries) addMatches(query);
  } else if (acnDigits) {
    addMatches('');
  }

  return {
    source: 'ACT Access Canberra — Register of Disciplinary Actions',
    jurisdiction: 'ACT',
    category: 'regulatory',
    results: allResults,
    searchUrl: DISCIPLINARY_PORTAL_URL,
    summary:
      allResults.length > 0
        ? `${allResults.length} ACT disciplinary action(s) found`
        : 'No ACT disciplinary actions found',
  };
}

module.exports = { searchACTLicences, searchACTDisciplinary, resolveActAssociatedNames };
