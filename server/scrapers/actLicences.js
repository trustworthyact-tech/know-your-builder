const axios = require('axios');

// ACT Access Canberra — List of Professionals (Socrata open-data API).
// No auth required. Company names are stored in the `surname` field;
// `given_names` is populated for individual practitioners.
// Building-relevant occupations: Builder, Building Surveyor, Building Assessor.
//
// This file also queries a second, separate dataset on the same Socrata portal:
// the Register of Disciplinary Actions (avib-prrz). Unlike the licence register
// above, it stores both company and individual names in a single combined
// `licensee_name` field (no surname/given_names split) and companies carry an
// `a_c_n` field instead of an ABN.

const RESOURCE_URL = 'https://data.act.gov.au/resource/de4w-gbt3.json';
const PORTAL_URL = 'https://www.data.act.gov.au/Business-and-Industry/List-of-Professionals/de4w-gbt3';

const DISCIPLINARY_RESOURCE_URL = 'https://data.act.gov.au/resource/avib-prrz.json';
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
    .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(lower));
}

// Escape single quotes for Socrata $where strings.
function socrataEscape(s) {
  return s.replace(/'/g, "''");
}

async function fetchByName(query) {
  const { data } = await axios.get(RESOURCE_URL, {
    params: {
      '$where': `upper(surname) like upper('%${socrataEscape(query)}%')`,
      '$limit': 50,
    },
    headers: { Accept: 'application/json' },
    timeout: 20000,
  });
  return Array.isArray(data) ? data : [];
}

async function fetchByDirector(directorName) {
  // Individual practitioners: surname = last name, given_names = first name(s).
  // Search the combined field so "John Smith" matches surname=SMITH, given_names=JOHN.
  const { data } = await axios.get(RESOURCE_URL, {
    params: {
      '$where': `upper(concat(given_names,' ',surname)) like upper('%${socrataEscape(directorName)}%')`,
      '$limit': 20,
    },
    headers: { Accept: 'application/json' },
    timeout: 20000,
  });
  return Array.isArray(data) ? data : [];
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

async function searchACTLicences(companyName, abn, directors) {
  const allResults = [];
  const seen = new Set();

  function addHits(hits, query) {
    for (const hit of hits) {
      if (!BUILDING_OCCUPATIONS.has(hit.occupation)) continue;
      const nameField = hit.given_names
        ? `${hit.given_names} ${hit.surname}`
        : hit.surname;
      if (!nameMatchesEntity(nameField, query)) continue;
      const key = hit.cola_licence_number || `${hit.surname}|${hit.expiry_date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allResults.push(toResultItem(hit, query));
    }
  }

  // Strip "Pty Ltd" so partial-word matches work against the registered name.
  const strippedName = companyName.replace(/\s*pty\s*ltd\.?\s*$/i, '').trim();

  try {
    addHits(await fetchByName(strippedName), strippedName);
  } catch {
    // non-fatal
  }

  for (const director of (directors || []).filter(Boolean)) {
    try {
      addHits(await fetchByDirector(director), director);
    } catch {
      // non-fatal
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

async function fetchDisciplinaryByName(query, acnDigits) {
  const clauses = [];
  if (query) {
    clauses.push(`upper(licensee_name) like upper('%${socrataEscape(query)}%')`);
  }
  if (acnDigits) {
    // a_c_n is stored inconsistently ("607 387 208" vs "687010251"); this substring
    // match catches the unspaced form. The spaced form is still caught downstream
    // by the digit-stripped comparison in addHits, as long as the name clause above
    // also matched the row.
    clauses.push(`upper(a_c_n) like upper('%${acnDigits}%')`);
  }
  if (clauses.length === 0) return [];

  const { data } = await axios.get(DISCIPLINARY_RESOURCE_URL, {
    params: {
      '$where': clauses.length > 1 ? `(${clauses.join(' or ')})` : clauses[0],
      '$limit': 50,
    },
    headers: { Accept: 'application/json' },
    timeout: 20000,
  });
  return Array.isArray(data) ? data : [];
}

async function fetchDisciplinaryByDirector(directorName) {
  // licensee_name is a single combined field for both companies and individuals —
  // no given_names/surname split to concat, unlike the licence register above.
  const { data } = await axios.get(DISCIPLINARY_RESOURCE_URL, {
    params: {
      '$where': `upper(licensee_name) like upper('%${socrataEscape(directorName)}%')`,
      '$limit': 20,
    },
    headers: { Accept: 'application/json' },
    timeout: 20000,
  });
  return Array.isArray(data) ? data : [];
}

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
  const allResults = [];
  const seen = new Set();

  // A company's ABN is its two check digits followed by its ACN — derive a
  // candidate ACN from either a bare 9-digit ACN or an 11-digit ABN so a match
  // against a_c_n is still possible if the registered name in this dataset
  // doesn't textually match the searched company name.
  const abnDigits = (abn || '').replace(/\D/g, '');
  const acnDigits =
    abnDigits.length === 11 ? abnDigits.slice(2) : abnDigits.length === 9 ? abnDigits : '';

  function addHits(hits, query) {
    for (const hit of hits) {
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

  // Strip "Pty Ltd" so partial-word matches work against the registered name.
  const strippedName = (companyName || '').replace(/\s*pty\s*ltd\.?\s*$/i, '').trim();

  if (strippedName || acnDigits) {
    try {
      addHits(await fetchDisciplinaryByName(strippedName, acnDigits), strippedName);
    } catch {
      // non-fatal
    }
  }

  for (const director of (directors || []).filter(Boolean)) {
    try {
      addHits(await fetchDisciplinaryByDirector(director), director);
    } catch {
      // non-fatal
    }
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

module.exports = { searchACTLicences, searchACTDisciplinary };
