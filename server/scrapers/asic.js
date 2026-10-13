'use strict';

const axios = require('axios');
const { NAME_ONLY, isKnownNonCompany, normaliseDigits, normaliseEntityName } = require('./licenceMatching');

// ASIC company record, from ASIC's own Company Dataset as served live by data.gov.au's CKAN
// DataStore API (DATA_SOURCES_PLAN.md Phase 1.2/1.3, 2026-10-12). Replaces a CAPTCHA-gated
// ASIC Connect scrape that paid for a 2captcha solve on every search and had stopped
// returning directors (ASIC removed free officer data) — and returned nothing at all for some
// companies (e.g. Universal Property Group, which this source shows in external
// administration).
//
// Why live rather than a weekly local copy: measured from the Railway container on
// 2026-10-12 — 30/30 lookups by ACN succeeded (p50 11ms, p95 ~1s), 10 concurrent lookups all
// succeeded, and the DataStore held a company registered on the day of the latest weekly
// file (4.45M rows). If the measured complete rate drops below 95%, the fallback is the
// weekly-copy design recorded in DATA_SOURCES_PLAN.md 1.2. Public data, CC BY 3.0 AU.
//
// Each former name is its own row with the same ACN (Current Name Indicator blank, Current
// Name = the company's name now), so one ACN lookup returns the current record plus its name
// history. Status codes are ASIC's (Company Dataset help file, 11/07/2025).
const DATASTORE_URL = 'https://data.gov.au/data/api/3/action/datastore_search';
const RESOURCE_ID = '5c3914e6-413e-4a2c-b890-bf8efe3eabf2';
const REQUEST_TIMEOUT_MS = 8_000;

const STATUS_LABELS = {
  REGD: 'Registered',
  DRGD: 'Deregistered',
  EXAD: 'External administration',
  SOFF: 'Strike-off action in progress',
  NOAC: 'Not active',
  NRGD: 'Not registered',
  CNCL: 'Cancelled',
  DISS: 'Dissolved by Act of Parliament',
  DIV3: 'Registration transferred (Div 3)',
  PEND: 'Pending',
  PROV: 'Provisional',
};

const TYPE_LABELS = {
  APTY: 'Australian proprietary company',
  APUB: 'Australian public company',
};

const CLASS_LABELS = {
  LMSH: 'Limited by shares',
  LMGT: 'Limited by guarantee',
  LMSG: 'Limited by shares and guarantee',
  NLIA: 'No liability',
  UNLM: 'Unlimited',
};

// Unknown codes are shown as-is, never dropped (riskGrouper treats an unrecognised status as a
// finding, not as clean).
const label = (labels, code) => labels[code] || code || '';

const BASE = 'https://connectonline.asic.gov.au';
const DATA_API_BASE = 'https://data.asic.gov.au/api/v1';

function buildSearchUrl(query) {
  return `${BASE}/RegistrySearch/faces/landing/panelSearch.jspx?searchType=OrgAndBusNm&searchText=${encodeURIComponent(query)}`;
}

// There is no working bookmarkable "detail page" URL on ASIC Connect — orgDetails.jspx needs
// live ADF view-state, and a bare orgKey URL returns a genuine 404 (confirmed 2026-09-07). An
// ACN search URL is the one link format that resolves to the real record for a user clicking
// it fresh, so every result links there.
function buildDetailUrl(acn) {
  return buildSearchUrl(normaliseDigits(acn));
}

// One DataStore query, retried once: a failed lookup must surface as "couldn't check", never as
// "no ASIC record" (CLAUDE.md's failed-attempt-vs-genuine-negative convention).
async function queryDatastore(params, _http) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await _http.get(DATASTORE_URL, {
        params: { resource_id: RESOURCE_ID, limit: 100, ...params },
        timeout: REQUEST_TIMEOUT_MS,
      });
      if (!data?.success || !Array.isArray(data.result?.records)) throw new Error('unexpected DataStore response');
      return data.result.records;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// Groups DataStore rows (all sharing one ACN) into the current record plus former names.
function groupCompany(records) {
  const current =
    records.find((r) => r['Current Name Indicator'] === 'Y') ||
    records.find((r) => !r['Current Name']) ||
    records[0];
  const currentName = current['Company Name'];
  const formerNames = [
    ...new Set(
      records
        .filter((r) => r !== current && r['Company Name'] && r['Company Name'] !== currentName)
        .map((r) => r['Company Name'])
    ),
  ];
  // 'Current Name Start Date' isn't used: checked 2026-10-12, Universal Property Group's former-name
  // rows both carry 25/08/2026 although it traded under its current name in 2011 — it isn't a
  // reliable rename date. The dataset doesn't date each former name either.
  return { current, formerNames };
}

function toResultItem({ current, formerNames }, matchedBy) {
  const acn = current.ACN || '';
  const status = label(STATUS_LABELS, current.Status);
  const metadata = {
    ACN: acn,
    ...(current.ABN ? { ABN: current.ABN } : {}),
    Type: label(TYPE_LABELS, current.Type),
    Class: label(CLASS_LABELS, current.Class),
    Status: status,
    Registered: current['Date of Registration'] || '',
    ...(current['Date of Deregistration'] ? { Deregistered: current['Date of Deregistration'] } : {}),
    ...(formerNames.length > 0 ? { 'Former names': formerNames.join('; ') } : {}),
    MatchedBy: matchedBy,
  };
  return {
    title: current['Company Name'],
    url: buildDetailUrl(acn),
    status,
    date: current['Date of Registration'] || '',
    metadata,
  };
}

// Groups rows by ACN, preserving first-seen order.
function byAcn(records) {
  const groups = new Map();
  for (const r of records) {
    if (!r.ACN) continue;
    if (!groups.has(r.ACN)) groups.set(r.ACN, []);
    groups.get(r.ACN).push(r);
  }
  return [...groups.values()];
}

// Looks up a company by ACN — the current record and its former names, or null if ASIC has no
// company with that ACN. Throws if the lookup itself failed. Shared with identity resolution
// (former names, and the ABR-outage fallback by ABN).
async function lookupAsicCompany({ acn, abn } = {}, _http = axios) {
  const acnDigits = normaliseDigits(acn);
  const abnDigits = normaliseDigits(abn);
  let records = [];
  let matchedBy = '';
  if (acnDigits.length === 9) {
    records = await queryDatastore({ filters: JSON.stringify({ ACN: acnDigits }) }, _http);
    matchedBy = 'ACN';
  }
  if (records.length === 0 && abnDigits.length === 11) {
    records = await queryDatastore({ filters: JSON.stringify({ ABN: abnDigits }) }, _http);
    matchedBy = 'ABN';
  }
  if (records.length === 0) return null;
  // An ABN lookup can return several ACNs only through bad source data — take the first.
  return { ...groupCompany(byAcn(records)[0]), matchedBy };
}

// Name-only lookup (no ABN or ACN): full-text search, then keep companies whose current or
// former name normalises to exactly the searched name. Never confirmed — a company name can be
// reused after deregistration — so every hit is "Name only — verify" (licence-matching
// convention), which riskGrouper never treats as a finding.
async function lookupAsicCompaniesByName(name, _http = axios) {
  const target = normaliseEntityName(name);
  if (!target) return [];
  const records = await queryDatastore({ q: name, limit: 50 }, _http);
  return byAcn(records)
    .filter((rows) => rows.some((r) => normaliseEntityName(r['Company Name']) === target))
    .map((rows) => groupCompany(rows));
}

// Directors from ASIC's own Data API — dormant until ASIC reopens API applications (2027; see
// CLAUDE.md's WS3 entries). Only runs when ASIC_DATA_API_KEY is set; only its director rows are
// used, since the company record above comes from the Company Dataset.
async function fetchDirectorsFromDataApi(acn, apiKey, _http = axios) {
  const headers = { 'x-api-key': apiKey, Accept: 'application/json' };
  const { data } = await _http.get(`${DATA_API_BASE}/companies/${acn}/officers`, { headers, timeout: 15_000 });
  const officers = data?.officers ?? data ?? [];
  return officers
    .filter((o) => /director/i.test(o.role ?? ''))
    .map((o) => ({
      title: o.fullName ?? o.name ?? [o.givenName, o.familyName].filter(Boolean).join(' '),
      url: buildDetailUrl(acn),
      date: o.appointmentDate ?? o.appointedDate ?? '',
      metadata: { Role: 'Director', 'Appointment Date': o.appointmentDate ?? o.appointedDate ?? '' },
    }));
}

// `identity` is resolveEntityIdentity()'s output (licenceMatching.js). Lookup order: ACN (the
// user's, or derived from a company ABN), then the ABN's last 9 digits when the entity type is
// unknown, then the ABN column, then — only with no identifier at all — the name.
async function searchASIC(identity, { _http = axios, _fetchDirectors = fetchDirectorsFromDataApi } = {}) {
  const source = 'ASIC Company Register';
  const base = { source, jurisdiction: 'Federal', category: 'identity' };
  const acn = identity.acn || identity.possibleAcn || '';
  const abn = identity.abn || '';
  const name = identity.legalName || identity.typedName || '';
  const searchUrl = acn ? buildDetailUrl(acn) : buildSearchUrl(name || abn);

  if (!acn && isKnownNonCompany(identity)) {
    return {
      ...base,
      results: [],
      searchUrl,
      summary: `Not a company (${identity.entityType}) — no ASIC company record expected`,
    };
  }

  let results = [];
  let formerNames = [];
  let summary;
  try {
    if (acn || abn) {
      const company = await lookupAsicCompany({ acn, abn }, _http);
      if (company) {
        results = [toResultItem(company, company.matchedBy)];
        formerNames = company.formerNames;
        summary = `ASIC company record found — status: ${results[0].status}`;
      } else {
        summary = `No ASIC company record found for ${acn ? `ACN ${acn}` : `ABN ${abn}`}`;
      }
    } else if (name) {
      const companies = await lookupAsicCompaniesByName(name, _http);
      results = companies.map((c) => toResultItem(c, NAME_ONLY));
      summary =
        results.length > 0
          ? `${results.length} ASIC company record(s) matched by name only — verify`
          : `No ASIC company record found named "${name}"`;
    } else {
      return { ...base, results: [], searchUrl, summary: 'Not searched — no company name, ABN or ACN supplied' };
    }
  } catch (err) {
    console.error('[asic] ASIC Company Dataset lookup failed:', err.message);
    return {
      ...base,
      status: 'error',
      completeness: 'unavailable',
      results: [],
      searchUrl,
      summary: 'ASIC company lookup failed — verify manually on ASIC Connect',
    };
  }

  const apiKey = process.env.ASIC_DATA_API_KEY;
  const confirmedAcn = results.length === 1 && results[0].metadata.MatchedBy !== NAME_ONLY ? results[0].metadata.ACN : '';
  if (apiKey && confirmedAcn) {
    try {
      const directors = await _fetchDirectors(confirmedAcn, apiKey, _http);
      results.push(...directors);
      if (directors.length > 0) summary += ` — ${directors.length} director(s) identified`;
    } catch {
      // non-fatal: the company record stands on its own
    }
  }

  // formerNames: only for a company confirmed by ACN/ABN — they join the court/FWO search terms
  // as the entity's own names (searchOrchestrator.js resolveFormerNames).
  return { ...base, results, formerNames, searchUrl, summary };
}

module.exports = {
  searchASIC,
  lookupAsicCompany,
  lookupAsicCompaniesByName,
  buildDetailUrl,
  STATUS_LABELS,
};
