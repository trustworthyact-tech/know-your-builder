const cheerio = require('cheerio');
const { getBrowser } = require('./browser');
const { solveCaptcha } = require('./captcha');

// SA Consumer & Business Services — Occupational Licence Public Register.
// The site requires a reCAPTCHA v2 (standard visible checkbox) gate before
// showing the Vue SPA search form. We use Puppeteer to:
//   1. Navigate to the gate page
//   2. Solve the CAPTCHA via 2captcha (visible v2 — invisible=0 not needed since
//      2captcha handles both; the key difference is no &invisible=1 in submit URL)
//   3. Inject the token into the hidden textarea and trigger the form callback
//   4. Wait for the SPA to load and interact with the search form
//   5. Parse results from the rendered DOM
//
// Building-relevant licence types: Building Work Contractor, Building Work Supervisor

const REGISTER_URL = 'https://secure.cbs.sa.gov.au/OccLicPubReg/';
const SA_SITE_KEY = '6LeEr5ksAAAAABaJwLcxw3ongWxfDq9gzoKk3OXr';

// Significant-word match: every word of the query that is >3 chars and not a
// stopword must appear in the result text. Prevents false positives.
function nameMatchesEntity(text, query) {
  if (!query) return false;
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((w) => lower.includes(w));
}

// Pass the reCAPTCHA gate via Puppeteer + 2captcha, then return the Page object
// still open on the post-gate SPA (caller must close it).
async function passGateAndGetPage(captchaApiKey) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
  // networkidle2 is too aggressive here — the reCAPTCHA script is async/defer,
  // so domcontentloaded is sufficient for the gate page.
  await page.goto(REGISTER_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 2_000));

  // Solve the reCAPTCHA v2 via 2captcha (normal checkbox, not invisible).
  // solveCaptcha with SA_SITE_KEY — 2captcha treats both invisible=0 and invisible=1
  // the same way for v2 tokens; the important thing is the correct sitekey.
  const token = await solveCaptcha(REGISTER_URL, captchaApiKey, undefined, SA_SITE_KEY, false);

  // Inject the token and trigger the callback that submits the gate form.
  await page.evaluate((t) => {
    // The reCAPTCHA hidden textarea that holds the response token.
    const ta = document.getElementById('g-recaptcha-response');
    if (ta) ta.value = t;

    // The render_recaptcha callback submits the form via function() { document.forms["g-form"].submit(); }
    // We replicate this directly.
    const form = document.getElementById('g-form');
    if (form) {
      // Also populate the textarea that PHP reads.
      const input = form.querySelector('[name="g-recaptcha-response"]') ||
                    document.createElement('input');
      input.type = 'hidden';
      input.name = 'g-recaptcha-response';
      input.value = t;
      form.appendChild(input);
      form.submit();
    }
  }, token);

  // Wait for navigation to complete after the form submission.
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 2_000));

  return page;
}

// Parse a Vue-rendered results table or list from the search results page.
// The structure depends on what the SPA renders — we try common patterns.
function parseResults(html, query, searchUrl) {
  const $ = cheerio.load(html);
  const matches = [];
  const seen = new Set();

  // The Vue SPA typically renders results in a <table> or list of <div> cards.
  // Try table rows first.
  $('table tbody tr, table tr').each((_, row) => {
    const $cells = $(row).find('td');
    if ($cells.length < 2) return;

    const cells = $cells.map((_, td) => $(td).text().trim()).get();

    // Heuristic: find the cell that looks like a licensee name (longest text
    // that matches our query words), a licence number (matches BS/BW/CC pattern),
    // and a status cell (Active/Cancelled/Expired).
    const fullText = cells.join(' ');
    if (!nameMatchesEntity(fullText, query)) return;

    // Extract licence number — SA format: BS#####, BW#####, CC#####, or numeric
    const licNumMatch = fullText.match(/\b([A-Z]{1,3}\s*\d{4,8}|\d{5,10})\b/);
    const licenceNumber = licNumMatch ? licNumMatch[1].replace(/\s+/g, '') : '';

    // Deduplicate by licence number, or by full row text if no number found
    const key = licenceNumber || fullText.slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);

    // Find name cell: longest cell text or first cell that matches the query
    let licenseeName = '';
    let licenceType = '';
    let status = '';
    let expiry = '';

    for (const cell of cells) {
      if (!licenseeName && nameMatchesEntity(cell, query)) licenseeName = cell;
      if (!status && /^(active|expired|cancelled|suspended|current)/i.test(cell)) status = cell;
      if (!expiry && /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(cell)) expiry = cell;
      if (!licenceType && /(contractor|supervisor|building work|plumb|electric)/i.test(cell)) {
        licenceType = cell;
      }
    }

    // Fallback: use first cell as name if still empty
    if (!licenseeName) licenseeName = cells[0] || query;

    matches.push({
      title: licenseeName,
      url: searchUrl,
      date: expiry,
      status: status || 'Unknown',
      description: `${licenceType || 'SA Licence'} — Licence ${licenceNumber || 'N/A'}`,
      jurisdiction: 'SA',
      metadata: {
        Source: 'SA Consumer & Business Services',
        LicenceNumber: licenceNumber,
        LicenceType: licenceType,
        Status: status,
        Expiry: expiry,
      },
    });
  });

  // If no table rows matched, try card/div-based layout
  if (matches.length === 0) {
    // Look for repeated <div> blocks that contain licence info
    $('[class*="card"], [class*="result"], [class*="licence"], [class*="license"]').each((_, el) => {
      const text = $(el).text().trim();
      if (!nameMatchesEntity(text, query)) return;

      const licNumMatch = text.match(/\b([A-Z]{1,3}\s*\d{4,8}|\d{5,10})\b/);
      const licenceNumber = licNumMatch ? licNumMatch[1].replace(/\s+/g, '') : '';
      const key = licenceNumber || text.slice(0, 80);
      if (seen.has(key)) return;
      seen.add(key);

      const statusMatch = text.match(/\b(Active|Expired|Cancelled|Suspended|Current)\b/i);
      const expiryMatch = text.match(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/);
      const typeMatch = text.match(/(Building Work Contractor|Building Work Supervisor|[A-Za-z\s]+ Licence)/i);

      matches.push({
        title: query,
        url: searchUrl,
        date: expiryMatch ? expiryMatch[0] : '',
        status: statusMatch ? statusMatch[1] : 'Unknown',
        description: `${typeMatch ? typeMatch[1] : 'SA Licence'} — Licence ${licenceNumber || 'N/A'}`,
        jurisdiction: 'SA',
        metadata: {
          Source: 'SA Consumer & Business Services',
          LicenceNumber: licenceNumber,
          LicenceType: typeMatch ? typeMatch[1] : '',
          Status: statusMatch ? statusMatch[1] : '',
          Expiry: expiryMatch ? expiryMatch[0] : '',
        },
      });
    });
  }

  return matches;
}

// Perform a single search query on the post-gate SPA.
// page must already be on the search SPA (past the CAPTCHA gate).
async function performSearch(page, query) {
  const pageUrl = page.url();

  // The Vue SPA has a search input. Try common selectors.
  const inputSelectors = [
    'input[type="text"]',
    'input[placeholder*="name" i]',
    'input[placeholder*="search" i]',
    'input[id*="search" i]',
    'input[id*="name" i]',
    '#searchName',
    '[name="searchName"]',
  ];

  let inputFound = false;
  for (const sel of inputSelectors) {
    const el = await page.$(sel);
    if (el) {
      await page.evaluate((s) => {
        const input = document.querySelector(s);
        if (input) input.value = '';
      }, sel);
      await page.click(sel, { clickCount: 3 });
      await page.type(sel, query, { delay: 60 });
      inputFound = true;
      break;
    }
  }

  if (!inputFound) {
    console.warn('[saLicenceRegister] No search input found on page');
    return [];
  }

  // Look for a search/submit button — use evaluate to avoid jQuery-only :contains()
  const clicked = await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll('button[type="submit"]'),
      ...document.querySelectorAll('input[type="submit"]'),
      ...document.querySelectorAll('button'),
    ];
    for (const el of candidates) {
      const txt = (el.textContent || el.value || '').trim().toLowerCase();
      if (txt.includes('search') || txt.includes('submit') || txt.includes('find')) {
        el.click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) {
    await page.keyboard.press('Enter');
  }

  // Wait for the Vue SPA to fetch and render results
  await new Promise((r) => setTimeout(r, 3_000));
  await page.waitForNetworkIdle({ timeout: 10_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1_500));

  const html = await page.content();
  return parseResults(html, query, pageUrl);
}

async function searchSALicenceRegister(companyName, abn, directors, captchaApiKey) {
  const BASE_RESULT = {
    source: 'SA Consumer & Business Services — Licence Register',
    jurisdiction: 'SA',
    category: 'license',
    results: [],
    searchUrl: REGISTER_URL,
    summary: '',
  };

  if (!captchaApiKey) {
    return {
      ...BASE_RESULT,
      summary: 'SA licence search unavailable: CAPTCHA_API_KEY not set',
    };
  }

  const allResults = [];
  const seen = new Set();
  let page = null;

  try {
    page = await passGateAndGetPage(captchaApiKey);

    // Build list of queries: stripped company name + each director
    const strippedName = companyName.replace(/\s*pty\s*ltd\.?\s*$/i, '').trim();
    const queries = [strippedName, ...(directors || []).filter(Boolean)];

    for (const query of queries) {
      if (!query) continue;
      try {
        const hits = await performSearch(page, query);
        for (const hit of hits) {
          const key = hit.metadata.LicenceNumber || `${hit.title}|${hit.date}`;
          if (seen.has(key)) continue;
          seen.add(key);
          allResults.push(hit);
        }

        // Navigate back to search form for subsequent queries (SPA may need reset)
        if (queries.indexOf(query) < queries.length - 1) {
          // Clear the search field or navigate back to SPA root
          const currentUrl = page.url();
          if (currentUrl !== REGISTER_URL) {
            // If the SPA navigated away, go back
            await page.goBack({ waitUntil: 'networkidle2', timeout: 15_000 }).catch(async () => {
              // If goBack fails, stay on current page and try clearing the input
            });
            await new Promise((r) => setTimeout(r, 1_500));
          }
        }
      } catch (err) {
        console.warn(`[saLicenceRegister] search failed for "${query}":`, err.message);
        // non-fatal — continue with other queries
      }
    }
  } catch (err) {
    console.warn('[saLicenceRegister] gate/search error:', err.message);
    return {
      ...BASE_RESULT,
      summary: 'SA licence search failed — site may be temporarily unavailable',
    };
  } finally {
    if (page) await page.close().catch(() => {});
  }

  return {
    ...BASE_RESULT,
    results: allResults,
    summary:
      allResults.length > 0
        ? `${allResults.length} SA licence record(s) found`
        : 'No SA licence records found',
  };
}

module.exports = { searchSALicenceRegister };
