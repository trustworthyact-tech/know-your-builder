'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getBrowser } = require('./browser');

// The VBA (Victorian Building Authority) rebranded to the Building and Plumbing
// Commission and the disciplinary/prosecution register moved from
// vba.vic.gov.au/tools/prosecution-and-disciplinary-register (List.js search box,
// .accordion__block markup) to bpc.vic.gov.au/compliance-and-enforcement-register.
// The new page fetches its full dataset from a backend API and filters it
// client-side in JS — the API itself ignores any query string and always returns
// the same ~943-record list, paginated 250/page. So rather than driving the
// site's search UI per query (impossible now — there's nothing server-side to
// search), we fetch the whole list once, cache it, and match locally. Confirmed
// live 2026-08-28.
const REGISTER_PAGE_URL = 'https://www.bpc.vic.gov.au/compliance-and-enforcement-register';
const API_URL = 'https://www.bpc.vic.gov.au/_api/data/compliance-and-enforcements';

// Hard upper bound on pages to follow via `next` — protects against an infinite
// loop if the API's pagination ever misbehaves (e.g. `next` pointing back at an
// earlier page). 943 records / 250 per page is 4 pages today; 20 is a generous
// ceiling well beyond any plausible near-term growth of this register.
const MAX_PAGES = 20;

// VBA_BPC_CACHE_DIR points at a Railway persistent Volume when set, so a
// successful fetch survives a redeploy instead of being wiped with the rest of
// os.tmpdir(). Falls back to os.tmpdir() for local dev. Mirrors
// asicDpnDataset.js's ASIC_DPN_CACHE_DIR pattern exactly.
const CACHE_DIR = (() => {
  const dir = process.env.VBA_BPC_CACHE_DIR;
  return dir && fs.existsSync(dir) ? dir : os.tmpdir();
})();
const CACHE_PATH = path.join(CACHE_DIR, 'vba_bpc_disciplinary.json');

async function readCachedRecords() {
  try {
    const [buffer, stat] = await Promise.all([
      fs.promises.readFile(CACHE_PATH, 'utf8'),
      fs.promises.stat(CACHE_PATH),
    ]);
    return { records: JSON.parse(buffer), stale: true, cachedAt: stat.mtime };
  } catch {
    return null;
  }
}

// This API is behind Cloudflare — a plain axios/curl GET to it returns a
// "Just a moment..." challenge page (HTTP 403). The same URL works fine when
// fetched from inside a real Puppeteer page's JS context after that page has
// already navigated to the register page and cleared the Cloudflare challenge —
// the clearance cookie set on that navigation is then attached automatically to
// same-origin fetch() calls made from within the page. Confirmed live 2026-08-28.
//
// The page is created and closed within this single function's scope (try/finally)
// rather than in a shared helper — a prior incident this session leaked a page
// (and permanently a slot from browser.js's MAX_CONCURRENT_PAGES pool) when a
// page was created in a helper and never closed on an error path.
async function fetchAllPagesViaBrowser() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-AU,en;q=0.9' });
    await page.goto(REGISTER_PAGE_URL, { waitUntil: 'networkidle2', timeout: 45_000 });

    const allRecords = [];
    let url = API_URL;
    let pageCount = 0;
    let reportedTotal = null;

    while (url && pageCount < MAX_PAGES) {
      pageCount++;
      // eslint-disable-next-line no-loop-func
      const json = await page.evaluate(async (fetchUrl) => {
        const res = await fetch(fetchUrl, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }, url);

      if (reportedTotal === null && typeof json.total === 'number') {
        reportedTotal = json.total;
      }
      if (Array.isArray(json.data)) {
        allRecords.push(...json.data);
      }
      url = json.next || null;
    }

    return { records: allRecords, reportedTotal };
  } finally {
    await page.close().catch(() => {});
  }
}

async function doFetchVbaBpcRecords() {
  let records;
  try {
    const result = await fetchAllPagesViaBrowser();
    records = result.records;
  } catch (err) {
    const cached = await readCachedRecords();
    if (cached) return cached;
    throw err;
  }

  try {
    await fs.promises.writeFile(CACHE_PATH, JSON.stringify(records));
  } catch {
    // Cache write failure is non-fatal
  }
  return { records, stale: false, cachedAt: new Date() };
}

// Concurrent callers hitting a cold cache would otherwise each trigger their own
// Puppeteer-driven fetch of the same ~943-record dataset — coalesce into one
// in-flight request, mirroring asicDpnDataset.js's inFlightFetch pattern.
let inFlightFetch = null;

/**
 * Fetches (or returns a cached copy of) the full VIC BPC compliance-and-enforcement
 * register.
 *
 * Returns { records, stale, cachedAt }. `stale` is true when the live fetch failed
 * and a previously-cached copy was returned instead (`cachedAt` is that copy's
 * mtime) — callers should surface this to the user rather than presenting it as
 * fresh data. Throws only when the live fetch fails AND no cached copy exists.
 */
async function fetchVbaBpcRecords() {
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = doFetchVbaBpcRecords();
  try {
    return await inFlightFetch;
  } finally {
    inFlightFetch = null;
  }
}

module.exports = { fetchVbaBpcRecords, CACHE_PATH, REGISTER_PAGE_URL, API_URL };
