const axios = require('axios');
const cheerio = require('cheerio');
const { fetchAdfPageWithCaptcha } = require('./browser');

const BASE = 'https://connectonline.asic.gov.au';
const DATA_API_BASE = 'https://data.asic.gov.au/api/v1';

function buildSearchUrl(query) {
  return `${BASE}/RegistrySearch/faces/landing/panelSearch.jspx?searchType=OrgAndBusNm&searchText=${encodeURIComponent(query)}`;
}

function buildDetailUrl(acn) {
  return `${BASE}/RegistrySearch/faces/landing/orgDetails.jspx?searchType=OrgAndBusNm&orgKey=${acn.replace(/\s/g, '')}`;
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

async function searchASIC(companyName, abn, acn, captchaApiKey) {
  const derivedAcn = (acn || '').replace(/\s/g, '') || abnToAcn(abn) || '';
  const query = derivedAcn || companyName || '';
  const searchUrl = buildSearchUrl(query);
  let results = [];

  try {
    const searchHtml = await fetchAdfPageWithCaptcha(searchUrl, captchaApiKey);
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
          const detailHtml = await fetchAdfPageWithCaptcha(detailUrl, captchaApiKey);
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
      // Note: ASIC Connect no longer exposes a free-access officer/director listing —
      // director info requires a paid "Roles and relationship extract" ($23 on ASIC).
      // Directors are retrieved from ASIC_DATA_API_KEY fallback below if set.
      const fields = parseCompanyDetail($);
      const name = fields['Name'] || companyName || '';
      const status = fields['Status'] || '';

      if (name) {
        const companyItem = {
          title: name,
          url: searchUrl,
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
      }
    }
  } catch {
    // non-fatal — fall through to Data API
  }

  // Data API fallback: used when ASIC Connect returns nothing (deregistered companies,
  // missing CAPTCHA key, etc.). Requires ASIC_DATA_API_KEY and a known ACN.
  if (results.length === 0) {
    const apiKey = process.env.ASIC_DATA_API_KEY;
    if (apiKey && derivedAcn) {
      try {
        results = await fetchFromDataApi(derivedAcn, apiKey, companyName);
      } catch {
        // non-fatal
      }
    }
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
