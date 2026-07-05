const { getBrowser } = require('./browser');

// WA Building Services Contractor / Practitioner Licence Register
// Site: https://ols.demirs.wa.gov.au (Angular 17 SPA)
//
// Discovered form flow (verified via Puppeteer inspection):
//   1. "I want to search by" mat-select → choose "Type" (not "Number")
//   2. Autocomplete field (aria-label="Licence type") → type licence name → click option
//   3. #mat-input-2 → type company/family name
//   4. Click "search Search" button
//   API fires: GET /api/Search/licence/licenceType?LicenceType=BC&FamilyNameOrBusinessName=...
//   Response: { licenceResponseDtos: [{ entityName, licenceNumber, licenceStatus,
//              actualLicenceTypeCode, licenceTypeDescription, expiryDate, licenceId }] }
//
// Direct axios calls return HTTP 500 — the SPA must bootstrap first.
// After selecting "Type" + autocomplete, the session is established server-side.
// The easiest reliable path: interact with the form to establish state, then
// fetch the result via page.evaluate(() => fetch(...)) in the same page context.

const BASE_URL = 'https://ols.demirs.wa.gov.au';
const REGISTER_URL = BASE_URL;

const LICENCE_TYPES = [
  { code: 'BC', display: 'Building Contractor' },
  { code: 'BP', display: 'Building Practitioner' },
];

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

function toResultItem(dto) {
  const name = dto.entityName || dto.licenceeName || '';
  const licenceNum = dto.licenceNumber ? String(dto.licenceNumber) : '';
  const licenceType = dto.licenceTypeDescription || dto.actualLicenceTypeCode || '';
  const status = dto.licenceStatus || '';
  const expiry = dto.expiryDate ? dto.expiryDate.slice(0, 10) : '';
  const licenceId = dto.licenceId;
  const url = licenceId ? `${BASE_URL}/search/result/${licenceId}` : REGISTER_URL;

  return {
    title: name,
    url,
    date: expiry,
    status,
    description: `${licenceType} — Licence ${licenceNum}`,
    jurisdiction: 'WA',
    metadata: {
      Source: 'WA Building Services',
      LicenceNumber: licenceNum,
      LicenceType: licenceType,
      Status: status,
      Expiry: expiry,
    },
  };
}

// Search one licence type for one name query.
// Returns raw licenceResponseDto objects (may be empty).
async function searchLicenceType(licenceTypeDisplay, licenceTypeCode, nameQuery) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.setRequestInterception(true);
    page.on('request', (req) => req.continue().catch(() => {}));

    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 1_500));

    // Step 1: Open the "I want to search by" mat-select and choose "Type"
    await page.evaluate(() => document.querySelector('mat-select')?.click());
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => {
      for (const o of document.querySelectorAll('mat-option')) {
        if (o.textContent.trim() === 'Type') { o.click(); return; }
      }
    });
    await new Promise((r) => setTimeout(r, 1_200));

    // Step 2: Type the licence type into the autocomplete field
    const licenceInput = await page.$('input[aria-label="Licence type"]');
    if (!licenceInput) return [];
    await licenceInput.click();
    await licenceInput.type(licenceTypeDisplay, { delay: 80 });
    await new Promise((r) => setTimeout(r, 1_000));

    // Click the matching mat-option
    const optionClicked = await page.evaluate((display) => {
      for (const o of document.querySelectorAll('mat-option')) {
        if (o.textContent.trim() === display) { o.click(); return true; }
      }
      return false;
    }, licenceTypeDisplay);
    if (!optionClicked) return [];
    await new Promise((r) => setTimeout(r, 800));

    // Step 3: Fill the name field (#mat-input-2 = "Company, business or family name")
    const nameInput = await page.$('#mat-input-2');
    if (!nameInput) return [];
    await nameInput.click();
    await nameInput.type(nameQuery, { delay: 60 });
    await new Promise((r) => setTimeout(r, 400));

    // Step 4: Click the Search button and call the API from within page context
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (b.textContent.includes('Search')) { b.click(); return; }
      }
    });
    await new Promise((r) => setTimeout(r, 2_000));

    // Step 5: Call the API directly from page context (session is now established)
    const apiUrl = `/api/Search/licence/licenceType?LicenceType=${encodeURIComponent(licenceTypeCode)}&FirstName=&FamilyNameOrBusinessName=${encodeURIComponent(nameQuery)}&LocationOrPostCode=&SearchAll=false&PagingParameters.PageIndex=0&PagingParameters.PageSize=20`;
    const data = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
      } catch { return null; }
    }, apiUrl);

    return Array.isArray(data?.licenceResponseDtos) ? data.licenceResponseDtos : [];
  } finally {
    await page.close().catch(() => {});
  }
}

async function searchWALicenceRegister(companyName, abn, directors) {
  const allResults = [];
  const seen = new Set();

  const baseCompanyName = (companyName || '')
    .replace(/\s*pty\.?\s*ltd\.?\s*$/i, '')
    .trim();

  const queries = [baseCompanyName, ...(directors || []).filter(Boolean)].filter(Boolean);

  for (const { code, display } of LICENCE_TYPES) {
    for (const query of queries) {
      try {
        const dtos = await searchLicenceType(display, code, query);
        for (const dto of dtos) {
          const name = dto.entityName || dto.licenceeName || '';
          if (!nameMatchesEntity(name, query)) continue;
          const key = dto.licenceNumber ? String(dto.licenceNumber) : `${name}|${dto.entityId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          allResults.push(toResultItem(dto));
        }
      } catch {
        // non-fatal
      }
    }
  }

  return {
    source: 'WA Building Services — Contractor Licence Register',
    jurisdiction: 'WA',
    category: 'license',
    results: allResults,
    searchUrl: REGISTER_URL,
    summary:
      allResults.length > 0
        ? `${allResults.length} WA building licence record(s) found`
        : 'No WA Building Services licence records found for this entity',
  };
}

module.exports = { searchWALicenceRegister };
