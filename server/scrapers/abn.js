'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

// ABN lookup — the identity every other check depends on (DATA_SOURCES_PLAN.md Phase 1.1).
//
// Primary: the ABR's official ABN Lookup web services (free; `ABR_GUID`, registered 2026-10-13).
// SearchByABNv202001 with history returns the same fields the ABR's web page shows, plus dated
// former names, business-name history and the registration date. Fallback: the ABR web page
// scrape this file used to rely on entirely (also used when no `ABR_GUID` is set — local dev).
//
// A failed lookup is reported as failed (`status: 'error'`, `completeness: 'unavailable'`),
// never as "No ABR records found" — found 2026-10-12 during an ABR maintenance window, when
// every search silently fell back to the typed name while `abn` still showed 100% on the
// dashboard. "Not found" is only reported when the ABR itself says so.

const XML_BASE = 'https://abr.business.gov.au/abrxmlsearch/AbrXmlSearch.asmx';
const JSON_BASE = 'https://abr.business.gov.au/json';
const VIEW_URL = (abn) => `https://abr.business.gov.au/ABN/View?id=${abn}`;
const SEARCH_URL = (name) => `https://abr.business.gov.au/Search/ResultsActive?SearchText=${encodeURIComponent(name || '')}`;
// API 5s + page scrape 12s keeps the ABN path's fallback inside the manifest's 20s for `abn`.
// Measured from Railway 2026-10-13: API lookups 200–850ms.
const API_TIMEOUT_MS = 5_000;
const SCRAPE_TIMEOUT_MS = 12_000;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

// Normalise to "pty ltd" form so "Proprietary Limited" and "Pty Ltd" compare equal.
function normaliseName(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\bproprietary\b/g, 'pty')
    .replace(/\blimited\b/g, 'ltd')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── ABN Lookup web services ──────────────────────────────────────────────────

const OPEN_ENDED = '0001-01-01';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2012-02-21" → "21 Feb 2012", the format the ABR web page shows.
function displayDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

const isCurrent = ($el) => {
  const to = $el.children('effectiveTo').text().trim();
  return !to || to === OPEN_ENDED;
};

// The ABR answers an unknown ABN with an <exception>, not an empty record; that's the only
// genuine "not found". Any other exception (an unrecognised GUID, a service fault) is a failure.
const NOT_FOUND_EXCEPTION = /not a valid ABN|no records? found|not found/i;

class AbrLookupError extends Error {}

async function fetchAbnRecordXml(abn, guid, _http) {
  const { data } = await _http.get(`${XML_BASE}/SearchByABNv202001`, {
    params: { searchString: abn, includeHistoricalDetails: 'Y', authenticationGuid: guid },
    timeout: API_TIMEOUT_MS,
    responseType: 'text',
  });
  const $ = cheerio.load(data, { xmlMode: true });
  const exception = $('response > exception > exceptionDescription').text().trim();
  if (exception) {
    if (NOT_FOUND_EXCEPTION.test(exception)) return null;
    throw new AbrLookupError(`ABR web services: ${exception}`);
  }
  const entity = $('response > businessEntity202001').first();
  if (entity.length === 0) throw new AbrLookupError('ABR web services: unexpected response');
  return { $, entity };
}

function personName($legal) {
  const given = [$legal.children('givenName').text().trim(), $legal.children('otherGivenName').text().trim()].filter(Boolean).join(' ');
  const family = $legal.children('familyName').text().trim();
  return [family, given].filter(Boolean).join(', ');
}

// Maps a SearchByABNv202001 businessEntity to the same result item the ABR page scrape produced
// (same metadata keys — read by resolveEntityIdentity, riskGrouper, ReportContent and the mobile
// app), plus `date` (registration date, ISO) and `formerNames`.
function entityToResult({ $, entity }, abn) {
  const children = (tag) => entity.children(tag).toArray().map((el) => $(el));

  const mainNames = children('mainName');
  const legalNames = children('legalName');
  const currentMain = mainNames.find(isCurrent) || mainNames[0];
  const currentLegal = legalNames.find(isCurrent) || legalNames[0];
  const entityName = currentMain
    ? currentMain.children('organisationName').text().trim()
    : currentLegal
      ? personName(currentLegal)
      : '';

  // Former organisation names, newest first. A sole trader's earlier legal names are usually
  // spelling corrections, so they aren't used as search terms.
  const formerNames = mainNames
    .filter((n) => !isCurrent(n))
    .sort((a, b) => b.children('effectiveTo').text().localeCompare(a.children('effectiveTo').text()))
    .map((n) => n.children('organisationName').text().trim())
    // The ABR keeps punctuation variants as separate records ("PTY. LTD." / "PTY LTD").
    .filter((n, i, all) => n && normaliseName(n) !== normaliseName(entityName) && all.findIndex((m) => normaliseName(m) === normaliseName(n)) === i);

  const statuses = children('entityStatus');
  const currentStatus = statuses.find(isCurrent) || statuses[0];
  const statusCode = currentStatus ? currentStatus.children('entityStatusCode').text().trim() : '';
  const statusFrom = currentStatus ? currentStatus.children('effectiveFrom').text().trim() : '';
  const abnStatus = statusCode ? `${statusCode}${statusFrom ? ` from ${displayDate(statusFrom)}` : ''}` : '';
  // Registration date: the earliest status record (an ABN cancelled and reactivated has several).
  const registered = statuses.map((s) => s.children('effectiveFrom').text().trim()).filter(Boolean).sort()[0] || '';

  const gst = children('goodsAndServicesTax').find(isCurrent);
  const gstText = gst ? `Registered from ${displayDate(gst.children('effectiveFrom').text().trim())}` : 'Not currently registered for GST';

  const address = children('mainBusinessPhysicalAddress').find(isCurrent);
  const location = address ? [address.children('stateCode').text().trim(), address.children('postcode').text().trim()].filter(Boolean).join(' ') : '';

  const currentNames = (tag) => children(tag).filter(isCurrent).map((n) => n.children('organisationName').text().trim()).filter(Boolean);
  const businessNames = currentNames('businessName');
  const tradingNames = [...currentNames('mainTradingName'), ...currentNames('otherTradingName')];

  const metadata = {
    'Entity name': entityName,
    'ABN status': abnStatus,
    'Entity type': entity.find('entityType > entityDescription').first().text().trim(),
    'Goods & Services Tax (GST)': gstText,
    ...(location ? { 'Main business location': location } : {}),
    ...(businessNames.length > 0 ? { 'Business Name(s)': businessNames.join(', ') } : {}),
    ...(tradingNames.length > 0 ? { 'Trading Name(s)': tradingNames.join(', ') } : {}),
    ...(formerNames.length > 0 ? { 'Former name(s)': formerNames.join(', ') } : {}),
  };
  const acn = entity.children('ASICNumber').text().trim();
  if (acn) metadata.ACN = acn;

  return {
    item: { title: entityName || `ABN ${abn}`, url: VIEW_URL(abn), metadata, status: abnStatus, date: registered },
    businessNames,
    tradingNames,
    formerNames,
  };
}

// JSON MatchingNames — the API equivalent of the ABR page's name search. AbnStatus there is a
// code: 0000000001 Active, 0000000002 Cancelled (checked against AbnDetails 2026-10-13).
async function fetchNameMatchesJson(name, guid, _http, maxResults = 20) {
  const { data } = await _http.get(`${JSON_BASE}/MatchingNames.aspx`, {
    params: { name, maxResults, guid, callback: 'cb' },
    timeout: API_TIMEOUT_MS,
    responseType: 'text',
  });
  const json = JSON.parse(String(data).trim().replace(/^cb\(/, '').replace(/\)\s*;?$/, ''));
  if (json.Message) throw new AbrLookupError(`ABR web services: ${json.Message}`);
  return (json.Names ?? []).map((n) => ({
    name: n.Name,
    abn: n.Abn,
    type: n.NameType || '',
    state: n.State || '',
    status: n.AbnStatus === '0000000001' ? 'Active' : n.AbnStatus === '0000000002' ? 'Cancelled' : n.AbnStatus || '',
  }));
}

// ── ABR web page scrape (fallback) ───────────────────────────────────────────

// The ABR detail page renders each section (ABN details, Business name(s), Trading name(s)) as
// its own <table><caption>Section title ...</caption>. Extracts the first column of each
// two-<td> data row under the table whose caption starts with captionPrefix.
function extractNameTable($, captionPrefix) {
  const names = [];
  $('table').each((_, table) => {
    const caption = $(table).find('caption').first().text().trim();
    if (!caption.toLowerCase().startsWith(captionPrefix.toLowerCase())) return;
    $(table).find('tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length !== 2) return;
      const name = cells.eq(0).text().trim();
      if (name) names.push(name);
    });
  });
  return names;
}

// Throws on a failed fetch; returns null when the page has no ABN details.
async function scrapeAbnPage(abn, _http) {
  const { data } = await _http.get(VIEW_URL(abn), { headers: HEADERS, timeout: SCRAPE_TIMEOUT_MS });
  const $ = cheerio.load(data);
  const fields = {};
  $('table').each((_, table) => {
    const caption = $(table).find('caption').first().text().trim();
    if (!/^ABN details/i.test(caption)) return;
    $(table).find('tr').each((_, row) => {
      const label = $(row).find('th').text().trim().replace(/:$/, '');
      const value = $(row).find('td').text().trim();
      if (label && value) fields[label] = value;
    });
  });
  const businessNames = extractNameTable($, 'Business name');
  const tradingNames = extractNameTable($, 'Trading name');
  // Entity name lives in a semantic itemprop, not a heading.
  const entityName =
    $('span[itemprop="legalName"]').first().text().trim() || $('h1.entity-name').text().trim() || $('span.entityName').text().trim();
  if (!entityName && Object.keys(fields).length === 0) return null;
  if (businessNames.length > 0) fields['Business Name(s)'] = businessNames.join(', ');
  if (tradingNames.length > 0) fields['Trading Name(s)'] = tradingNames.join(', ');
  return {
    item: {
      title: entityName || `ABN ${abn}`,
      url: VIEW_URL(abn),
      metadata: fields,
      status: fields['Status'] || fields['ABN status'] || '',
      date: fields['Registration date'] || fields['Date of registration'] || '',
    },
    businessNames,
    tradingNames,
    formerNames: [],
  };
}

// Throws on a failed fetch.
async function scrapeNameMatches(name, _http) {
  const { data } = await _http.get(SEARCH_URL(name), { headers: HEADERS, timeout: SCRAPE_TIMEOUT_MS });
  const $ = cheerio.load(data);
  const matches = [];
  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;
    const abnCell = cells.eq(0);
    const abn = abnCell.find('a').text().trim().replace(/\s/g, '');
    const matchName = cells.eq(1).text().trim();
    if (!matchName || !abn) return;
    matches.push({
      name: matchName,
      abn,
      type: cells.eq(2)?.text().trim() || '',
      state: cells.eq(3)?.text().trim() || '',
      status: abnCell.find('span').text().trim() || '',
    });
  });
  return matches;
}

// ── Public API ───────────────────────────────────────────────────────────────

// API first (when a GUID is configured), then the page scrape. Resolves { value, source } or
// { failed: true, error } — never throws. `value` may be null (a genuine "not found").
async function withFallback(viaApi, viaScrape, guid, label) {
  if (guid) {
    try {
      return { value: await viaApi(), source: 'api' };
    } catch (err) {
      console.warn(`[abn] ${label}: ABN Lookup web services failed (${err.message}), falling back to the ABR page`);
    }
  }
  try {
    return { value: await viaScrape(), source: 'scrape' };
  } catch (err) {
    console.error(`[abn] ${label}: ABR page fetch failed too: ${err.message}`);
    return { failed: true, error: err };
  }
}

function lookupFailed(searchTerm, searchUrl) {
  return {
    source: 'ABR — Australian Business Register',
    jurisdiction: 'Federal',
    category: 'identity',
    status: 'error',
    completeness: 'unavailable',
    results: [],
    businessNames: [],
    tradingNames: [],
    formerNames: [],
    searchUrl,
    summary: `ABR lookup failed for ${searchTerm} — verify manually`,
  };
}

async function searchABN(abn, companyName, acn, { _http = axios, guid = process.env.ABR_GUID } = {}) {
  const cleanAbn = (abn || '').replace(/\s/g, '');
  const searchTerm = abn || companyName;
  const searchUrl = cleanAbn ? VIEW_URL(cleanAbn) : SEARCH_URL(companyName);
  const results = [];
  let businessNames = [];
  let tradingNames = [];
  let formerNames = [];
  let abnLookupFailed = false;

  if (cleanAbn) {
    const out = await withFallback(
      async () => {
        const record = await fetchAbnRecordXml(cleanAbn, guid, _http);
        return record ? entityToResult(record, cleanAbn) : null;
      },
      () => scrapeAbnPage(cleanAbn, _http),
      guid,
      `ABN ${cleanAbn}`
    );
    if (out.failed) abnLookupFailed = true;
    else if (out.value) {
      results.push(out.value.item);
      ({ businessNames, tradingNames, formerNames } = out.value);
    }
  }

  if (companyName && results.length === 0) {
    const out = await withFallback(
      () => fetchNameMatchesJson(companyName, guid, _http),
      () => scrapeNameMatches(companyName, _http),
      guid,
      `name "${companyName}"`
    );
    if (out.failed) {
      // Both the ABN and the name search failed: nothing was actually checked.
      if (abnLookupFailed || !cleanAbn) return lookupFailed(searchTerm, searchUrl);
    } else {
      const nameResults = (out.value || []).map((m) => ({
        title: m.name,
        url: m.abn ? VIEW_URL(m.abn) : SEARCH_URL(companyName),
        metadata: { ABN: m.abn, Type: m.type, State: m.state, Status: m.status },
      }));
      // Narrow to the specific entity when an identifier is available.
      // ABN = 2-digit prefix + 9-digit ACN, so last 9 digits of ABN == ACN.
      const cleanAcn = (acn || '').replace(/\s/g, '');
      const sameName = (r) => normaliseName(r.title) === normaliseName(companyName);
      if (cleanAcn) {
        const byAcn = nameResults.filter((r) => (r.metadata.ABN || '').slice(2) === cleanAcn);
        results.push(...(byAcn.length > 0 ? byAcn : nameResults.filter(sameName)));
      } else if (cleanAbn) {
        const byAbn = nameResults.filter((r) => r.metadata.ABN === cleanAbn);
        results.push(...(byAbn.length > 0 ? byAbn : nameResults.filter(sameName)));
      } else {
        // Name-only: exact normalised match, fall back to all results if nothing matches.
        const byName = nameResults.filter(sameName);
        results.push(...(byName.length > 0 ? byName : nameResults));
      }
    }
  }

  if (results.length === 0 && abnLookupFailed) return lookupFailed(searchTerm, searchUrl);

  return {
    source: 'ABR — Australian Business Register',
    jurisdiction: 'Federal',
    category: 'identity',
    results,
    businessNames,
    tradingNames,
    formerNames,
    searchUrl,
    summary: results.length > 0 ? `Found ${results.length} record(s) for ${searchTerm}` : `No ABR records found for ${searchTerm}`,
  };
}

// Name search for /api/search/disambiguate — up to 10 { name, abn, type, state, status }.
// Throws if both the API and the page scrape fail, so the route returns an error instead of an
// empty "no matches" list.
async function searchByName(companyName, { _http = axios, guid = process.env.ABR_GUID } = {}) {
  const out = await withFallback(
    () => fetchNameMatchesJson(companyName, guid, _http, 10),
    () => scrapeNameMatches(companyName, _http),
    guid,
    `name "${companyName}"`
  );
  if (out.failed) throw out.error;
  return (out.value || []).slice(0, 10);
}

module.exports = { searchABN, searchByName, entityToResult, displayDate };
