const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html',
  Referer: 'https://www.qbcc.qld.gov.au/',
};

async function searchQBCC(companyName, abn) {
  const results = [];

  // QBCC public contractor search
  try {
    const searchUrl = `https://www.qbcc.qld.gov.au/api/licensee-search?name=${encodeURIComponent(companyName)}&licenceNumber=&suburb=&licenceType=&licenceStatus=Active`;
    const { data } = await axios.get(searchUrl, { headers: HEADERS, timeout: 15000 });

    const items = Array.isArray(data) ? data : data?.results || data?.data || [];
    for (const item of items) {
      const licencee = item.licenceeName || item.name || item.companyName || '';
      const licenceNo = item.licenceNumber || item.licenceNo || '';
      const licenceClass = item.licenceClass || item.licenceType || item.category || '';
      const status = item.licenceStatus || item.status || '';
      const expiry = item.expiryDate || item.licenceExpiry || '';
      const financialCategory = item.financialCategory || item.financialLimit || '';

      results.push({
        title: licencee || companyName,
        url: `https://www.qbcc.qld.gov.au/find-a-local-contractor`,
        status,
        date: expiry,
        metadata: {
          'Licence Number': licenceNo,
          'Licence Class': licenceClass,
          Status: status,
          'Expiry Date': expiry,
          'Financial Category': financialCategory,
        },
      });
    }
  } catch {
    // Try HTML scrape of the public-facing search
    try {
      const encoded = encodeURIComponent(companyName);
      const { data } = await axios.get(
        `https://www.qbcc.qld.gov.au/find-a-local-contractor?name=${encoded}`,
        { headers: { ...HEADERS, Accept: 'text/html' }, timeout: 20000 }
      );
      const $ = cheerio.load(data);

      $('table tbody tr, [class*="contractor"], [class*="licensee"]').each((_, row) => {
        const cells = $('td', row);
        if (cells.length < 2) return;
        results.push({
          title: cells.eq(0).text().trim(),
          url: `https://www.qbcc.qld.gov.au/find-a-local-contractor`,
          metadata: {
            'Licence Number': cells.eq(1).text().trim(),
            'Licence Class': cells.eq(2)?.text().trim() || '',
            Status: cells.eq(3)?.text().trim() || '',
          },
        });
      });
    } catch {
      // ignore
    }
  }

  // QBCC Adjudication decisions search
  const adjudicationResults = [];
  try {
    const { data: adjData } = await axios.get(
      `https://www.qbcc.qld.gov.au/adjudication-decisions?search=${encodeURIComponent(companyName)}`,
      { headers: { ...HEADERS, Accept: 'text/html' }, timeout: 15000 }
    );
    const $ = cheerio.load(adjData);

    $('table tbody tr, [class*="decision"], article').each((_, el) => {
      const link = $(el).find('a').first();
      const title = link.text().trim() || $(el).find('td').first().text().trim();
      if (!title) return;
      const href = link.attr('href');
      adjudicationResults.push({
        title,
        url: href
          ? href.startsWith('http') ? href : `https://www.qbcc.qld.gov.au${href}`
          : 'https://www.qbcc.qld.gov.au/adjudication-decisions',
        description: $(el).text().trim().slice(0, 200),
      });
    });
  } catch {
    // ignore
  }

  const allResults = [
    ...results,
    ...adjudicationResults.map((r) => ({ ...r, isAdjudication: true })),
  ];

  return {
    source: 'QBCC — Queensland Building & Construction Commission',
    jurisdiction: 'QLD',
    category: 'license',
    results: allResults,
    licenceResults: results,
    adjudicationResults,
    searchUrl: `https://www.qbcc.qld.gov.au/find-a-local-contractor?name=${encodeURIComponent(companyName)}`,
    adjudicationSearchUrl: `https://www.qbcc.qld.gov.au/adjudication-decisions`,
    summary:
      allResults.length > 0
        ? `Found ${results.length} licence(s) and ${adjudicationResults.length} adjudication decision(s)`
        : 'No QBCC licence or adjudication records found',
  };
}

module.exports = { searchQBCC };
