const axios = require('axios');
const cheerio = require('cheerio');

// NT Building Practitioners Board public register (NTLIS).
// Plain HTML GET form — no JS or auth required.
// Table columns: Name (linked), Contact Number, Address, Category, Status.

const BASE = 'https://www.ntlis.nt.gov.au/building-practitioners';
const SEARCH_URL = `${BASE}/results.jsp`;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html',
};

function nameMatchesEntity(text, query) {
  if (!query) return false;
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((w) => lower.includes(w));
}

async function fetchNT(query) {
  const url = `${SEARCH_URL}?name=${encodeURIComponent(query)}&status=`;
  const { data } = await axios.get(url, { headers: HEADERS, timeout: 20000 });
  const $ = cheerio.load(data);
  const results = [];

  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    const nameCell = cells.eq(0);
    const href = nameCell.find('a').attr('href') || '';
    const name = nameCell.text().trim();
    if (!name) return;

    const id = href.match(/id=(\d+)/)?.[1];
    results.push({
      name,
      phone: cells.eq(1).text().trim(),
      address: cells.eq(2).text().trim().replace(/\s+/g, ' '),
      category: cells.eq(3).text().trim(),
      status: cells.eq(4).text().trim(),
      url: id ? `${BASE}/result.jsp?id=${id}` : SEARCH_URL,
    });
  });

  return results;
}

async function searchNTBuildingPractitioners(companyName, abn, directors) {
  const allResults = [];
  const seen = new Set();

  const queries = [
    companyName.replace(/\s*pty\s*ltd\.?\s*$/i, '').trim(),
    ...(directors || []).filter(Boolean),
  ];

  for (const query of queries) {
    try {
      const hits = await fetchNT(query);
      for (const hit of hits) {
        if (!nameMatchesEntity(hit.name, query)) continue;
        if (seen.has(hit.url)) continue;
        seen.add(hit.url);

        allResults.push({
          title: hit.name,
          url: hit.url,
          status: hit.status,
          description: `${hit.category}${hit.address ? ' — ' + hit.address : ''}`,
          jurisdiction: 'NT',
          metadata: {
            Source: 'NT Building Practitioners Board',
            Category: hit.category,
            Status: hit.status,
            Address: hit.address,
            Phone: hit.phone,
          },
        });
      }
    } catch {
      // non-fatal
    }
  }

  const searchUrl = `${SEARCH_URL}?name=${encodeURIComponent(companyName)}&status=`;
  return {
    source: 'NT Building Practitioners Board — Licence Register',
    jurisdiction: 'NT',
    category: 'license',
    results: allResults,
    searchUrl,
    summary:
      allResults.length > 0
        ? `${allResults.length} NT building practitioner record(s) found`
        : 'No NT building practitioner licence records found',
  };
}

module.exports = { searchNTBuildingPractitioners };
