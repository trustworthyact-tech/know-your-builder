const cheerio = require('cheerio');
const { getBrowser } = require('./browser');

// insolvencynotices.asic.gov.au was merged into publishednotices.asic.gov.au.
// ATO listed tax debt notices (Tax Administration Act s260-45) appear here.
const BASE = 'https://publishednotices.asic.gov.au';
const SEARCH_URL = `${BASE}/browsesearch-notices`;

const ATO_KEYWORDS = [
  'ato',
  'tax debt',
  'listed tax debt',
  '260-45',
  'tax administration act',
  'australian taxation office',
];

function isAtoDebtNotice(text) {
  const lower = (text || '').toLowerCase();
  // Word-boundary check for 'ato' to avoid false-matching 'administrator', 'regulatory', etc.
  return /\bato\b/.test(lower) ||
    ATO_KEYWORDS.slice(1).some((k) => lower.includes(k));
}

// ACN = last 9 digits of ABN (strip spaces, take chars 2-11)
function abnToAcn(abn) {
  const clean = (abn || '').replace(/\s/g, '');
  return clean.length === 11 ? clean.slice(2) : clean;
}

function parseResults($, searchUrl) {
  const results = [];

  $('div.article-block').each((_, block) => {
    const $b = $(block);
    const fullText = $b.text();

    if (!isAtoDebtNotice(fullText)) return;

    const noticeType = $b.find('h3').text().replace(/\s+/g, ' ').trim();
    const date = $b.find('.published-date').text().replace('Published:', '').trim();

    const entityName = $b.find('p').toArray()
      .map((el) => $(el).text().trim())
      .find((t) => t.length > 0) || '';

    const dlFields = {};
    $b.find('dl dt').each((_, dt) => {
      const key = $(dt).text().trim().replace(/:$/, '');
      const val = $(dt).next('dd').text().trim();
      if (key && val) dlFields[key] = val;
    });

    const $link = $b.find('a[href*="notice-details"]').first();
    const href = $link.attr('href') || '';
    const url = href.startsWith('http') ? href : href ? `${BASE}${href}` : searchUrl;

    results.push({
      title: entityName ? `${entityName} — ${noticeType}` : noticeType,
      url,
      date,
      status: 'ATO Tax Debt Disclosed',
      description: `ATO tax debt notice published by ASIC under Tax Administration Act s260-45`,
      metadata: {
        'Notice Type': noticeType,
        Entity: entityName,
        ACN: dlFields['ACN'] || '',
        Date: date,
      },
    });
  });

  return results;
}

async function searchAtoDebt(companyName, abn, acn) {
  const derivedAcn = (acn || '').replace(/\s/g, '') || abnToAcn(abn);
  const searchTerm = derivedAcn || companyName || '';
  let results = [];

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 45_000 });

    const wafDeadline = Date.now() + 15_000;
    while (Date.now() < wafDeadline) {
      const title = await page.title();
      if (title && title !== 'Please Wait...' && title !== 'Just a moment...' && title !== '') break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    const fieldId = '#ContentPlaceHolderDefault_INWMasterContentPlaceHolder_INWPageContentPlaceHolder_SearchNoticeList_3_txtCompanyNameOrACN';
    await page.click(fieldId, { clickCount: 3 });
    await page.type(fieldId, searchTerm, { delay: 30 });

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
    results = parseResults($, SEARCH_URL);
  } catch {
    // non-fatal — return empty results
  } finally {
    await page.close().catch(() => {});
  }

  return {
    source: 'ASIC Published Notices — ATO Tax Debt',
    jurisdiction: 'Federal',
    category: 'financial',
    results,
    searchUrl: SEARCH_URL,
    summary:
      results.length > 0
        ? `${results.length} ATO tax debt disclosure(s) found — entity has a listed tax debt published by ASIC`
        : 'No ATO tax debt notices found in ASIC Published Notices',
  };
}

module.exports = { searchAtoDebt };
