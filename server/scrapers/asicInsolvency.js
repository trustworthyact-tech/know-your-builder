const cheerio = require('cheerio');
const { getBrowser } = require('./browser');

// insolvencynotices.asic.gov.au was merged into publishednotices.asic.gov.au.
// All notices (winding-up applications, liquidator appointments, administrations) live here.
const BASE = 'https://publishednotices.asic.gov.au';
const SEARCH_URL = `${BASE}/browsesearch-notices`;

const INSOLVENCY_KEYWORDS = [
  'external administration',
  'voluntary administration',
  'administrator appointed',
  'liquidat',
  'winding up',
  'winding-up',
  'wind up',
  'receiver',
  'deed of company arrangement',
  'doca',
  'provisional liquidator',
  'court-ordered',
  'application to wind',
];

function isInsolvencyNotice(text) {
  const lower = (text || '').toLowerCase();
  return INSOLVENCY_KEYWORDS.some((k) => lower.includes(k));
}

// ACN = last 9 digits of ABN (strip spaces, take chars 2-11)
function abnToAcn(abn) {
  const clean = (abn || '').replace(/\s/g, '');
  return clean.length === 11 ? clean.slice(2) : clean;
}

function parseResults($) {
  const results = [];

  // Results render in an ASP.NET GridView table.
  // Row structure: [company name | notice type | published date] with a link on the name.
  $('table#ContentPlaceHolderDefault_INWMasterContentPlaceHolder_INWPageContentPlaceHolder_SearchNoticeList_3_gridViewNoticeList tbody tr, table.results-table tbody tr, table tbody tr').each((_, row) => {
    const $cells = $(row).find('td');
    if ($cells.length < 2) return;

    const texts = $cells.map((_, c) => $(c).text().trim()).get();
    const fullText = texts.join(' ');
    if (!isInsolvencyNotice(fullText)) return;

    const $link = $(row).find('a').first();
    const href = $link.attr('href') || '';
    const url = href.startsWith('http') ? href : href ? `${BASE}${href}` : SEARCH_URL;

    const entityName = texts[0] || '';
    const noticeType = texts.find((t) => isInsolvencyNotice(t)) || texts[1] || '';
    const date = texts.find((t) => /\d{1,2}[\s/.-]\w{3,}[\s/.-]\d{4}|\d{4}-\d{2}-\d{2}/.test(t)) || '';

    results.push({
      title: entityName ? `${entityName} — ${noticeType}` : noticeType,
      url,
      date,
      status: noticeType,
      description: `ASIC Published Notices — ${noticeType}`,
      metadata: {
        'Notice Type': noticeType,
        Entity: entityName,
        Date: date,
        Source: 'ASIC Published Notices',
      },
    });
  });

  return results;
}

async function searchAsicInsolvency(companyName, abn) {
  const acn = abnToAcn(abn);
  const searchTerm = acn || companyName || '';
  let results = [];

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 45_000 });

    // Wait for AWS WAF JS challenge to clear
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const title = await page.title();
      if (title && title !== 'Please Wait...' && title !== 'Just a moment...') break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // Set the ACN/company field and trigger ASP.NET postback search
    await page.evaluate((term) => {
      const inputs = Array.from(document.querySelectorAll('input[name*="CompanyNameOrACN"]'));
      inputs.forEach((i) => { i.value = term; });
    }, searchTerm);

    // Register navigation listener BEFORE triggering postback
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20_000 }).catch(() => {}),
      page.evaluate(() => {
        if (typeof __doPostBack === 'function') {
          // eslint-disable-next-line no-undef
          __doPostBack(
            'ctl00$ctl00$ctl00$ctl00$ContentPlaceHolderDefault$INWMasterContentPlaceHolder$INWPageContentPlaceHolder$SearchNoticeList_3$searchButton',
            ''
          );
        }
      }),
    ]);

    const html = await page.content();
    const $ = cheerio.load(html);
    results = parseResults($);
  } catch {
    // non-fatal
  } finally {
    await page.close().catch(() => {});
  }

  return {
    source: 'ASIC Published Notices',
    jurisdiction: 'Federal',
    category: 'financial',
    results,
    searchUrl: SEARCH_URL,
    summary:
      results.length > 0
        ? `${results.length} insolvency/winding-up notice(s) found`
        : 'No current insolvency or winding-up notices found (resolved/archived notices not included)',
  };
}

module.exports = { searchAsicInsolvency };
