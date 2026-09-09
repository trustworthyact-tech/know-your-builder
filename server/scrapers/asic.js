const axios = require('axios');
const cheerio = require('cheerio');
const { fetchAdfPageWithCaptcha } = require('./browser');

const BASE = 'https://connectonline.asic.gov.au';
const DATA_API_BASE = 'https://data.asic.gov.au/api/v1';

function buildSearchUrl(query) {
  return `${BASE}/RegistrySearch/faces/landing/panelSearch.jspx?searchType=OrgAndBusNm&searchText=${encodeURIComponent(query)}`;
}

// There is no working bookmarkable "detail page" URL on ASIC Connect — orgDetails.jspx
// requires live ADF view-state (_afrLoop, Adf-Window-Id, etc.) that only exists mid-session;
// a bare orgKey-only URL constructed after the fact returns a genuine ASIC 404 ("Sorry, we
// could not find the page you're looking for"), confirmed live 2026-09-07 via Puppeteer —
// not a bot-block, a real dead route. This was wrongly assumed to be "the direct record page"
// in 37d1eb7 (2026-09-03), which was never actually click-tested fresh before merging.
// Every result now links to buildSearchUrl(acn) instead: confirmed live to return a real 200
// "Search Results" page, and for a 9-digit-ACN query specifically, ASIC Connect's own search
// results page renders the full record inline (see the ACN-search branch in searchASIC below,
// which already reads company detail straight off this same search-results HTML) — so this
// isn't a downgrade to a generic search box, it's the one link format that actually resolves
// to the real record for a user clicking it fresh, days after the report was generated.
function buildDetailUrl(acn) {
  return buildSearchUrl(acn.replace(/\s/g, ''));
}

// Locate the results table by its column headers rather than a fixed CSS class,
// then validate each row by checking that the second cell is a 9-digit ACN.
function parseSearchResults($) {
  const results = [];

  $('table').each((_, table) => {
    const $table = $(table);
    const headerText = $table.find('th').text().toLowerCase();
    if (!headerText.includes('name') && !headerText.includes('acn') && !headerText.includes('number')) return;

    $table.find('tbody tr, tr').each((_, row) => {
      const $cells = $(row).find('td');
      if ($cells.length < 2) return;

      const name = $cells.eq(0).text().trim();
      if (!name || ['name', 'company name', 'entity name'].includes(name.toLowerCase())) return;

      // ACN is exactly 9 digits (may have spaces in the cell)
      const cleanAcn = $cells.eq(1).text().trim().replace(/\s/g, '');
      if (!/^\d{9}$/.test(cleanAcn)) return;

      const type = $cells.eq(2)?.text().trim() || '';
      const status = $cells.eq(3)?.text().trim() || '';

      results.push({ name, url: buildDetailUrl(cleanAcn), acn: cleanAcn, type, status });
    });

    if (results.length > 0) return false; // stop after finding the populated table
  });

  return results;
}

// Parse labeled company fields from dl/dt/dd and table structures that ADF renders.
function parseCompanyDetail($) {
  const fields = {};

  $('dl dt').each((_, dt) => {
    const label = $(dt).text().trim().replace(/:$/, '');
    const value = $(dt).next('dd').text().trim();
    if (label && value) fields[label] = value;
  });

  $('table tr').each((_, row) => {
    const $th = $(row).find('th');
    const $td = $(row).find('td');
    if ($th.length && $td.length) {
      fields[$th.first().text().trim().replace(/:$/, '')] = $td.first().text().trim();
    } else if ($td.length >= 2) {
      const label = $td.eq(0).text().trim().replace(/:$/, '');
      const value = $td.eq(1).text().trim();
      if (label && value && label !== value && label.length < 60) {
        fields[label] = value;
      }
    }
  });

  return fields;
}

function parseDirectors($, detailUrl) {
  const directors = [];

  $('table').each((_, table) => {
    const $table = $(table);
    const headerText = $table.find('th').text().toLowerCase();
    if (!headerText.includes('officer') && !headerText.includes('director') && !headerText.includes('role')) return;

    $table.find('tbody tr, tr').each((_, row) => {
      const $cells = $(row).find('td');
      if ($cells.length < 2) return;

      const name = $cells.eq(0).text().trim();
      if (!name || name.toLowerCase() === 'name') return;

      const role = $cells.eq(1)?.text().trim() || '';
      if (!role.toLowerCase().includes('director')) return;

      const appointed = $cells.eq(2)?.text().trim() || '';

      directors.push({
        title: name,
        url: detailUrl,
        date: appointed,
        metadata: {
          Role: 'Director',
          'Appointment Date': appointed,
        },
      });
    });
  });

  return directors;
}

// Derive ACN from ABN: strip spaces, take the 9 digits after the 2-digit prefix.
function abnToAcn(abn) {
  const clean = (abn || '').replace(/\s/g, '');
  return clean.length === 11 ? clean.slice(2) : null;
}

// Returns [companyItem, ...directorItems] using the ASIC Data API.
// Used as a fallback when ASIC Connect cannot find the company (e.g. deregistered).
async function fetchFromDataApi(acn, apiKey, companyName) {
  const headers = { 'x-api-key': apiKey, Accept: 'application/json' };
  const detailUrl = buildDetailUrl(acn);

  const { data: co } = await axios.get(`${DATA_API_BASE}/companies/${acn}`, {
    headers,
    timeout: 15_000,
  });

  const name = co?.name ?? co?.companyName ?? companyName ?? acn;
  const status = co?.status ?? co?.companyStatus ?? '';

  const companyItem = {
    title: name,
    url: detailUrl,
    status,
    date: co?.registrationDate ?? co?.dateOfRegistration ?? '',
    metadata: {
      ACN: co?.organisationNumber ?? co?.acn ?? acn,
      Type: co?.type ?? co?.companyType ?? '',
      Status: status,
      'Registration Date': co?.registrationDate ?? co?.dateOfRegistration ?? '',
      'Registered Office': co?.registeredOffice?.address ?? co?.registeredOfficeAddress ?? '',
      'Principal Place of Business':
        co?.principalPlaceOfBusiness?.address ?? co?.principalBusinessAddress ?? '',
      Charges: String(co?.chargesCount ?? co?.numberOfCharges ?? ''),
    },
  };

  // Current officers only (asic.js shows present-state; historical goes in asicExtract)
  const { data: officersPayload } = await axios
    .get(`${DATA_API_BASE}/companies/${acn}/officers`, { headers, timeout: 15_000 })
    .catch(() => ({ data: null }));

  const officers = officersPayload?.officers ?? officersPayload ?? [];
  const directorItems = officers
    .filter((o) => /director/i.test(o.role ?? ''))
    .map((o) => {
      const fullName =
        o.fullName ?? o.name ?? [o.givenName, o.familyName].filter(Boolean).join(' ') ?? '';
      return {
        title: fullName,
        url: detailUrl,
        date: o.appointmentDate ?? o.appointedDate ?? '',
        metadata: {
          Role: 'Director',
          'Appointment Date': o.appointmentDate ?? o.appointedDate ?? '',
        },
      };
    });

  return [companyItem, ...directorItems];
}

// Injectable last params (_fetchAdfPageWithCaptcha, _fetchFromDataApi) — same pattern as
// asicDpnMatch.js's _fetchDpnRows and CLAUDE.md's captcha-gated-check convention. Neither
// underlying call is testable live in this environment: the CAPTCHA-gated ASIC Connect path
// needs a real CAPTCHA_API_KEY, and the Data API path needs ASIC_DATA_API_KEY, which is
// categorically unobtainable until ASIC's DSP applications reopen in 2027 (see CLAUDE.md's
// WS3 entries) — not just "not yet configured". Added 2026-09-09 specifically so the
// director-discovery fixes in this function (the ACN-branch parseDirectors() call and the
// Data API fallback's merge-not-replace guard) have real, deterministic regression coverage
// instead of staying permanently unverifiable — see test-asic-director-fallback.js.
async function searchASIC(
  companyName,
  abn,
  acn,
  captchaApiKey,
  _fetchAdfPageWithCaptcha = fetchAdfPageWithCaptcha,
  _fetchFromDataApi = fetchFromDataApi
) {
  const derivedAcn = (acn || '').replace(/\s/g, '') || abnToAcn(abn) || '';
  const query = derivedAcn || companyName || '';
  const searchUrl = buildSearchUrl(query);
  let results = [];
  let primaryFetchFailed = false;

  try {
    const searchHtml = await _fetchAdfPageWithCaptcha(searchUrl, captchaApiKey);
    const $ = cheerio.load(searchHtml);
    const matches = parseSearchResults($);

    const bestMatch =
      matches.find(
        (m) =>
          m.name.toLowerCase() === (companyName || '').toLowerCase() ||
          m.acn === derivedAcn
      ) || matches[0];

    if (bestMatch) {
      const companyItem = {
        title: bestMatch.name,
        url: bestMatch.url,
        status: bestMatch.status,
        metadata: {
          ACN: bestMatch.acn,
          Type: bestMatch.type,
          Status: bestMatch.status,
        },
      };

      if (bestMatch.acn) {
        try {
          const detailUrl = buildDetailUrl(bestMatch.acn);
          const detailHtml = await _fetchAdfPageWithCaptcha(detailUrl, captchaApiKey);
          const $d = cheerio.load(detailHtml);
          const fields = parseCompanyDetail($d);

          companyItem.url = detailUrl;
          companyItem.status = fields['Status'] || fields['Company status'] || bestMatch.status;
          companyItem.date = fields['Date of registration'] || fields['Registration date'] || '';
          companyItem.metadata = {
            ACN: fields['ACN'] || fields['Australian Company Number'] || bestMatch.acn,
            Type: fields['Company type'] || fields['Type'] || bestMatch.type,
            Status: companyItem.status,
            'Registration Date': companyItem.date,
            'Registered Office':
              fields['Registered office'] || fields['Registered office address'] || '',
            'Principal Place of Business': fields['Principal place of business'] || '',
            Charges: fields['Number of charges'] || fields['Charges'] || '',
          };

          results.push(companyItem);
          results.push(...parseDirectors($d, detailUrl));
        } catch {
          results.push(companyItem);
        }
      } else {
        results.push(companyItem);
      }
    } else if (derivedAcn) {
      // When searching by ACN, ASIC Connect returns the company detail inline on
      // the search results page (ADF renders a single expanded result). The standard
      // list-format table that parseSearchResults expects is absent. Fall back to
      // parseCompanyDetail, which handles th/td row-per-field tables.
      // Director info may not be present on this rendering at all — ASIC Connect's free
      // officer/director listing was removed at some point ("Roles and relationship
      // extract" is now a paid $23 product) and it's unconfirmed whether that removal
      // applies to this inline-detail rendering specifically (untestable here without a
      // real CAPTCHA_API_KEY). parseDirectors() below was previously never even called on
      // this branch at all (found via CLAUDE.md's "resolveDirectors() is currently
      // starved" investigation) — operates on the already-loaded $ (this rendering *is*
      // the detail page, per the comment above; no extra fetch needed), wrapped
      // defensively since its markup here is unconfirmed to match the other branch's
      // detailHtml-fetched $d closely enough. If it finds nothing, the director-aware
      // Data API fallback below is what covers this case once ASIC_DATA_API_KEY is set.
      const fields = parseCompanyDetail($);
      const name = fields['Name'] || companyName || '';
      const status = fields['Status'] || '';

      if (name) {
        const companyItem = {
          title: name,
          url: buildDetailUrl(derivedAcn),
          status,
          date: fields['Registration date'] || fields['Date of registration'] || '',
          metadata: {
            ACN: fields['ACN'] || derivedAcn,
            Type: fields['Type'] || '',
            Status: status,
            'Registration Date': fields['Registration date'] || '',
            'Registered Office': fields['Locality of registered office'] || '',
            'Principal Place of Business': fields['Principal place of business'] || '',
            Charges: fields['Number of charges'] || '',
            ...(fields['Former name(s)'] ? { 'Former Names': fields['Former name(s)'] } : {}),
          },
        };
        results.push(companyItem);
        try {
          results.push(...parseDirectors($, buildDetailUrl(derivedAcn)));
        } catch {
          // non-fatal — this rendering's markup isn't confirmed to match parseDirectors()'s
          // expectations; a failure here shouldn't lose the company record already found
        }
      }
    }
  } catch {
    // non-fatal — fall through to Data API
    primaryFetchFailed = true;
  }

  // Data API fallback: used when ASIC Connect returns nothing at all (deregistered
  // companies, missing CAPTCHA key, etc.), or when it found a company but no directors —
  // the ACN-branch above previously left this permanently unreachable in the latter case,
  // since results.length was already 1 (company only) by the time this ran, so the
  // director-missing case never triggered a fallback that could have supplied them.
  // Requires ASIC_DATA_API_KEY and a known ACN either way.
  const hasDirector = results.some((r) => r.metadata?.Role === 'Director');
  if (results.length === 0 || !hasDirector) {
    const apiKey = process.env.ASIC_DATA_API_KEY;
    if (apiKey && derivedAcn) {
      try {
        const dataApiResults = await _fetchFromDataApi(derivedAcn, apiKey, companyName);
        if (results.length === 0) {
          // Nothing from ASIC Connect at all — the Data API's own company record is all
          // we have, take it in full.
          results = dataApiResults;
        } else {
          // Already have a company record (likely better-sourced directly from ASIC
          // Connect) — only add the director items we were missing, don't overwrite it.
          results.push(...dataApiResults.filter((r) => r.metadata?.Role === 'Director'));
        }
      } catch {
        // non-fatal
      }
    }
  }

  if (results.length === 0 && primaryFetchFailed) {
    throw new Error('ASIC Connect search failed and no fallback data available');
  }

  const companyCount = results.filter((r) => r.metadata?.Role !== 'Director').length;
  const directorCount = results.filter((r) => r.metadata?.Role === 'Director').length;

  return {
    source: 'ASIC Connect',
    jurisdiction: 'Federal',
    category: 'identity',
    results,
    searchUrl,
    summary:
      companyCount > 0
        ? `ASIC company record found — status: ${results[0]?.status || 'unknown'}${
            directorCount > 0 ? ` — ${directorCount} director(s) identified` : ''
          }`
        : `No ASIC records found for ${companyName || query}`,
  };
}

module.exports = { searchASIC, parseSearchResults, parseCompanyDetail, parseDirectors };
