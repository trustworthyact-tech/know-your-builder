const cheerio = require('cheerio');
const { getBrowser } = require('./browser');

const BASE = 'https://connectonline.asic.gov.au';

function buildSearchUrl(query) {
  return `${BASE}/RegistrySearch/faces/landing/SearchRegisters.jspx?searchType=OrgAndBusNm&searchText=${encodeURIComponent(query)}`;
}

function buildDetailUrl(acn) {
  return `${BASE}/RegistrySearch/faces/landing/orgDetails.jspx?searchType=OrgAndBusNm&orgKey=${acn.replace(/\s/g, '')}`;
}

// Navigate to an Oracle ADF page, wait for all AJAX to settle, then return rendered HTML.
async function fetchAdfPage(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });

    // Wait for WAF/Cloudflare challenge to clear
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const title = await page.title();
      const isChallenge =
        title === 'Just a moment...' ||
        title === 'Please Wait...' ||
        title === 'Attention Required!' ||
        title === '';
      if (!isChallenge) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // ADF components continue rendering DOM after the last network request
    await new Promise((r) => setTimeout(r, 3_000));

    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
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

async function searchASIC(companyName, abn, acn) {
  const derivedAcn = (acn || '').replace(/\s/g, '') || abnToAcn(abn) || '';
  const query = derivedAcn || companyName || '';
  const searchUrl = buildSearchUrl(query);
  const results = [];

  try {
    const searchHtml = await fetchAdfPage(searchUrl);
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
          const detailHtml = await fetchAdfPage(detailUrl);
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
    }
  } catch {
    // non-fatal — empty results returned
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

module.exports = { searchASIC };
