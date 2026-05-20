const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://connectonline.asic.gov.au';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: 'https://connectonline.asic.gov.au/',
};

function buildSearchUrl(query) {
  return `${BASE}/RegistrySearch/faces/landing/SearchRegisters.jspx?searchType=OrgAndBusNm&searchText=${encodeURIComponent(query)}`;
}

function buildDetailUrl(acn) {
  return `${BASE}/RegistrySearch/faces/landing/orgDetails.jspx?searchType=OrgAndBusNm&orgKey=${acn.replace(/\s/g, '')}`;
}

function parseSearchResults($, searchUrl) {
  const results = [];
  $('table tbody tr').each((_, row) => {
    const $cells = $(row).find('td');
    if ($cells.length < 3) return;

    const $link = $cells.eq(0).find('a');
    const name = $link.text().trim() || $cells.eq(0).text().trim();
    if (!name) return;

    const href = $link.attr('href') || '';
    const url = href
      ? href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`
      : searchUrl;

    const acn = $cells.eq(1).text().trim();
    const type = $cells.eq(2)?.text().trim() || '';
    const status = $cells.eq(3)?.text().trim() || '';

    results.push({ name, url, acn, type, status });
  });
  return results;
}

function parseCompanyDetail($) {
  const fields = {};

  // dl/dt/dd pattern
  $('dl dt').each((_, dt) => {
    const label = $(dt).text().trim();
    const value = $(dt).next('dd').text().trim();
    if (label && value) fields[label] = value;
  });

  // table th/td or two-column td/td
  $('table tr').each((_, row) => {
    const $th = $(row).find('th');
    const $td = $(row).find('td');
    if ($th.length && $td.length) {
      fields[$th.first().text().trim()] = $td.first().text().trim();
    } else if ($td.length === 2) {
      const label = $td.eq(0).text().trim();
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
    if (
      !headerText.includes('officer') &&
      !headerText.includes('director') &&
      !headerText.includes('role')
    )
      return;

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

async function searchASIC(companyName, abn, acn) {
  const query = acn ? acn.replace(/\s/g, '') : companyName || '';
  const searchUrl = buildSearchUrl(query);
  const results = [];

  try {
    const { data: searchHtml } = await axios.get(searchUrl, {
      headers: HEADERS,
      timeout: 20000,
      maxRedirects: 5,
    });
    const $ = cheerio.load(searchHtml);
    const matches = parseSearchResults($, searchUrl);

    // Prefer exact name/ACN match, fall back to first result
    const bestMatch =
      matches.find(
        (m) =>
          m.name.toLowerCase() === (companyName || '').toLowerCase() ||
          m.acn.replace(/\s/g, '') === (acn || '').replace(/\s/g, '')
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
          const { data: detailHtml } = await axios.get(detailUrl, {
            headers: HEADERS,
            timeout: 20000,
          });
          const $d = cheerio.load(detailHtml);
          const fields = parseCompanyDetail($d);

          companyItem.url = detailUrl;
          companyItem.status =
            fields['Status'] || fields['Company status'] || bestMatch.status;
          companyItem.date =
            fields['Date of registration'] || fields['Registration date'] || '';
          companyItem.metadata = {
            ACN:
              fields['ACN'] ||
              fields['Australian Company Number'] ||
              bestMatch.acn,
            Type:
              fields['Company type'] || fields['Type'] || bestMatch.type,
            Status: companyItem.status,
            'Registration Date': companyItem.date,
            'Registered Office':
              fields['Registered office'] ||
              fields['Registered office address'] ||
              '',
            'Principal Place of Business':
              fields['Principal place of business'] || '',
            Charges:
              fields['Number of charges'] || fields['Charges'] || '',
          };

          results.push(companyItem);
          results.push(...parseDirectors($d, detailUrl));
        } catch {
          results.push(companyItem);
        }
      } else {
        results.push(companyItem);
      }
    }
  } catch {
    // return empty results — scraper failure is non-fatal
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
        : `No ASIC records found for ${query}`,
  };
}

module.exports = { searchASIC };
