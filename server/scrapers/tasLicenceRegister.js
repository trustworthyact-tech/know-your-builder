const axios = require('axios');
const cheerio = require('cheerio');
const { getBrowser } = require('./browser');

// TAS Occupational Licensing — Building Services Provider register.
// URL: https://occupationallicensing.justice.tas.gov.au/Search/OnlineSearch.aspx
//
// The site is an ASP.NET WebForms app with UpdatePanels. Selecting a Licence Area
// and Licence Type triggers JavaScript __doPostBack calls that require the ASP.NET
// AJAX PageRequestManager to be active. Plain HTTP POST-chains fail with a redirect
// to /Unavailable.aspx after 2 hops. Puppeteer is required.
//
// Flow:
//   1. GET the search page
//   2. Click "Building Services Provider" radio (value=14)
//   3. Click "Company" radio (value=47) — name search field + reCAPTCHA appear
//   4. Solve reCAPTCHA via 2captcha (inline helper, does NOT import captcha.js)
//   5. Fill the name search field and submit
//   6. Parse the GridView results table
//   7. Repeat step 5–6 for "Individual" (value=40) to catch individual licensees
//
// Building-relevant category: Building Services Provider (only category we search).

const SEARCH_URL = 'https://occupationallicensing.justice.tas.gov.au/Search/OnlineSearch.aspx';
const BASE_URL = 'https://occupationallicensing.justice.tas.gov.au';

// Known sitekey for the TAS Occupational Licensing portal
// (rendered via JS pageLoad() function — same key used on ApplicationStart.aspx)
const TAS_SITE_KEY = '6LfXOWUUAAAAAMFRq3rPzSX2piSfoeyA6d3lt47c';

// ─── Inline 2captcha helper (does NOT depend on captcha.js) ──────────────────
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 120_000;

async function solveCaptchaForPage(pageUrl, siteKey, apiKey) {
  const submitUrl =
    `https://2captcha.com/in.php` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&method=userrecaptcha` +
    `&googlekey=${encodeURIComponent(siteKey)}` +
    `&pageurl=${encodeURIComponent(pageUrl)}` +
    `&invisible=0` +
    `&json=1`;

  const { data: submitData } = await axios.get(submitUrl, { timeout: 30_000 });
  if (!submitData || submitData.status !== 1) {
    throw new Error(`2captcha submission failed: ${submitData?.request ?? 'unknown'}`);
  }

  const taskId = submitData.request;
  const pollUrl =
    `https://2captcha.com/res.php` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&action=get` +
    `&id=${encodeURIComponent(taskId)}` +
    `&json=1`;

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const { data: pollData } = await axios.get(pollUrl, { timeout: 15_000 });
    if (pollData?.status === 1) return pollData.request;
    if (pollData?.request !== 'CAPCHA_NOT_READY') {
      throw new Error(`2captcha poll error: ${pollData?.request ?? 'unknown'}`);
    }
  }
  throw new Error('2captcha timeout');
}

// ─── Entity name guard ────────────────────────────────────────────────────────
function nameMatchesEntity(text, query) {
  if (!query) return false;
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((w) => lower.includes(w));
}

// ─── Results parser ───────────────────────────────────────────────────────────
// The TAS register renders results as an ASP.NET GridView table.
// Typical column order: Licence Number, Name, Licence Type, Status, Expiry Date.
// We detect column positions dynamically from the header row.
function parseResultsHtml(html, query) {
  const $ = cheerio.load(html);
  const items = [];

  // GridView tables have class="GridView" or id containing "GridView"
  const tables = $('table').filter((_, el) => {
    const id = $(el).attr('id') || '';
    const cls = $(el).attr('class') || '';
    return /gridview/i.test(id) || /gridview/i.test(cls) || $(el).find('th').length > 0;
  });

  tables.each((_, table) => {
    const headers = [];
    $(table)
      .find('tr:first-child th, thead tr th')
      .each((_, th) => {
        headers.push($(th).text().trim().toLowerCase());
      });

    // Fallback: check first row for <td> headings if no <th>
    if (headers.length === 0) {
      $(table)
        .find('tr:first-child td')
        .each((_, td) => {
          headers.push($(td).text().trim().toLowerCase());
        });
    }

    // Map column indices from header text
    const colIdx = {
      licenceNumber: headers.findIndex((h) => /licence.*no|lic.*num|number/i.test(h)),
      name: headers.findIndex((h) => /name|licensee|holder/i.test(h)),
      licenceType: headers.findIndex((h) => /type|class|category/i.test(h)),
      status: headers.findIndex((h) => /status/i.test(h)),
      expiry: headers.findIndex((h) => /expir|valid|date/i.test(h)),
    };

    // Process data rows (skip the header row)
    $(table)
      .find('tr')
      .each((rowIdx, row) => {
        if (rowIdx === 0 && headers.length > 0) return; // skip header
        const $cells = $(row).find('td');
        if ($cells.length < 2) return;

        const cell = (idx) => (idx >= 0 ? $($cells[idx]).text().trim() : '');

        // Try to extract values using discovered columns, with fallback positional guesses
        const licenceNumber =
          cell(colIdx.licenceNumber) ||
          $cells
            .map((_, td) => $(td).text().trim())
            .get()
            .find((t) => /^[A-Z]{0,4}\d{3,}/i.test(t)) ||
          '';

        const name =
          cell(colIdx.name) ||
          cell(0) ||
          '';

        const licenceType = cell(colIdx.licenceType) || 'Building Services Provider';
        const status = cell(colIdx.status) || '';
        const expiry = cell(colIdx.expiry) || '';

        if (!name) return;

        // Detail URL — look for an anchor in the name cell or licence number cell
        let detailUrl = SEARCH_URL;
        $($cells[colIdx.name >= 0 ? colIdx.name : 0])
          .find('a')
          .each((_, a) => {
            const href = $(a).attr('href');
            if (href) {
              detailUrl = href.startsWith('http')
                ? href
                : `${BASE_URL}${href.startsWith('/') ? '' : '/Search/'}${href}`;
            }
          });

        items.push({ name, licenceNumber, licenceType, status, expiry, detailUrl });
      });
  });

  // If no GridView found, try any table with enough columns
  if (items.length === 0) {
    $('table tr').each((rowIdx, row) => {
      const $cells = $(row).find('td');
      if ($cells.length < 3) return;
      const cells = $cells.map((_, td) => $(td).text().trim()).get();
      const fullText = cells.join(' ');
      if (!nameMatchesEntity(fullText, query)) return;

      const licNumMatch = fullText.match(/\b([A-Z]{0,4}\d{4,10})\b/);
      const statusMatch = fullText.match(/\b(active|current|expired|cancelled|suspended|invalid)\b/i);
      const dateMatch = fullText.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/);

      items.push({
        name: cells[0] || query,
        licenceNumber: licNumMatch ? licNumMatch[1] : '',
        licenceType: 'Building Services Provider',
        status: statusMatch ? statusMatch[1] : '',
        expiry: dateMatch ? dateMatch[0] : '',
        detailUrl: SEARCH_URL,
      });
    });
  }

  return items;
}

// ─── Puppeteer search for one query + licence category ────────────────────────
// licenceTypeValue: '47' = Company, '40' = Individual
// Discovered field IDs (verified via Puppeteer inspection):
//   Business name: txtBusinessNameSearch
//   Surname (individual): txtSurnameSearch
//   Submit: btnFilterMainGrid
// CAPTCHA appears only AFTER clicking the Company/Individual radio.
async function runSearch(page, query, licenceTypeValue, captchaApiKey) {
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 1_000));

  // ── Step 1: Building Services Provider (value=14) ────────────────────────
  await page.waitForSelector('input[type="radio"][value="14"]', { timeout: 10_000 });
  await page.click('input[type="radio"][value="14"]');
  await new Promise((r) => setTimeout(r, 2_000));

  // ── Step 2: Company (47) or Individual (40) ──────────────────────────────
  const licTypeSelector = `input[type="radio"][value="${licenceTypeValue}"]`;
  await page.waitForSelector(licTypeSelector, { timeout: 10_000 });
  await page.click(licTypeSelector);

  // CAPTCHA now appears — wait for it to render
  await new Promise((r) => setTimeout(r, 2_000));
  await page.waitForNetworkIdle({ timeout: 15_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1_000));

  // ── Step 3: Solve reCAPTCHA (appears after category click) ───────────────
  let siteKey = TAS_SITE_KEY;
  try {
    const renderedKey = await page.evaluate(() => {
      const el = document.querySelector('[data-sitekey]');
      return el ? el.getAttribute('data-sitekey') : null;
    });
    if (renderedKey) siteKey = renderedKey;
  } catch { /* use hardcoded key */ }

  const token = await solveCaptchaForPage(SEARCH_URL, siteKey, captchaApiKey);

  await page.evaluate((t) => {
    const ta = document.getElementById('g-recaptcha-response');
    if (ta) ta.value = t;
    const ta2 = document.querySelector('textarea[name="g-recaptcha-response"]');
    if (ta2) ta2.value = t;
  }, token);

  // ── Step 4: Fill the correct name field (re-queried after CAPTCHA solve) ──
  // Company (47): use txtBusinessNameSearch
  // Individual (40): use txtSurnameSearch
  const nameInputId = licenceTypeValue === '47'
    ? 'ctl00_ctl00_ctl00_ctlMainContent_ctlMainContent_MainContent_ctlOnlineSearch_txtBusinessNameSearch'
    : 'ctl00_ctl00_ctl00_ctlMainContent_ctlMainContent_MainContent_ctlOnlineSearch_txtSurnameSearch';

  const nameInput = await page.$('#' + nameInputId);
  if (!nameInput) {
    console.warn('[tasLicenceRegister] Name input not found:', nameInputId);
    return [];
  }
  await nameInput.click({ clickCount: 3 });
  await nameInput.type(query, { delay: 50 });

  // ── Step 5: Submit ────────────────────────────────────────────────────────
  const submitId = 'ctl00_ctl00_ctl00_ctlMainContent_ctlMainContent_MainContent_ctlOnlineSearch_btnFilterMainGrid';
  const submitBtn = await page.$('#' + submitId);
  if (submitBtn) {
    await submitBtn.click();
  } else {
    await nameInput.press('Enter');
  }

  await new Promise((r) => setTimeout(r, 2_000));
  await page.waitForNetworkIdle({ timeout: 15_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1_500));

  const html = await page.content();
  return parseResultsHtml(html, query);
}

// ─── Main exported function ───────────────────────────────────────────────────
async function searchTASLicenceRegister(companyName, abn, directors, captchaApiKey) {
  const BASE_RESULT = {
    source: 'TAS Occupational Licensing — Licence Register',
    jurisdiction: 'TAS',
    category: 'license',
    results: [],
    searchUrl: SEARCH_URL,
    summary: '',
  };

  if (!captchaApiKey) {
    return {
      ...BASE_RESULT,
      summary: 'TAS licence search unavailable: CAPTCHA_API_KEY not set',
    };
  }

  const allResults = [];
  const seen = new Set(); // deduplicate by licence number

  // Stripped company name (remove "Pty Ltd" suffix)
  const strippedName = companyName.replace(/\s*pty\s*ltd\.?\s*$/i, '').trim();

  // Queries: company name + each director
  const queries = [strippedName, ...(directors || []).filter(Boolean)];

  // Licence types to search: Company (47) and Individual (40)
  // We search each query under Company first; director names also under Individual.
  // Build a list of (query, licenceTypeValue) pairs.
  const searchPairs = [];
  for (const q of queries) {
    if (!q) continue;
    if (q === strippedName) {
      // Company name — search as Company licence type
      searchPairs.push({ query: q, licenceTypeValue: '47' });
    } else {
      // Director name — search as Individual licence type
      searchPairs.push({ query: q, licenceTypeValue: '40' });
    }
  }

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );

    for (const { query, licenceTypeValue } of searchPairs) {
      try {
        const hits = await runSearch(page, query, licenceTypeValue, captchaApiKey);

        for (const hit of hits) {
          // Apply name guard
          if (!nameMatchesEntity(hit.name, query)) continue;

          // Deduplicate by licence number, or by name+type if no number
          const key = hit.licenceNumber || `${hit.name}|${hit.licenceType}`;
          if (seen.has(key)) continue;
          seen.add(key);

          allResults.push({
            title: hit.name,
            url: hit.detailUrl || SEARCH_URL,
            date: hit.expiry || '',
            status: hit.status || '',
            description: `${hit.licenceType || 'Building Services Provider'} — Licence ${hit.licenceNumber || 'N/A'}`,
            jurisdiction: 'TAS',
            metadata: {
              Source: 'TAS Occupational Licensing',
              LicenceNumber: hit.licenceNumber,
              LicenceType: hit.licenceType,
              Status: hit.status,
              Expiry: hit.expiry,
            },
          });
        }
      } catch (err) {
        console.warn(
          `[tasLicenceRegister] search failed for "${query}" (type ${licenceTypeValue}):`,
          err.message
        );
        // non-fatal — continue with remaining queries
      }
    }
  } catch (err) {
    console.warn('[tasLicenceRegister] browser error:', err.message);
    return {
      ...BASE_RESULT,
      summary: 'TAS licence search failed — site may be temporarily unavailable',
    };
  } finally {
    await page.close().catch(() => {});
  }

  return {
    ...BASE_RESULT,
    results: allResults,
    summary:
      allResults.length > 0
        ? `${allResults.length} TAS building licence record(s) found`
        : 'No TAS building licence records found',
  };
}

module.exports = { searchTASLicenceRegister };
