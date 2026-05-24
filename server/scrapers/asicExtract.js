const cheerio = require('cheerio');
const { getBrowser } = require('./browser');

const BASE = 'https://connectonline.asic.gov.au';

async function fetchAdfPage(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const title = await page.title();
      const isChallenge =
        title === 'Just a moment...' ||
        title === 'Please Wait...' ||
        title === 'Attention Required!' ||
        title === '';
      if (!isChallenge) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    await new Promise((r) => setTimeout(r, 3_000));
    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

// Officers-by-person-name search — returns all company associations for a named individual
function officerSearchUrl(name) {
  return `${BASE}/RegistrySearch/faces/landing/SearchRegisters.jspx?searchType=OfficerPersonNm&searchText=${encodeURIComponent(name)}`;
}

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function isAcn(text) {
  return /^\d{3}\s?\d{3}\s?\d{3}$/.test(text.trim());
}

// Fetch the list of company associations for one director name.
// ASIC Connect officer search returns a table where each row is a
// (person, company) pair — one row per company the person is/was an officer of.
async function fetchDirectorCompanies(directorName) {
  const searchUrl = officerSearchUrl(directorName);
  const companies = [];

  try {
    const html = await fetchAdfPage(searchUrl);
    const $ = cheerio.load(html);

    $('table tbody tr').each((_, row) => {
      const $cells = $(row).find('td');
      if ($cells.length < 3) return;

      let companyName = '';
      let companyUrl = searchUrl;
      let acn = '';
      let role = '';
      let status = '';

      $cells.each((_, cell) => {
        const $cell = $(cell);
        const text = $cell.text().trim();
        const lower = normalise(text);

        if (!text) return;

        // ACN is 9 digits (may have spaces)
        if (isAcn(text)) {
          acn = text.replace(/\s/g, '');
          return;
        }

        // Cells with links are the company name
        const $link = $cell.find('a');
        if ($link.length && !companyName) {
          companyName = $link.text().trim();
          const href = $link.attr('href') || '';
          companyUrl = href
            ? href.startsWith('http')
              ? href
              : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`
            : searchUrl;
          return;
        }

        // Role column
        if (
          (lower.includes('director') ||
            lower.includes('secretary') ||
            lower.includes('officer') ||
            lower.includes('manager')) &&
          !role
        ) {
          role = text;
          return;
        }

        // Status column — look for registration status keywords
        if (
          lower.includes('register') ||
          lower.includes('deregist') ||
          lower.includes('wound') ||
          lower.includes('active') ||
          lower.includes('cancel') ||
          lower.includes('struck')
        ) {
          status = text;
        }
      });

      if (!companyName) return;

      companies.push({ companyName, companyUrl, acn, role, status, director: directorName });
    });
  } catch {
    // non-fatal — leave companies empty
  }

  return companies.slice(0, 15);
}

async function searchAsicExtract(companyName, abn, acn, directorNames) {
  const fallbackUrl = `${BASE}/RegistrySearch/faces/landing/SearchRegisters.jspx?searchType=OfficerPersonNm`;

  if (!directorNames || directorNames.length === 0) {
    return {
      source: 'ASIC — Director Company History (Deep Check)',
      jurisdiction: 'Federal',
      category: 'identity',
      results: [],
      searchUrl: fallbackUrl,
      summary: 'No directors identified for officer search',
    };
  }

  // Limit to 4 directors — avoids excessive requests
  const directorsToCheck = directorNames.slice(0, 4).filter(Boolean);
  const seen = new Set();
  const allCompanies = [];

  const perDirector = await Promise.all(directorsToCheck.map(fetchDirectorCompanies));

  for (const companies of perDirector) {
    for (const co of companies) {
      // Deduplicate by ACN (if available) or company name
      const key = co.acn || normalise(co.companyName);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      allCompanies.push(co);
    }
  }

  // Exclude the target company itself from the results (we already have it from asic.js)
  const normTarget = normalise(companyName);
  const filtered = allCompanies.filter(
    (co) => !normTarget || normalise(co.companyName) !== normTarget
  );

  const resultItems = filtered.map((co) => ({
    title: co.companyName,
    url: co.companyUrl,
    status: co.status,
    description: [co.role ? `Role: ${co.role}` : null, `Director: ${co.director}`]
      .filter(Boolean)
      .join(' — '),
    metadata: {
      ACN: co.acn || '',
      Director: co.director,
      Role: co.role || '',
      Status: co.status || '',
    },
  }));

  const deregisteredCount = resultItems.filter(
    (r) =>
      r.status?.toLowerCase().includes('deregistered') ||
      r.status?.toLowerCase().includes('cancelled') ||
      r.status?.toLowerCase().includes('wound up') ||
      r.status?.toLowerCase().includes('struck off')
  ).length;

  const firstUrl = directorsToCheck[0] ? officerSearchUrl(directorsToCheck[0]) : fallbackUrl;

  return {
    source: 'ASIC — Director Company History (Deep Check)',
    jurisdiction: 'Federal',
    category: 'identity',
    results: resultItems,
    searchUrl: firstUrl,
    summary:
      resultItems.length > 0
        ? `${resultItems.length} associated compan${resultItems.length !== 1 ? 'ies' : 'y'} found for ${directorsToCheck.length} director(s)` +
          (deregisteredCount > 0
            ? ` — ${deregisteredCount} deregistered or cancelled`
            : ' — no deregistered entities found')
        : `${directorsToCheck.length} director(s) checked — no additional company associations found`,
  };
}

module.exports = { searchAsicExtract };
