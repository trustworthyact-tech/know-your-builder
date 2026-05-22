const cheerio = require('cheerio');
const { fetchWithBrowserSearch } = require('./browser');

const BASE = 'https://www.vba.vic.gov.au';
// Prosecution register covers completed orders, disqualifications, and historical actions.
// Current proceedings register only covers pending/active proceedings.
const PROSECUTION_REGISTER_URL = `${BASE}/tools/prosecution-and-disciplinary-register`;
const CURRENT_PROCEEDINGS_URL = `${BASE}/about/current-disciplinary-proceedings/register-of-disciplinary-proceedings`;
const REGISTER_URL = PROSECUTION_REGISTER_URL;

// Every significant word must appear in the record text to prevent false positives.
function nameMatchesEntity(text, companyName) {
  if (!companyName) return false;
  const words = companyName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((w) => lower.includes(w));
}

// The VBA prosecution register uses an accordion layout.
// Each .accordion__block has a .da_name button (practitioner name) and a
// .da_record div (registration, proceeding type, date, action details).
function parseAccordionItems($, companyName) {
  const results = [];

  $('.accordion__block').each((_, block) => {
    const $block = $(block);
    const name = $block.find('.da_name').text().trim();
    const fullText = $block.text();

    if (!nameMatchesEntity(fullText, companyName)) return;

    const $record = $block.find('.da_record');
    const registration = $record.find('p').first().text().replace('Registration:', '').trim();
    const proceeding = $record.find('p:contains("Disciplinary proceeding")').text()
      .replace('Disciplinary proceeding:', '').trim();
    const date = $record.find('p:contains("Decision date")').text()
      .replace('Decision date:', '').trim();

    const actionHeading = $record.find('h3').filter((_, h) => $(h).text().includes('Disciplinary action'));
    const actionText = actionHeading.next('p').text().trim() + ' ' +
      actionHeading.nextAll('ul').first().text().trim();

    const groundsHeading = $record.find('h3').filter((_, h) => $(h).text().includes('grounds'));
    const grounds = groundsHeading.next('p').text().trim();

    // Link to the register page (no per-case deep-link available)
    const url = PROSECUTION_REGISTER_URL;

    results.push({
      title: name,
      url,
      date: date.replace(/\s+/g, ' '),
      status: actionText.trim().slice(0, 120) || proceeding || 'Disciplinary action',
      description: grounds.slice(0, 250) || `VBA disciplinary proceeding — ${proceeding}`,
      jurisdiction: 'VIC',
      metadata: {
        Source: 'Victorian Building Authority',
        Registration: registration,
        Proceeding: proceeding,
        Date: date.replace(/\s+/g, ' '),
        Action: actionText.trim().slice(0, 200),
      },
    });
  });

  return results;
}

async function searchVicBpc(companyName, abn) {
  let results = [];

  // Search term: strip Pty Ltd suffix so List.js matches on the distinctive words.
  const searchTerm = companyName.replace(/\s*pty\s*ltd\.?\s*$/i, '').trim();

  // Try prosecution register (completed orders, disqualifications) first,
  // then current proceedings register. Both use the same List.js search pattern.
  const urls = [PROSECUTION_REGISTER_URL, CURRENT_PROCEEDINGS_URL];
  for (const url of urls) {
    try {
      const html = await fetchWithBrowserSearch(url, searchTerm, '#listjs-search');
      const $ = cheerio.load(html);
      const found = parseAccordionItems($, companyName);
      results.push(...found);
    } catch {
      // non-fatal — silently skip if page is unreachable
    }
  }

  return {
    source: 'Victorian Building Authority — Disciplinary Register',
    jurisdiction: 'VIC',
    category: 'regulatory',
    results,
    searchUrl: PROSECUTION_REGISTER_URL,
    summary:
      results.length > 0
        ? `${results.length} VBA disciplinary proceeding(s) found`
        : 'No VBA disciplinary proceedings found for this entity',
  };
}

module.exports = { searchVicBpc };
