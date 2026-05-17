const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html',
};

async function searchPaymentTimes(companyName, abn) {
  const query = abn ? abn.replace(/\s/g, '') : companyName;
  const results = [];

  // Try the PTRR JSON API first
  try {
    const apiUrl = `https://paymenttimes.gov.au/api/reporting-entities/search?query=${encodeURIComponent(query)}&page=1&pageSize=10`;
    const { data } = await axios.get(apiUrl, { headers: HEADERS, timeout: 15000 });

    const items = data?.results || data?.data || data?.entities || [];
    if (Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        const name = item.reportingEntityName || item.name || item.entityName || '';
        const entityAbn = item.abn || item.ABN || '';
        const reports = item.reports || [];

        const metadata = {
          ABN: entityAbn,
          'Reports submitted': String(reports.length || item.reportCount || ''),
        };

        if (reports.length > 0) {
          const latest = reports[0];
          if (latest.smallBusinessSmallestTime !== undefined)
            metadata['Avg days to pay (small suppliers)'] = `${latest.smallBusinessSmallestTime}–${latest.smallBusinessLargestTime} days`;
          if (latest.proportionInvoicesPaidWithin30Days !== undefined)
            metadata['Paid within 30 days'] = `${(latest.proportionInvoicesPaidWithin30Days * 100).toFixed(0)}%`;
          if (latest.proportionInvoicesPaidBetween30And60Days !== undefined)
            metadata['Paid 31–60 days'] = `${(latest.proportionInvoicesPaidBetween30And60Days * 100).toFixed(0)}%`;
          if (latest.proportionInvoicesPaidAfter60Days !== undefined)
            metadata['Paid after 60 days'] = `${(latest.proportionInvoicesPaidAfter60Days * 100).toFixed(0)}%`;
          if (latest.standardPaymentTerms !== undefined)
            metadata['Standard payment terms'] = `${latest.standardPaymentTerms} days`;
        }

        results.push({
          title: name || entityAbn,
          url: `https://paymenttimes.gov.au/reporting-entities/${entityAbn || ''}`,
          metadata,
          description: reports.length > 0 ? `${reports.length} payment times report(s) submitted` : undefined,
        });
      }
    }
  } catch {
    // Try HTML scrape fallback
    try {
      const encoded = encodeURIComponent(query);
      const { data } = await axios.get(
        `https://paymenttimes.gov.au/search?query=${encoded}`,
        { headers: { ...HEADERS, Accept: 'text/html' }, timeout: 15000 }
      );
      const $ = cheerio.load(data);

      // Extract any entity results from the HTML
      $('[class*="entity"], [class*="result"], [class*="card"]').each((_, el) => {
        const title = $(el).find('h2, h3, [class*="name"]').first().text().trim();
        const link = $(el).find('a').first();
        if (title) {
          results.push({
            title,
            url: link.attr('href') || `https://paymenttimes.gov.au/search?query=${encoded}`,
            description: $(el).text().trim().slice(0, 200),
          });
        }
      });
    } catch {
      // ignore
    }
  }

  const searchUrl = `https://paymenttimes.gov.au/search?query=${encodeURIComponent(query)}`;

  return {
    source: 'Payment Times Reporting Register',
    jurisdiction: 'Federal',
    category: 'payment',
    results,
    searchUrl,
    summary:
      results.length > 0
        ? `Found ${results.length} entity(s) with payment times data`
        : 'No payment times data found — entity may not be a required reporter or not yet submitted',
  };
}

module.exports = { searchPaymentTimes };
