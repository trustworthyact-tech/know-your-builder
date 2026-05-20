const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

async function searchABN(abn, companyName) {
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
    try {
      const encoded = encodeURIComponent(companyName);
      const { data } = await axios.get(
        `https://abr.business.gov.au/Search/SearchBusines?SearchText=${encoded}&SearchType=names`,
        { headers: HEADERS, timeout: 15000 }
      );
      const $ = cheerio.load(data);

      $('table tbody tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const nameCell = cells.eq(0);
          const link = nameCell.find('a');
          results.push({
            title: link.text().trim() || nameCell.text().trim(),
            url: link.attr('href')
              ? `https://abr.business.gov.au${link.attr('href')}`
              : `https://abr.business.gov.au/Search/SearchBusines?SearchText=${encoded}&SearchType=names`,
            metadata: {
              ABN: cells.eq(1).text().trim(),
              Type: cells.eq(2)?.text().trim() || '',
              State: cells.eq(3)?.text().trim() || '',
              Status: cells.eq(4)?.text().trim() || '',
            },
          });
        }
      });
    } catch {
      // ignore
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
      : `https://abr.business.gov.au/Search/SearchBusines?SearchText=${encodeURIComponent(companyName || '')}&SearchType=names`,
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
      `https://abr.business.gov.au/Search/SearchBusines?SearchText=${encoded}&SearchType=names`,
      { headers: HEADERS, timeout: 15000 }
    );
    const $ = cheerio.load(data);

    $('table tbody tr').each((_, row) => {
      if (results.length >= 10) return false;
      const cells = $(row).find('td');
      if (cells.length < 2) return;
      const nameCell = cells.eq(0);
      const link = nameCell.find('a');
      const name = link.text().trim() || nameCell.text().trim();
      const abn = cells.eq(1).text().trim().replace(/\s/g, '');
      if (!name || !abn) return;
      results.push({
        name,
        abn,
        type: cells.eq(2)?.text().trim() || '',
        state: cells.eq(3)?.text().trim() || '',
        status: cells.eq(4)?.text().trim() || '',
      });
    });
  } catch {
    // return empty on error
  }
  return results;
}

module.exports = { searchABN, searchByName };
