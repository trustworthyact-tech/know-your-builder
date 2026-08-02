const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html',
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns true if the entity name is a meaningful match for the search term.
// The register's search also matches subsidiaries listed inside statements,
// so we must confirm the *reporting entity itself* is the one we're looking for.
function isEntityMatch(entityText, companyName, abn) {
  const haystack = entityText.toLowerCase();

  // ABN match is definitive
  if (abn) {
    const cleanAbn = abn.replace(/\s/g, '');
    if (haystack.includes(cleanAbn)) return true;
  }

  // Name match: every distinctive word of the search term must appear in the entity
  // text as a whole word. Plain substring matching both false-positives on short
  // numeric tokens (e.g. "37" inside "237") and, without excluding "pty"/"ltd", treats
  // them as distinctive even though virtually every company name contains them.
  const words = companyName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  return words.every((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(haystack));
}

async function searchModernSlavery(companyName, abn) {
  const query = companyName;
  const results = [];

  // The register uses server-rendered HTML — scrape it directly.
  try {
    const encoded = encodeURIComponent(query);
    const { data } = await axios.get(
      `https://modernslaveryregister.gov.au/statements/?q=${encoded}`,
      { headers: { ...HEADERS, Accept: 'text/html' }, timeout: 15000 }
    );
    const $ = cheerio.load(data);

    // Each result is an <a class="search-results__item"> anchor
    $('a.search-results__item').each((_, el) => {
      const href = $(el).attr('href') || '';
      const entityText = $(el).find('.search-results__item-entity').text().trim();
      const period = $(el).find('.search-results__item-period').text().trim();

      if (!entityText) return;

      // Only include if the reporting entity itself matches — not just a subsidiary
      if (!isEntityMatch(entityText, companyName, abn)) return;

      // Extract clean entity name (first bold line) and ABN from the entity block
      const entityName = $(el).find('.search-results__item-entity div').first().text().trim();

      results.push({
        title: entityName || entityText,
        url: href.startsWith('http')
          ? href
          : `https://modernslaveryregister.gov.au${href}`,
        description: period || undefined,
        metadata: {
          'Reporting period': period,
          ABN: abn || '',
        },
      });
    });
  } catch {
    // ignore — network error or site unavailable
  }

  const searchUrl = `https://modernslaveryregister.gov.au/statements/?q=${encodeURIComponent(query)}`;

  return {
    source: 'Modern Slavery Statements Register',
    jurisdiction: 'Federal',
    category: 'regulatory',
    results,
    searchUrl,
    summary:
      results.length > 0
        ? `Found ${results.length} modern slavery statement(s)`
        : 'No modern slavery statements found — entity may be below the threshold or not yet submitted',
  };
}

module.exports = { searchModernSlavery };
