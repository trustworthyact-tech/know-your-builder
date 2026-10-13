const { readCachedLicenceRecords, readCachedDisciplinaryRecords } = require('./actLicencesDataset');
const { staleFields } = require('./validateResult');
const { NAME_ONLY, asIdentity, classifyMatch, entityNames, licenceSummary, makeNameMatcher } = require('./licenceMatching');

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
// Matching happens locally against the full cached row set (same shape as
// vicBpc.js), which also removes the previous one-live-call-per-director-name cost.
//
// The three functions below read that cache via readCachedLicenceRecords()/
// readCachedDisciplinaryRecords() (datasetStore.js, Postgres, ~150-300ms) — not
// fetchActLicenceRecords()/fetchActDisciplinaryRecords() (the full live Socrata
// walk in actLicencesDataset.js), which only the background refresh job should
// call. Found 2026-09-15: these functions were calling the live-walk versions
// on every search request — the licence dataset's walk alone measured ~43s
// against this key's 20s manifest timeout, the main cause of the breaker
// reading "degraded" in production despite the cache being warm and correct.

const DISCIPLINARY_PORTAL_URL = 'https://www.data.act.gov.au/Business-and-Industry/Register-Of-Disciplinary-Actions/avib-prrz';

// Found live 2026-09-24 (a real user report): every licence result's `url` used to point
// at data.act.gov.au's own dataset page (de4w-gbt3), but that's purely a dataset metadata/
// export page (OData access, column list, "Create a visualization") with no browsable
// grid or per-row view at all — confirmed by driving it with a real browser. Access
// Canberra runs a genuinely live, searchable public register at
// services.accesscanberra.act.gov.au instead, split by occupation via a `registerid`
// param. Mapping confirmed against real data, not guessed:
// queried de4w-gbt3's own distinct `occupation` values directly (Builder/Building
// Assessor/Building Surveyor among others), then confirmed "Building Surveyor" licences
// live under registerid=certifiers by loading that register and reading its own "Filter by
// Class Description" list, which explicitly includes "General/Principal/Government
// Building Surveyor" — Access Canberra's UI label doesn't match the dataset's occupation
// string for this one, so this isn't a guessable 1:1 name mapping.
//
// This is the portal-search fallback, not a true per-individual deep link — that register
// is a Salesforce Experience Cloud / Lightning Web Components page (Shadow DOM), and
// confirming whether its per-row "Details" control resolves to a shareable URL needs more
// investigation than this pass covers. Still a real improvement: a live, correctly-scoped,
// human-searchable register beats a bulk-dataset export page with no search at all.
const OCCUPATION_REGISTER_IDS = {
  Builder: 'licensed-builders',
  'Building Assessor': 'building-assessors-public-register',
  'Building Surveyor': 'certifiers',
};
const REGISTERS_PORTAL_URL = 'https://services.accesscanberra.act.gov.au/s/public-registers';

function registerUrlForOccupation(occupation) {
  const registerId = OCCUPATION_REGISTER_IDS[occupation];
  return registerId
    ? `https://services.accesscanberra.act.gov.au/s/public-registers/construction-licences?registerid=${registerId}`
    : REGISTERS_PORTAL_URL;
}

const BUILDING_OCCUPATIONS = new Set(['Builder', 'Building Surveyor', 'Building Assessor']);

function toResultItem(hit, query, provenance = {}) {
  const name = hit.surname
    ? `${hit.surname}${hit.given_names ? ', ' + hit.given_names : ''}`
    : query;

  const descParts = [hit.occupation, hit.description].filter(Boolean);
  if (hit.class_condition) descParts.push(hit.class_condition);
  if (hit.endorsement) descParts.push(hit.endorsement);

  return {
    title: name,
    url: registerUrlForOccupation(hit.occupation),
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
      ...provenance,
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

function licenceNameField(hit) {
  return hit.given_names ? `${hit.given_names} ${hit.surname}` : hit.surname || '';
}

// Licence numbers in a nominees field ("NICKOLAS JAI CONSTABLE: 20091091-Builder-Class C" →
// "20091091") — the nominee's own licence, which is how a person's licence is tied to a company
// record by number rather than by name (LICENCE_MATCHING_PLAN.md 2b.4).
function nomineeLicenceNumbers(field) {
  return [...String(field || '').matchAll(/:\s*(\d+)/g)].map((m) => m[1]);
}

// Classifies one ACT licence row against the entity (licenceMatching.js). `licensee_acn` holds
// an ACN or an 11-digit ABN, spaced or not (LICENCE_MATCHING_PLAN.md finding 3) — compared
// digit-wise against both. Returns null for rows that don't belong to the entity, including
// rejected ones (name matches, identifiers differ).
function classifyLicenceRow(hit, identity, matchers) {
  const { match, matchedBy } = classifyMatch(
    { identifiers: [hit.licensee_acn], names: [licenceNameField(hit)] },
    identity,
    matchers
  );
  return match === 'confirmed' || match === 'name-only' ? matchedBy : null;
}

// One pass over the building-occupation rows, sorting each into:
//   - entity rows: the searched entity's own licences (ACN/ABN first, then its names);
//   - person rows: a listed person's own licence, matched by their name. Confirmed
//     ('Linked on licence record') only when its number is a nominee number on one of the
//     entity's confirmed licences; otherwise 'Name only — verify' (could be a namesake);
//   - linked-company rows: another company licence a listed person appears on as partner or
//     nominee (Phase 2b.2 — e.g. Frank Walmsley → Turnkey, though he holds no licence). Confirmed
//     only when tied by a confirmed nominee licence number; a name in the partners/nominees list
//     is a name match ('Name only — verify').
// `people` are person names (typed, or discovered from licence records). Matching is local and
// free, so it's uncapped.
function matchActLicenceRows(records, identity, people) {
  const entityMatchers = entityNames(identity).map(makeNameMatcher);
  const personMatchers = [...new Set((people || []).filter(Boolean))].map((name) => ({ name, matches: makeNameMatcher(name) }));
  const rows = records.filter((hit) => BUILDING_OCCUPATIONS.has(hit.occupation));

  const entityRows = [];
  const entityKeys = new Set();
  const confirmedNomineeNumbers = new Set();
  for (const hit of rows) {
    const matchedBy = classifyLicenceRow(hit, identity, entityMatchers);
    if (!matchedBy) continue;
    entityRows.push({ hit, matchedBy });
    entityKeys.add(hit.cola_licence_number);
    if (matchedBy !== NAME_ONLY) for (const n of nomineeLicenceNumbers(hit.nominees)) confirmedNomineeNumbers.add(n);
  }

  const personRows = [];
  const linkedCompanyRows = [];
  if (personMatchers.length === 0) return { entityRows, personRows, linkedCompanyRows };

  const confirmedPersonNumbers = new Map(); // licence number → person name
  for (const hit of rows) {
    if (entityKeys.has(hit.cola_licence_number) || !hit.given_names) continue;
    const person = personMatchers.find((p) => p.matches(licenceNameField(hit)));
    if (!person) continue;
    const confirmed = confirmedNomineeNumbers.has(String(hit.cola_licence_number));
    if (confirmed) confirmedPersonNumbers.set(String(hit.cola_licence_number), person.name);
    personRows.push({ hit, person: person.name, matchedBy: confirmed ? 'Linked on licence record' : NAME_ONLY });
  }

  for (const hit of rows) {
    if (entityKeys.has(hit.cola_licence_number) || hit.given_names) continue;
    // Tied by a confirmed person's licence number — a link even when the nominee's name is
    // written differently ("N J CONSTABLE").
    const tiedNumber = nomineeLicenceNumbers(hit.nominees).find((n) => confirmedPersonNumbers.has(n));
    if (tiedNumber) {
      const person = confirmedPersonNumbers.get(tiedNumber);
      linkedCompanyRows.push({ hit, person, role: 'Nominee', confidence: 'confirmed', matchedBy: `Linked company — via ${person}` });
      continue;
    }
    const listed = [
      ...parseNames(hit.partners).map((name) => ({ name, role: 'Partner' })),
      ...parseNames(hit.nominees).map((name) => ({ name, role: 'Nominee' })),
    ];
    let link = null;
    for (const { name, role } of listed) {
      const person = personMatchers.find((p) => p.matches(name));
      if (person) {
        link = { person: person.name, role };
        break;
      }
    }
    if (!link) continue;
    linkedCompanyRows.push({ hit, ...link, confidence: 'name-only', matchedBy: NAME_ONLY });
  }
  return { entityRows, personRows, linkedCompanyRows };
}

async function readLicenceRows(_readCachedLicenceRecords) {
  const { records } = await _readCachedLicenceRecords();
  return records;
}

// Partner / Nominee names for a company's ACT builder licence, straight from Access
// Canberra's own register — reliability plan WS3: a free substitute for ASIC's own officer
// data (DSP access paused until 2027, see CLAUDE.md's WS3 entries). Deliberately independent
// of searchACTLicences below rather than a "Phase A/B" split: fetchActLicenceRecords() reads
// an already-local dataset cache (WS1), not a live call, so calling it a second time here
// costs a cache read, not a duplicate HTTP request — not worth the complexity a hoisted-
// promise split would add. Fails open (returns []) on any error — director discovery is
// best-effort and must never block resolveDirectors()'s other consumers.
//
// Since LICENCE_MATCHING_PLAN.md Phase 2, licences are matched to the entity by ACN/ABN first,
// then by any of its names (legal, business, trust, typed). People from a name-only licence
// carry `confidence: 'name-only'`.
async function resolveActAssociatedNames(identityOrName, _readCachedLicenceRecords = readCachedLicenceRecords) {
  const identity = asIdentity(identityOrName);
  if (entityNames(identity).length === 0 && !identity.abn && !identity.acn) return [];
  let records;
  try {
    records = await readLicenceRows(_readCachedLicenceRecords);
  } catch {
    return [];
  }
  const names = [];
  for (const { hit, matchedBy } of matchActLicenceRows(records, identity, []).entityRows) {
    const confidence = matchedBy === NAME_ONLY ? 'name-only' : 'confirmed';
    for (const name of parseNames(hit.partners)) names.push({ name, role: 'Partner', confidence });
    for (const name of parseNames(hit.nominees)) names.push({ name, role: 'Nominee', confidence });
  }
  return names;
}

// Other companies the given people appear on as partner/nominee (Phase 2b.2), in the shape the
// orchestrator merges with NSW's linked companies: { name, abn, acn, licenceNumber, via,
// confidence, source }. Fails open to [] — this only widens the searches.
async function resolveActLinkedCompanies(identityOrName, people, _readCachedLicenceRecords = readCachedLicenceRecords) {
  if (!(people || []).some(Boolean)) return [];
  let records;
  try {
    records = await readLicenceRows(_readCachedLicenceRecords);
  } catch {
    return [];
  }
  return matchActLicenceRows(records, asIdentity(identityOrName), people).linkedCompanyRows.map(({ hit, person, role, confidence }) => {
    const digits = (hit.licensee_acn || '').replace(/\D/g, '');
    return {
      name: hit.surname,
      abn: digits.length === 11 ? digits : '',
      acn: digits.length === 9 ? digits : '',
      licenceNumber: hit.cola_licence_number,
      person,
      via: `${person} (${role})`,
      confidence,
      source: 'ACT',
    };
  });
}

// `identityOrName` is a licenceMatching.js identity, or a plain company name (+ `abn`) for
// standalone use. `directors` are person names to match individually (local, free).
async function searchACTLicences(identityOrName, abn, directors, _readCachedLicenceRecords = readCachedLicenceRecords) {
  const identity = asIdentity(identityOrName, abn);

  let records, stale, cachedAt;
  try {
    ({ records, stale, cachedAt } = await _readCachedLicenceRecords());
  } catch (err) {
    return {
      source: 'ACT Access Canberra — Builder Licence Register',
      jurisdiction: 'ACT',
      category: 'license',
      status: 'error',
      results: [],
      searchUrl: REGISTERS_PORTAL_URL,
      error: 'Search failed',
      summary: 'Could not reach the ACT licence register — try again or search manually',
    };
  }

  const { entityRows, personRows, linkedCompanyRows } = matchActLicenceRows(records, identity, directors);
  const entityName = identity.legalName || identity.typedName;
  const allResults = [
    ...entityRows.map(({ hit, matchedBy }) => toResultItem(hit, entityName, { MatchedBy: matchedBy })),
    ...personRows.map(({ hit, person, matchedBy }) => toResultItem(hit, person, { MatchedBy: matchedBy, LinkedVia: `Person: ${person}` })),
    ...linkedCompanyRows.map(({ hit, person, role, matchedBy }) =>
      toResultItem(hit, hit.surname, { MatchedBy: matchedBy, LinkedCompany: hit.surname, LinkedVia: `${person} (${role})` })
    ),
  ];

  return {
    source: 'ACT Access Canberra — Builder Licence Register',
    jurisdiction: 'ACT',
    category: 'license',
    results: allResults,
    searchUrl: REGISTERS_PORTAL_URL,
    summary: licenceSummary(allResults, identity, { found: 'ACT builder licence record(s)', none: 'ACT builder licence' }),
    ...staleFields(stale, cachedAt),
  };
}

// ── Register of Disciplinary Actions (avib-prrz) ────────────────────────────────

function toDisciplinaryResultItem(hit, query, provenance = {}) {
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
      ...provenance,
    },
  };
}

// Matched by `a_c_n` (ACN, or an ABN stored in that field) first, then by the entity's names,
// then by linked companies (Phase 2b.3 — each matched by its own ACN/ABN or name), then by person
// names. A person-name match is 'Name only — verify'. A linked-company action carries
// `Linked company — via <person>` only when the link is confirmed and the action matched the
// company's identifier; otherwise 'Name only — verify'.
async function searchACTDisciplinary(
  identityOrName,
  abn,
  directors,
  _readCachedDisciplinaryRecords = readCachedDisciplinaryRecords,
  linkedCompanies = []
) {
  const identity = asIdentity(identityOrName, abn);
  const entityMatchers = entityNames(identity).map(makeNameMatcher);
  const people = (directors || []).filter(Boolean).map((d) => ({ name: d, matcher: makeNameMatcher(d) }));
  const linked = (linkedCompanies || []).map((c) => {
    const cIdentity = { legalName: c.name, typedName: c.name, abn: c.abn || '', acn: c.acn || '', possibleAcn: '', businessNames: [], trustName: '' };
    return { company: c, identity: cIdentity, matchers: entityNames(cIdentity).map(makeNameMatcher) };
  });

  let records, stale, cachedAt;
  try {
    ({ records, stale, cachedAt } = await _readCachedDisciplinaryRecords());
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

  for (const hit of records) {
    if (!BUILDING_OCCUPATIONS.has(hit.occupation)) continue;
    const key = `${hit.licence_number}|${hit.action_date}|${hit.action_type}`;
    if (seen.has(key)) continue;
    const record = { identifiers: [hit.a_c_n], names: [hit.licensee_name] };
    const { match, matchedBy: entityMatch } = classifyMatch(record, identity, entityMatchers);
    let provenance = null;
    let query = identity.legalName || identity.typedName;
    if (match === 'confirmed' || match === 'name-only') {
      provenance = { MatchedBy: entityMatch };
    } else if (match !== 'rejected') {
      for (const l of linked) {
        const r = classifyMatch(record, l.identity, l.matchers);
        if (r.match !== 'confirmed' && r.match !== 'name-only') continue;
        const confirmed = r.match === 'confirmed' && l.company.confidence === 'confirmed';
        provenance = {
          MatchedBy: confirmed ? `Linked company — via ${l.company.person || l.company.via}` : NAME_ONLY,
          LinkedCompany: l.company.name,
          LinkedVia: l.company.via,
        };
        query = l.company.name;
        break;
      }
      if (!provenance) {
        const person = people.find((p) => p.matcher(hit.licensee_name || ''));
        if (person) {
          provenance = { MatchedBy: NAME_ONLY, LinkedVia: `Person: ${person.name}` };
          query = person.name;
        }
      }
    }
    if (!provenance) continue;
    seen.add(key);
    allResults.push(toDisciplinaryResultItem(hit, query, provenance));
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
    ...staleFields(stale, cachedAt),
  };
}

module.exports = { searchACTLicences, searchACTDisciplinary, resolveActAssociatedNames, resolveActLinkedCompanies };
