const axios = require('axios');

// ACT Access Canberra — List of Professionals (Socrata open-data API).
// No auth required. Company names are stored in the `surname` field;
// `given_names` is populated for individual practitioners.
// Building-relevant occupations: Builder, Building Surveyor, Building Assessor.

const RESOURCE_URL = 'https://data.act.gov.au/resource/de4w-gbt3.json';
const PORTAL_URL = 'https://www.data.act.gov.au/Business-and-Industry/List-of-Professionals/de4w-gbt3';

const BUILDING_OCCUPATIONS = new Set(['Builder', 'Building Surveyor', 'Building Assessor']);

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

module.exports = { searchACTLicences };
