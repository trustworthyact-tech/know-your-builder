const cheerio = require('cheerio');
const { fetchAdfDpnSearch } = require('./browser');

const BASE = 'https://connectonline.asic.gov.au';
const DPN_FALLBACK_URL = `${BASE}/RegistrySearch/faces/landing/panelSearch.jspx?searchType=DPNm`;

function buildSearchUrl(name) {
  return `${DPN_FALLBACK_URL}&searchText=${encodeURIComponent(name)}`;
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  // ASIC Connect officer tables use SURNAME-first format (e.g. "ROBERTS Digby").
  // Detect: first word is 2+ uppercase letters only.
  const firstWord = parts[0] || '';
  if (parts.length > 1 && /^[A-Z]{2,}$/.test(firstWord)) {
    return { surname: firstWord, given: parts.slice(1).join(' ') };
  }
  // Standard given-name-first: surname is the last word.
  const surname = parts.pop() || '';
  const given = parts.join(' ');
  return { surname, given };
}

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

// Order-independent word match — handles ASIC surname-first formatting.
// "ROBERTS Veronica" correctly matches query "Veronica Roberts".
function isNameMatch(resultName, queryName) {
  const rWords = new Set(normalise(resultName).split(/\s+/));
  const qWords = normalise(queryName).split(/\s+/).filter(Boolean);
  return qWords.length > 0 && qWords.every((w) => rWords.has(w));
}

// Exported so tests can call it directly against sample HTML.
//
// ADF renders the DPN results in a table with 7 columns:
//   0: Select (checkbox)
//   1: Family Name data cell — contains a hidden span with the DPN number,
//      then a hidden span with the full name, plus visible sort links
//   2: Given Name(s)
//   3: Type (e.g. "Disqualified Person")
//   4: Commenced date
//   5: Ceased date
//   6: Address
function parseDisqualifiedResults(html, directorName, searchUrl) {
  const $ = cheerio.load(html);
  const matches = [];

  $('table tr').each((_, row) => {
    const $cells = $(row).find('td');
    if ($cells.length < 6) return;

    // Type is at index 3; skip if it doesn't mention disqualification.
    const typeText = $cells.eq(3).text().trim();
    if (!/disqualif/i.test(typeText)) return;

    // Full name is the text of the 2nd display:none span inside cell 1.
    // ADF injects two hidden spans: [DPN number, full name].
    const $nameCell = $cells.eq(1);
    const hiddenSpans = $nameCell.find('span').filter(
      (_, s) => /display\s*:\s*none/.test($(s).attr('style') || '')
    );
    const fullName = hiddenSpans.eq(1).text().trim();
    if (!fullName || !isNameMatch(fullName, directorName)) return;

    const orderDate = $cells.eq(4).text().trim();
    const expiryDate = $cells.eq(5).text().trim();
    const address = $cells.eq(6)?.text().trim() || '';

    matches.push({
      title: `${fullName} — disqualified from managing corporations`,
      url: searchUrl,
      date: expiryDate ? `Order expires: ${expiryDate}` : orderDate,
      status: 'Disqualified',
      description: address ? `Address: ${address}` : 'Listed on the ASIC Disqualified Persons Register',
      metadata: {
        'Director Name': fullName,
        'Order Date': orderDate,
        'Expiry Date': expiryDate,
        Type: typeText,
        Address: address,
      },
    });
  });

  return matches;
}

async function checkDirector(directorName, captchaApiKey) {
  const searchUrl = buildSearchUrl(directorName);
  try {
    const { surname, given } = splitName(directorName);
    if (!surname || !given) return [];
    const html = await fetchAdfDpnSearch(surname, given, captchaApiKey);
    return parseDisqualifiedResults(html, directorName, searchUrl);
  } catch (err) {
    console.warn(`[asicDisqualified] checkDirector failed for "${directorName}":`, err.message);
    return [];
  }
}

async function searchASICDisqualified(directors, captchaApiKey) {
  if (!directors || directors.length === 0) {
    return {
      source: 'ASIC — Disqualified Persons Register',
      jurisdiction: 'Federal',
      category: 'identity',
      results: [],
      searchUrl: DPN_FALLBACK_URL,
      summary: 'No directors identified for disqualification check',
    };
  }

  if (!captchaApiKey) {
    return {
      source: 'ASIC — Disqualified Persons Register',
      jurisdiction: 'Federal',
      category: 'identity',
      results: [],
      searchUrl: DPN_FALLBACK_URL,
      summary: `${directors.length} director(s) — automated check unavailable, verify manually via ASIC Connect`,
    };
  }

  const allMatches = [];
  const checked = directors.filter(Boolean).slice(0, 6);
  const firstUrl = checked[0] ? buildSearchUrl(checked[0]) : DPN_FALLBACK_URL;

  const perDirector = await Promise.all(checked.map((d) => checkDirector(d, captchaApiKey)));
  for (const matches of perDirector) allMatches.push(...matches);

  return {
    source: 'ASIC — Disqualified Persons Register',
    jurisdiction: 'Federal',
    category: 'identity',
    results: allMatches,
    searchUrl: firstUrl,
    summary:
      allMatches.length > 0
        ? `${allMatches.length} director(s) found on the ASIC disqualified persons register`
        : `${checked.length} director(s) checked — no disqualification records found`,
  };
}

module.exports = { searchASICDisqualified, parseDisqualifiedResults };
