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
  'winding-up order',
  'order to wind',
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

  // Results render as article-block divs inside the NoticeTable
  $('div.article-block').each((_, block) => {
    const $b = $(block);
    const noticeType = $b.find('h3').text().replace(/\s+/g, ' ').trim();
    const date = $b.find('.published-date').text().replace('Published:', '').trim();
    const entityName = $b.find('p').first().text().trim();

    const $link = $b.closest('tr').find('a[href*="notice-details"]').first()
      || $b.find('a[href*="notice-details"]').first();
    const href = $link.attr('href') || '';
    const url = href.startsWith('http') ? href : href ? `${BASE}${href}` : SEARCH_URL;

    if (!noticeType && !entityName) return;

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

    // Wait for WAF/Cloudflare challenge to clear
    const wafDeadline = Date.now() + 15_000;
    while (Date.now() < wafDeadline) {
      const title = await page.title();
      if (title && title !== 'Please Wait...' && title !== 'Just a moment...' && title !== '') break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // Type into the ACN/company field so ASP.NET registers the value properly
    const fieldId = '#ContentPlaceHolderDefault_INWMasterContentPlaceHolder_INWPageContentPlaceHolder_SearchNoticeList_3_txtCompanyNameOrACN';
    await page.click(fieldId, { clickCount: 3 });
    await page.type(fieldId, searchTerm, { delay: 30 });

    // __doPostBack causes a full page navigation (not UpdatePanel XHR) — wait for it
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25_000 }).catch(() => {}),
      page.evaluate(() => {
        // eslint-disable-next-line no-undef
        __doPostBack(
          'ctl00$ctl00$ctl00$ctl00$ContentPlaceHolderDefault$INWMasterContentPlaceHolder$INWPageContentPlaceHolder$SearchNoticeList_3$searchButton',
          ''
        );
      }),
    ]);

    // Results older than 6 months are archived — click "Load older data" if the banner appears
    const archivedBtnSel = '[id*="ucNoticeResult_btnLoadArchived"]';
    const hasArchivedBtn = await page.$(archivedBtnSel);
    if (hasArchivedBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25_000 }).catch(() => {}),
        page.click(archivedBtnSel),
      ]);
    }

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
