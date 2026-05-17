const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
};

// AustLII database prefixes keyed by jurisdiction
const JURISDICTION_MASK = {
  federal: '/au/cases/cth',
  qld: '/au/cases/qld',
  nsw: '/au/cases/nsw',
  vic: '/au/cases/vic',
  wa: '/au/cases/wa',
  sa: '/au/cases/sa',
  nt: '/au/cases/nt',
  act: '/au/cases/act',
  tas: '/au/cases/tas',
};

const JURISDICTION_LABELS = {
  federal: 'Federal',
  qld: 'QLD',
  nsw: 'NSW',
  vic: 'VIC',
  wa: 'WA',
  sa: 'SA',
  nt: 'NT',
  act: 'ACT',
  tas: 'TAS',
};

// Key courts and tribunals per jurisdiction for the report
const JURISDICTION_SOURCES = {
  federal: [
    'Federal Court of Australia',
    'Federal Circuit Court',
    'High Court of Australia',
    'Fair Work Commission',
    'Fair Work Australia',
  ],
  qld: [
    'QLD Supreme Court',
    'QLD District Court',
    'QLD Magistrates Court',
    'Queensland Civil & Administrative Tribunal (QCAT)',
    'Queensland Industrial Relations Commission',
    'Queensland Planning & Environment Court',
  ],
  nsw: [
    'NSW Supreme Court',
    'NSW District Court',
    'NSW Local Court',
    'NSW Land & Environment Court',
    'NSW Civil & Administrative Tribunal (NCAT)',
    'NSW Industrial Relations Commission',
  ],
  vic: [
    'VIC Supreme Court',
    'VIC County Court',
    'VIC Magistrates Court',
    'Victorian Civil & Administrative Tribunal (VCAT)',
  ],
  wa: [
    'WA Supreme Court',
    'WA District Court',
    'WA Magistrates Court',
    'WA State Administrative Tribunal (SAT)',
    'WA Industrial Relations Commission',
  ],
  sa: [
    'SA Supreme Court',
    'SA District Court',
    'SA Magistrates Court',
    'SA Employment Tribunal (SAET)',
    'SA Environment Resources & Development Court',
  ],
  nt: ['NT Supreme Court', 'NT Local Court', 'NT Civil & Administrative Tribunal (NTCAT)'],
  act: [
    'ACT Supreme Court',
    'ACT Magistrates Court',
    'ACT Civil & Administrative Tribunal (ACAT)',
  ],
  tas: ['TAS Supreme Court', 'TAS Magistrates Court'],
};

async function searchAustLII(companyName, directors = [], jurisdiction = 'federal') {
  const maskPath = JURISDICTION_MASK[jurisdiction] || '';
  const jLabel = JURISDICTION_LABELS[jurisdiction] || jurisdiction.toUpperCase();

  // Build search terms: company name + each director
  const terms = [companyName, ...(directors || []).filter(Boolean)];
  const allResults = [];

  for (const term of terms) {
    if (!term) continue;
    const query = `"${term}"`;
    const searchUrl = `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(query)}&mask_path=${encodeURIComponent(maskPath)}&results=20`;

    try {
      const { data } = await axios.get(searchUrl, { headers: HEADERS, timeout: 20000 });
      const $ = cheerio.load(data);
      const parsed = [];

      // AustLII results are typically in <li> elements with <a> links
      $('li').each((_, el) => {
        const link = $(el).find('a').first();
        const href = link.attr('href');
        const title = link.text().trim();
        if (!href || !title || !href.includes('/cases/')) return;

        const snippet = $(el).text().replace(title, '').trim().replace(/\s+/g, ' ').slice(0, 200);
        const fullUrl = href.startsWith('http') ? href : `https://www.austlii.edu.au${href}`;

        parsed.push({
          title,
          url: fullUrl,
          description: snippet || undefined,
          matchedTerm: term,
        });
      });

      // Also check older AustLII result format (numbered list in <ol>)
      if (parsed.length === 0) {
        $('ol li').each((_, el) => {
          const link = $(el).find('a').first();
          const href = link.attr('href');
          const title = link.text().trim();
          if (!href || !title) return;
          const fullUrl = href.startsWith('http') ? href : `https://www.austlii.edu.au${href}`;
          const snippet = $(el)
            .text()
            .replace(title, '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 200);
          parsed.push({ title, url: fullUrl, description: snippet || undefined, matchedTerm: term });
        });
      }

      allResults.push(...parsed);
    } catch {
      // skip this term on error
    }
  }

  // De-duplicate by URL
  const seen = new Set();
  const unique = allResults.filter(({ url }) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  const primarySearchUrl = `https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?method=auto&query=${encodeURIComponent(`"${companyName}"`)}&mask_path=${encodeURIComponent(maskPath)}&results=20`;

  return {
    source: `${jLabel} Courts & Tribunals`,
    jurisdiction: jLabel,
    category: 'legal',
    results: unique,
    searchUrl: primarySearchUrl,
    sources: JURISDICTION_SOURCES[jurisdiction] || [],
    summary:
      unique.length > 0
        ? `Found ${unique.length} case(s) in ${jLabel} courts and tribunals`
        : `No cases found in ${jLabel} courts and tribunals`,
  };
}

module.exports = { searchAustLII };
