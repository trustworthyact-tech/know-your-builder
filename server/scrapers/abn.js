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

// The ABR detail page renders each section (ABN details, Business name(s),
// Trading name(s)) as its own <table><caption>Section title ...</caption>.
// Extracts the first column of each two-<td> data row under the table whose
// caption starts with captionPrefix — skips the intro/help row (1 <td>,
// colspan) and the header row (<th> cells, not <td>).
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

async function searchABN(abn, companyName, acn) {
  const results = [];
  let businessNames = [];
  let tradingNames = [];

  if (abn) {
    const cleanAbn = abn.replace(/\s/g, '');
    try {
      const { data } = await axios.get(
        `https://abr.business.gov.au/ABN/View?id=${cleanAbn}`,
        { headers: HEADERS, timeout: 15000 }
      );
      const $ = cheerio.load(data);

      // The "ABN details" table has no id/class, only a <caption> — pull th/td
      // pairs from that table specifically so we don't also sweep up rows from
      // the Business name(s) / Trading name(s) tables below.
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

      businessNames = extractNameTable($, 'Business name');
      tradingNames = extractNameTable($, 'Trading name');

      // Entity name lives in a semantic itemprop, not a heading — the old
      // h1 fallback picked up the page's "Current details for ABN ..." title
      // instead of the actual legal name.
      const entityName =
        $('span[itemprop="legalName"]').first().text().trim() ||
        $('h1.entity-name').text().trim() ||
        $('span.entityName').text().trim();

      if (entityName || Object.keys(fields).length > 0) {
        if (businessNames.length > 0) fields['Business Name(s)'] = businessNames.join(', ');
        if (tradingNames.length > 0) fields['Trading Name(s)'] = tradingNames.join(', ');
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
    businessNames,
    tradingNames,
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
