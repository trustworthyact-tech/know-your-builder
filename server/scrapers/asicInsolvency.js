const cheerio = require('cheerio');
const { getBrowser } = require('./browser');

// Found 2026-10-06: the per-call .catch()/retry patches below (2026-09-15 postback,
// 2026-09-23 click/type) each fixed only the line that happened to throw — the root cause
// is that this site's AWS WAF serves a `202 x-amzn-waf-action: challenge` interstitial
// that reloads itself into the real page, and the "Load older data" postback can take
// 15s+ under load. networkidle2 can resolve on the interstitial, or the 25s nav wait can
// lapse, and the next read (page.$()/page.content()) then lands mid-navigation and throws
// "Execution context was destroyed". Reproduced locally under 6-8 concurrent pages:
// unpatched 7/12 OK per scraper, with this fix 11/12 (the remaining failure is an honest
// 30s "results never appeared" timeout, not a crash). Results-page marker below is present
// on both hit and miss result pages and absent from the WAF interstitial; waitForSelector
// keeps polling across navigations, so it rides out the self-reload.
const RESULTS_LIST_SEL = '[id$="ucNoticeResult_lvNoticeList"]';
async function retryOnNavRace(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === 2 || !/Execution context was destroyed/.test(err.message || '')) throw err;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
}
function settledContent(page) {
  return retryOnNavRace(async () => {
    await page.waitForSelector(RESULTS_LIST_SEL, { timeout: 30_000 });
    return page.content();
  });
}

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

    // Entity name is the first non-empty <p> in the block (the first <p> is always empty)
    const entityName = $b.find('p').toArray()
      .map((el) => $(el).text().trim())
      .find((t) => t.length > 0) || '';

    // ACN and status are in the <dl> beneath the entity name
    const dlFields = {};
    $b.find('dl dt').each((_, dt) => {
      const key = $(dt).text().trim().replace(/:$/, '');
      const val = $(dt).next('dd').text().trim();
      if (key && val) dlFields[key] = val;
    });

    const $link = $b.find('a[href*="notice-details"]').first();
    const href = $link.attr('href') || '';
    const url = href.startsWith('http') ? href : href ? `${BASE}${href}` : SEARCH_URL;

    if (!noticeType && !entityName) return;

    results.push({
      title: entityName ? `${entityName} — ${noticeType}` : noticeType,
      url,
      date,
      status: noticeType,
      description: entityName || 'ASIC Published Notices',
      metadata: {
        'Notice Type': noticeType,
        Entity: entityName,
        ACN: dlFields['ACN'] || '',
        Status: dlFields['Status'] || '',
        Date: date,
      },
    });
  });

  return results;
}

async function searchAsicInsolvency(companyName, abn, acn) {
  const derivedAcn = (acn || '').replace(/\s/g, '') || abnToAcn(abn);
  const searchTerm = derivedAcn || companyName || '';
  let results = [];

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 45_000 });

    // Wait for WAF/Cloudflare challenge to clear. A challenge page auto-redirecting
    // once solved can destroy the execution context mid-poll (same race as the
    // postback below) — treat that as "still transitioning, keep polling" rather than
    // letting it escape as an uncaught rejection.
    const wafDeadline = Date.now() + 15_000;
    while (Date.now() < wafDeadline) {
      const title = await page.title().catch(() => '');
      if (title && title !== 'Please Wait...' && title !== 'Just a moment...' && title !== '') break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // Type into the ACN/company field so ASP.NET registers the value properly
    const fieldId = '#ContentPlaceHolderDefault_INWMasterContentPlaceHolder_INWPageContentPlaceHolder_SearchNoticeList_3_txtCompanyNameOrACN';
    await page.waitForSelector(fieldId, { visible: true, timeout: 10_000 });
    await retryOnNavRace(async () => {
      await page.click(fieldId, { clickCount: 3 });
      await page.type(fieldId, searchTerm, { delay: 30 });
    });

    // __doPostBack causes a full page navigation (not UpdatePanel XHR) — wait for it.
    // Found 2026-09-15 (live, in production): page.evaluate() itself throws "Execution
    // context was destroyed, most likely because of a navigation" here — a standard
    // Puppeteer race where __doPostBack's synchronous form submission tears down the
    // page's JS context before evaluate()'s own promise resolves, even though the
    // navigation it triggers succeeds fine. waitForNavigation already .catch()es this
    // exact class of non-error; evaluate() didn't, so its rejection propagated up and
    // failed the whole search on every run. We only care that the postback fired, not
    // what evaluate() resolves to, so swallow it the same way.
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 25_000 }).catch(() => {}),
      page
        .evaluate(() => {
          // eslint-disable-next-line no-undef
          __doPostBack(
            'ctl00$ctl00$ctl00$ctl00$ContentPlaceHolderDefault$INWMasterContentPlaceHolder$INWPageContentPlaceHolder$SearchNoticeList_3$searchButton',
            ''
          );
        })
        .catch(() => {}),
    ]);

    // Results older than 6 months are archived — click "Load older data" if the banner appears
    const archivedBtnSel = '[id*="ucNoticeResult_btnLoadArchived"]';
    await settledContent(page);
    const hasArchivedBtn = await retryOnNavRace(() => page.$(archivedBtnSel));
    if (hasArchivedBtn) {
      // Same navigation-races-the-caller's-own-promise risk as the postback above —
      // page.click() also triggers this button's postback navigation directly.
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((e) => console.warn('[asicInsolvency] "Load older data" navigation wait:', e.message)),
        page.click(archivedBtnSel).catch(() => {}),
      ]);
    }

    const html = await settledContent(page);
    const $ = cheerio.load(html);
    results = parseResults($);
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
