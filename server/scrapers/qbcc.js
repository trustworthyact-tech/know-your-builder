const axios = require('axios');
const cheerio = require('cheerio');
const { getBrowser } = require('./browser');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/html',
  Referer: 'https://www.qbcc.qld.gov.au/',
};

const EXCLUDED_REGISTER_URL = 'https://my.qbcc.qld.gov.au/myQBCC/s/excluded-individual-register';

// Splits a director name into { firstName, lastName }.
// Handles ASIC SURNAME-first format (e.g. "SMITH John") and normal order.
// ASIC format: first token is all-caps AND at least one later token is mixed-case.
// If all tokens are all-caps (e.g. "CASCINDRA KAY SMITH"), treat as normal order.
function splitDirectorName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  const firstIsAllCaps = /^[A-Z]{2,}$/.test(parts[0]);
  const restHasMixedCase = parts.slice(1).some((p) => /[a-z]/.test(p));
  if (firstIsAllCaps && restHasMixedCase) {
    // ASIC surname-first: "SMITH John" → { firstName: 'John', lastName: 'SMITH' }
    return { firstName: parts.slice(1).join(' '), lastName: parts[0] };
  }
  // Normal order: "CASCINDRA KAY SMITH" or "John Smith" → last token is surname
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

// Parses the innerText of div.slds-grid.results into individual records.
// Each record starts with a name heading followed by "Individual Info".
function parseExcludedResults(text) {
  if (!text) return [];
  const results = [];

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && l !== 'Expand or Collapse Section');

  let i = 0;
  while (i < lines.length) {
    if (i + 1 < lines.length && lines[i + 1] === 'Individual Info') {
      const name = lines[i];
      const recordLines = [name];
      i += 2;
      while (i < lines.length && !(i + 1 < lines.length && lines[i + 1] === 'Individual Info')) {
        recordLines.push(lines[i]);
        i++;
      }

      const fieldValue = (label) => {
        const idx = recordLines.indexOf(label);
        if (idx === -1) return '';
        return recordLines.slice(idx + 1).find((l) => l) || '';
      };

      const startDate = fieldValue('Start Date:');
      const endDate = fieldValue('End Date:');

      const eventIdx = recordLines.indexOf('Relevant Event:');
      const relevantEvent = eventIdx !== -1
        ? recordLines.slice(eventIdx + 1).filter((l) => l !== 'show more').join(' ').slice(0, 400)
        : '';

      const otherNames = fieldValue('Other Known Name(s):');

      results.push({
        title: name,
        url: EXCLUDED_REGISTER_URL,
        date: startDate,
        status: endDate ? `Excluded until ${endDate}` : 'Excluded',
        description: relevantEvent.slice(0, 300) || 'QBCC excluded individual',
        jurisdiction: 'QLD',
        metadata: {
          'Full Name': name,
          'Other Known Names': otherNames,
          'Start Date': startDate,
          'End Date': endDate,
          'Relevant Event': relevantEvent.slice(0, 200),
          Source: 'QBCC Excluded Individual Register',
        },
      });
    } else {
      i++;
    }
  }

  return results;
}

// Searches the QBCC Excluded Individual Register via Puppeteer (Salesforce SPA).
async function searchQBCCExcluded(directorNames) {
  if (!directorNames || directorNames.length === 0) return [];

  const allResults = [];
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(EXCLUDED_REGISTER_URL, { waitUntil: 'networkidle2', timeout: 45000 });
    // Wait for Salesforce LWC to hydrate
    await new Promise((r) => setTimeout(r, 6000));

    // Pierces all shadow roots to find an element matching selector and returns its centre coords.
    async function pierceCoords(selector) {
      return page.evaluate((sel) => {
        function pq(root) {
          const f = root.querySelector(sel);
          if (f) return f;
          for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) { const r = pq(el.shadowRoot); if (r) return r; }
          }
          return null;
        }
        const el = pq(document);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, selector);
    }

    async function pierceClick(selector) {
      const coords = await pierceCoords(selector);
      if (coords) await page.mouse.click(coords.x, coords.y);
      return !!coords;
    }

    async function pierceClear(selector) {
      await page.evaluate((sel) => {
        function pq(root) {
          const f = root.querySelector(sel); if (f) return f;
          for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const r = pq(el.shadowRoot); if (r) return r; } }
          return null;
        }
        const el = pq(document);
        if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
      }, selector);
    }

    async function getResultsText() {
      return page.evaluate(() => {
        function pq(root, sel) {
          const f = root.querySelector(sel); if (f) return f;
          for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { const r = pq(el.shadowRoot, sel); if (r) return r; } }
          return null;
        }
        const grid = pq(document, 'div.slds-grid.results');
        return grid ? (grid.innerText || '') : '';
      });
    }

    for (const directorName of directorNames.slice(0, 5)) {
      if (!directorName) continue;
      const { firstName, lastName } = splitDirectorName(directorName);
      if (!lastName) continue;

      try {
        // Open the search type combobox
        await pierceClick('button[class*="slds-combobox__input"]');
        await new Promise((r) => setTimeout(r, 1000));

        // Select "Individual's Name"
        await pierceClick('[data-value="INDIVIDUAL_NAME"]');
        await new Promise((r) => setTimeout(r, 1500));

        // Clear and fill first name
        await pierceClear('input[placeholder="Type first name here"]');
        const fnCoords = await pierceCoords('input[placeholder="Type first name here"]');
        if (fnCoords) {
          await page.mouse.click(fnCoords.x, fnCoords.y);
          await page.keyboard.down('Control');
          await page.keyboard.press('a');
          await page.keyboard.up('Control');
          await page.keyboard.type(firstName, { delay: 50 });
        }

        // Clear and fill last name
        await pierceClear('input[placeholder="Type last name here"]');
        const lnCoords = await pierceCoords('input[placeholder="Type last name here"]');
        if (lnCoords) {
          await page.mouse.click(lnCoords.x, lnCoords.y);
          await page.keyboard.down('Control');
          await page.keyboard.press('a');
          await page.keyboard.up('Control');
          await page.keyboard.type(lastName, { delay: 50 });
        }

        // Submit
        await pierceClick('button[type="submit"]');
        await page.waitForNetworkIdle({ timeout: 15000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 3000));

        const text = await getResultsText();
        const records = parseExcludedResults(text);
        allResults.push(...records);
      } catch {
        // non-fatal — skip this director
      }
    }
  } catch {
    // non-fatal
  } finally {
    await page.close().catch(() => {});
  }

  // Deduplicate by name
  const seen = new Set();
  return allResults.filter((r) => {
    if (seen.has(r.title)) return false;
    seen.add(r.title);
    return true;
  });
}

async function searchQBCC(companyName, abn, directors) {
  const results = [];

  // QBCC public contractor search
  try {
    const searchUrl = `https://www.qbcc.qld.gov.au/api/licensee-search?name=${encodeURIComponent(companyName)}&licenceNumber=&suburb=&licenceType=&licenceStatus=Active`;
    const { data } = await axios.get(searchUrl, { headers: HEADERS, timeout: 15000 });

    const items = Array.isArray(data) ? data : data?.results || data?.data || [];
    for (const item of items) {
      const licencee = item.licenceeName || item.name || item.companyName || '';
      const licenceNo = item.licenceNumber || item.licenceNo || '';
      const licenceClass = item.licenceClass || item.licenceType || item.category || '';
      const status = item.licenceStatus || item.status || '';
      const expiry = item.expiryDate || item.licenceExpiry || '';
      const financialCategory = item.financialCategory || item.financialLimit || '';

      results.push({
        title: licencee || companyName,
        url: `https://my.qbcc.qld.gov.au/myQBCC/s/findlocalcontractor`,
        status,
        date: expiry,
        metadata: {
          'Licence Number': licenceNo,
          'Licence Class': licenceClass,
          Status: status,
          'Expiry Date': expiry,
          'Financial Category': financialCategory,
        },
      });
    }
  } catch {
    // Try HTML scrape of the public-facing search
    try {
      const encoded = encodeURIComponent(companyName);
      const { data } = await axios.get(
        `https://www.qbcc.qld.gov.au/find-a-local-contractor?name=${encoded}`,
        { headers: { ...HEADERS, Accept: 'text/html' }, timeout: 20000 }
      );
      const $ = cheerio.load(data);

      $('table tbody tr, [class*="contractor"], [class*="licensee"]').each((_, row) => {
        const cells = $('td', row);
        if (cells.length < 2) return;
        results.push({
          title: cells.eq(0).text().trim(),
          url: `https://my.qbcc.qld.gov.au/myQBCC/s/findlocalcontractor`,
          metadata: {
            'Licence Number': cells.eq(1).text().trim(),
            'Licence Class': cells.eq(2)?.text().trim() || '',
            Status: cells.eq(3)?.text().trim() || '',
          },
        });
      });
    } catch {
      // ignore
    }
  }

  // QBCC Adjudication decisions search
  const adjudicationResults = [];
  try {
    const { data: adjData } = await axios.get(
      `https://www.qbcc.qld.gov.au/adjudication-decisions?search=${encodeURIComponent(companyName)}`,
      { headers: { ...HEADERS, Accept: 'text/html' }, timeout: 15000 }
    );
    const $ = cheerio.load(adjData);

    $('table tbody tr, [class*="decision"], article').each((_, el) => {
      const link = $(el).find('a').first();
      const title = link.text().trim() || $(el).find('td').first().text().trim();
      if (!title) return;
      const href = link.attr('href');
      adjudicationResults.push({
        title,
        url: href
          ? href.startsWith('http') ? href : `https://www.qbcc.qld.gov.au${href}`
          : 'https://www.qbcc.qld.gov.au/adjudication-decisions',
        description: $(el).text().trim().slice(0, 200),
      });
    });
  } catch {
    // ignore
  }

  // QBCC Excluded Individual Register — search by each director name
  const excludedResults = await searchQBCCExcluded(directors || []);

  const allResults = [
    ...results,
    ...adjudicationResults.map((r) => ({ ...r, isAdjudication: true })),
    ...excludedResults.map((r) => ({ ...r, isExcluded: true })),
  ];

  return {
    source: 'QBCC — Queensland Building & Construction Commission',
    jurisdiction: 'QLD',
    category: 'license',
    results: allResults,
    licenceResults: results,
    adjudicationResults,
    enforcementResults: excludedResults,
    searchUrl: `https://my.qbcc.qld.gov.au/myQBCC/s/findlocalcontractor`,
    adjudicationSearchUrl: `https://www.qbcc.qld.gov.au/adjudication-decisions`,
    enforcementSearchUrl: EXCLUDED_REGISTER_URL,
    summary:
      allResults.length > 0
        ? `Found ${results.length} licence(s), ${adjudicationResults.length} adjudication decision(s), and ${excludedResults.length} excluded individual(s)`
        : 'No QBCC licence, adjudication, or excluded individual records found',
  };
}

module.exports = { searchQBCC };
