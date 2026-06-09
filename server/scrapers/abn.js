const axios = require('axios');
const cheerio = require('cheerio');

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

async function searchABN(abn, companyName, acn) {
  const results = [];

  if (abn) {
    const cleanAbn = abn.replace(/\s/g, '');
    try {
      const { data } = await axios.get(
        `https://abr.business.gov.au/ABN/View?id=${cleanAbn}`,
        { headers: HEADERS, timeout: 15000 }
      );
      const $ = cheerio.load(data);

      const fields = {};
      $('table.abr-detail tr').each((_, row) => {
        const label = $(row).find('th').text().trim();
        const value = $(row).find('td').text().trim();
        if (label && value) fields[label] = value;
      });

      // Also try definition list format
      $('dl').each((_, dl) => {
        $(dl).find('dt').each((i, dt) => {
          const dd = $(dt).next('dd');
          if (dd.length) fields[$(dt).text().trim()] = dd.text().trim();
        });
      });

      // Try the main heading for entity name
      const entityName =
        $('h1.entity-name').text().trim() ||
        $('span.entityName').text().trim() ||
        $('h1').first().text().trim();

      if (entityName || Object.keys(fields).length > 0) {
        results.push({
          title: entityName || `ABN ${cleanAbn}`,
          url: `https://abr.business.gov.au/ABN/View?id=${cleanAbn}`,
          metadata: fields,
          status: fields['Status'] || fields['ABN status'] || '',
          date: fields['Registration date'] || fields['Date of registration'] || '',
        });
      }
    } catch {
      // fall through to name search
    }
  }

  if (companyName && results.length === 0) {
    const nameResults = [];
    try {
      const encoded = encodeURIComponent(companyName);
      const { data } = await axios.get(
        `https://abr.business.gov.au/Search/ResultsActive?SearchText=${encoded}`,
        { headers: HEADERS, timeout: 15000 }
      );
      const $ = cheerio.load(data);

      $('table tbody tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 2) return;
        const abnCell = cells.eq(0);
        const abnLink = abnCell.find('a');
        const abnValue = abnLink.text().trim().replace(/\s/g, '');
        const name = cells.eq(1).text().trim();
        if (!name || !abnValue) return;
        nameResults.push({
          title: name,
          url: abnLink.attr('href')
            ? `https://abr.business.gov.au${abnLink.attr('href')}`
            : `https://abr.business.gov.au/Search/ResultsActive?SearchText=${encoded}`,
          metadata: {
            ABN: abnValue,
            Type: cells.eq(2)?.text().trim() || '',
            State: cells.eq(3)?.text().trim() || '',
            Status: abnCell.find('span').text().trim() || '',
          },
        });
      });
    } catch {
      // ignore
    }

    // Narrow to the specific entity when an identifier is available.
    // ABN = 2-digit prefix + 9-digit ACN, so last 9 digits of ABN == ACN.
    const cleanAcn = (acn || '').replace(/\s/g, '');
    const cleanAbn = (abn || '').replace(/\s/g, '');
    if (cleanAcn) {
      const byAcn = nameResults.filter(r => (r.metadata.ABN || '').slice(2) === cleanAcn);
      results.push(...(byAcn.length > 0 ? byAcn : nameResults.filter(r =>
        normaliseName(r.title) === normaliseName(companyName)
      )));
    } else if (cleanAbn) {
      const byAbn = nameResults.filter(r => r.metadata.ABN === cleanAbn);
      results.push(...(byAbn.length > 0 ? byAbn : nameResults.filter(r =>
        normaliseName(r.title) === normaliseName(companyName)
      )));
    } else {
      // Name-only: exact normalised match, fall back to all results if nothing matches.
      const byName = nameResults.filter(r => normaliseName(r.title) === normaliseName(companyName));
      results.push(...(byName.length > 0 ? byName : nameResults));
    }
  }

  const searchTerm = abn || companyName;
  return {
    source: 'ABR — Australian Business Register',
    jurisdiction: 'Federal',
    category: 'identity',
    results,
    searchUrl: abn
      ? `https://abr.business.gov.au/ABN/View?id=${abn.replace(/\s/g, '')}`
      : `https://abr.business.gov.au/Search/ResultsActive?SearchText=${encodeURIComponent(companyName || '')}`,
    summary:
      results.length > 0
        ? `Found ${results.length} record(s) for ${searchTerm}`
        : `No ABR records found for ${searchTerm}`,
  };
}

async function searchByName(companyName) {
  const results = [];
  try {
    const encoded = encodeURIComponent(companyName);
    const { data } = await axios.get(
      `https://abr.business.gov.au/Search/ResultsActive?SearchText=${encoded}`,
      { headers: HEADERS, timeout: 15000 }
    );
    const $ = cheerio.load(data);

    $('table tbody tr').each((_, row) => {
      if (results.length >= 10) return false;
      const cells = $(row).find('td');
      if (cells.length < 2) return;
      const abnCell = cells.eq(0);
      const abn = abnCell.find('a').text().trim().replace(/\s/g, '');
      const name = cells.eq(1).text().trim();
      if (!name || !abn) return;
      results.push({
        name,
        abn,
        type: cells.eq(2)?.text().trim() || '',
        state: cells.eq(3)?.text().trim() || '',
        status: abnCell.find('span').text().trim() || '',
      });
    });
  } catch {
    // return empty on error
  }
  return results;
}

module.exports = { searchABN, searchByName };
