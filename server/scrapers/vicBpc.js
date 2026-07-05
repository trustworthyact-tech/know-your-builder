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
    .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((w) => lower.includes(w));
}

// The VBA prosecution register uses an accordion layout.
// Each .accordion__block has a .da_name button (practitioner name) and a
// .da_record div (registration, proceeding type, date, action details).
//
// The page has two entry types:
//   1. Disciplinary entries  — da_name is just the practitioner name;
//      uses "Decision date:", "Disciplinary proceeding:", "Disciplinary action taken" h3
//   2. Prosecution entries   — da_name is "Prosecution of <Name>";
//      uses "Outcome date:", "Prosecuted for:" h3, "Outcome:" h3
function parseAccordionItems($, companyName) {
  const results = [];

  $('.accordion__block').each((_, block) => {
    const $block = $(block);
    const rawHeading = $block.find('.da_name').text().trim();
    const fullText = $block.text();

    if (!nameMatchesEntity(fullText, companyName)) return;

    const $record = $block.find('.da_record');

    // Date: accept "Decision date:" (disciplinary) or "Outcome date:" (prosecution)
    const dateRaw =
      $record.find('p:contains("Decision date")').text().replace('Decision date:', '').trim() ||
      $record.find('p:contains("Outcome date")').text().replace('Outcome date:', '').trim();

    // Registration (disciplinary entries only)
    const registrationRaw = $record.find('p:contains("Registration")').text()
      .replace('Registration:', '').trim();

    // Proceeding type (disciplinary entries only)
    const proceeding = $record.find('p:contains("Disciplinary proceeding")').text()
      .replace('Disciplinary proceeding:', '').trim();

    // Action text — covers both "Disciplinary action taken" and "Outcome:" headings
    const actionHeading = $record.find('h3').filter((_, h) =>
      $(h).text().includes('Disciplinary action') || $(h).text().includes('Outcome'));
    const actionText = actionHeading.next('p').text().trim() + ' ' +
      actionHeading.nextAll('ul').first().text().trim();

    // Grounds text (disciplinary entries)
    const groundsHeading = $record.find('h3').filter((_, h) => $(h).text().includes('grounds'));
    const grounds = groundsHeading.next('p').text().trim();

    // Prosecution entries label the h3 "Prosecuted for:" — use its following text as grounds
    const prosecutedForHeading = $record.find('h3').filter((_, h) =>
      $(h).text().includes('Prosecuted for'));
    const prosecutedFor = prosecutedForHeading.next('p').text().trim() +
      ' ' + prosecutedForHeading.nextAll('p').first().text().trim();

    // Link to the register page (no per-case deep-link available)
    const url = PROSECUTION_REGISTER_URL;

    results.push({
      title: rawHeading,
      url,
      date: dateRaw.replace(/\s+/g, ' '),
      status: actionText.trim().slice(0, 120) || proceeding || 'VBA action',
      description: (grounds || prosecutedFor.trim()).slice(0, 250) ||
        `VBA proceeding — ${proceeding || rawHeading}`,
      jurisdiction: 'VIC',
      metadata: {
        Source: 'Victorian Building Authority',
        Registration: registrationRaw,
        Proceeding: proceeding,
        Date: dateRaw.replace(/\s+/g, ' '),
        Action: actionText.trim().slice(0, 200),
      },
    });
  });

  return results;
}

async function searchVicBpc(companyName, abn, directors) {
  const allResults = [];
  const seen = new Set();

  const queries = [
    // Strip Pty Ltd so List.js matches on the distinctive words
    companyName.replace(/\s*pty\s*ltd\.?\s*$/i, '').trim(),
    ...(directors || []).filter(Boolean),
  ];

  const urls = [PROSECUTION_REGISTER_URL, CURRENT_PROCEEDINGS_URL];
  for (const query of queries) {
    for (const url of urls) {
      try {
        const html = await fetchWithBrowserSearch(url, query, '#listjs-search');
        const $ = cheerio.load(html);
        // Match against the query term (company name or director name)
        const found = parseAccordionItems($, query);
        for (const r of found) {
          if (!seen.has(r.title + r.date)) {
            seen.add(r.title + r.date);
            allResults.push(r);
          }
        }
      } catch {
        // non-fatal
      }
    }
  }

  return {
    source: 'Victorian Building Authority — Disciplinary Register',
    jurisdiction: 'VIC',
    category: 'regulatory',
    results: allResults,
    searchUrl: PROSECUTION_REGISTER_URL,
    summary:
      allResults.length > 0
        ? `${allResults.length} VBA disciplinary proceeding(s) found`
        : 'No VBA disciplinary proceedings found for this entity',
  };
}

module.exports = { searchVicBpc };
