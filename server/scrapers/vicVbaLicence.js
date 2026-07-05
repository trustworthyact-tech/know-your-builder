const { getBrowser } = require('./browser');

// VIC Victorian Building Authority — Practitioner Licence Register (BAMS).
// Site: https://bams.vba.vic.gov.au/bams/s/practitioner-search
//
// The register is a Salesforce Experience Cloud (LWC) SPA. Practitioner name
// inputs live inside the shadow DOM — reachable via page.$$('input[type="text"]').
// Searching fires an Aura ApexAction call; we intercept the response to get results
// without parsing the rendered DOM.
//
// Aura endpoint: POST /bams/s/sfsites/aura?aura.ApexAction.execute=1
// Apex class: PractitionerSearchUtil, method: getPractitioners
// Response key: actions[0].returnValue.returnValue.PractitionerDetailList
// Result fields: practitionerName, practitionerId, registrationCategoryWithClass,
//                registrationNumber, status, phoneNumber, registrationType, detailURL
//
// No CAPTCHA. Puppeteer required to bootstrap the SPA session.

const BAMS_BASE = 'https://bams.vba.vic.gov.au';
const SEARCH_URL = `${BAMS_BASE}/bams/s/practitioner-search`;

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

function toResultItem(p) {
  const raw = p.detailURL || '';
  const url = raw.startsWith('http') ? raw : raw ? `${BAMS_BASE}${raw}` : SEARCH_URL;

  return {
    title: p.practitionerName || '',
    url,
    date: '',
    status: p.status || '',
    description: `${p.registrationCategoryWithClass || p.registrationType || 'VIC Building Licence'} — Reg ${p.registrationNumber || 'N/A'}`,
    jurisdiction: 'VIC',
    metadata: {
      Source: 'Victorian Building Authority',
      RegistrationNumber: p.registrationNumber,
      RegistrationType: p.registrationType,
      RegistrationCategory: p.registrationCategoryWithClass,
      Status: p.status,
      Phone: p.phoneNumber,
    },
  };
}

// Perform one search on an already-loaded BAMS page.
// Returns the raw PractitionerDetailList array (may be empty).
// The response interceptor resolves as soon as the Aura call lands.
async function searchOnPage(page, query) {
  return new Promise((resolve) => {
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; page.off('response', handler); resolve([]); }
    }, 15_000);

    async function handler(resp) {
      if (done) return;
      if (!resp.url().includes('aura') || !resp.url().includes('ApexAction')) return;
      try {
        const text = await resp.text().catch(() => '');
        const data = JSON.parse(text);
        const rv = data?.actions?.[0]?.returnValue?.returnValue;
        if (rv && 'PractitionerDetailList' in rv) {
          done = true;
          clearTimeout(timer);
          page.off('response', handler);
          resolve(rv.PractitionerDetailList || []);
        }
      } catch { /* non-JSON or unrelated Aura call */ }
    }

    page.on('response', handler);

    (async () => {
      try {
        // inputs[0] = Practitioner name (LWC shadow DOM, pierced by Puppeteer)
        const inputs = await page.$$('input[type="text"]');
        if (!inputs[0]) throw new Error('practitioner name input not found');

        await inputs[0].click({ clickCount: 3 });
        await inputs[0].type(query, { delay: 40 });
        await new Promise((r) => setTimeout(r, 300));

        const buttons = await page.$$('button');
        let clicked = false;
        for (const btn of buttons) {
          const txt = await page.evaluate((b) => b.innerText?.trim() ?? '', btn);
          if (txt === 'Search') { await btn.click(); clicked = true; break; }
        }
        if (!clicked) await inputs[0].press('Enter');
      } catch {
        if (!done) { done = true; clearTimeout(timer); page.off('response', handler); resolve([]); }
      }
    })();
  });
}

async function searchVicVbaLicence(companyName, abn, directors) {
  const allResults = [];
  const seen = new Set();

  const strippedName = (companyName || '').replace(/\s*pty\s*ltd\.?\s*$/i, '').trim();
  const queries = [strippedName, ...(directors || []).filter(Boolean)].filter(Boolean);

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(SEARCH_URL, { waitUntil: 'networkidle2', timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 4_000));

    for (const query of queries) {
      try {
        const hits = await searchOnPage(page, query);
        for (const p of hits) {
          const name = p.practitionerName || '';
          if (!nameMatchesEntity(name, query)) continue;
          const key = p.registrationNumber ? String(p.registrationNumber) : `${name}|${p.registrationType}`;
          if (seen.has(key)) continue;
          seen.add(key);
          allResults.push(toResultItem(p));
        }
        await new Promise((r) => setTimeout(r, 1_000));
      } catch {
        // non-fatal — continue with remaining queries
      }
    }
  } catch (err) {
    console.warn('[vicVbaLicence] browser error:', err.message);
  } finally {
    await page.close().catch(() => {});
  }

  return {
    source: 'Victorian Building Authority — Licence Register',
    jurisdiction: 'VIC',
    category: 'license',
    results: allResults,
    searchUrl: SEARCH_URL,
    summary:
      allResults.length > 0
        ? `${allResults.length} VBA licence record(s) found`
        : 'No VBA licence records found for this entity',
  };
}

module.exports = { searchVicVbaLicence };
