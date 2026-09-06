'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ASIC's Court Enforceable Undertakings register has no bulk/open-data API — confirmed
// by querying data.gov.au's CKAN Action API directly for ASIC's organization
// (package_search?q=organization:australian-securities-and-investments-commission-asic):
// it publishes exactly 12 datasets (companies, business names, licensee/adviser/auditor
// registers, banned & disqualified persons), no enforcement-outcome registers at all.
//
// The register page itself is simpler to work with than a bulk API would be, though:
// every undertaking since 1998 (~500 records) is rendered directly in one static,
// unauthenticated HTML page — confirmed live via plain axios (200 OK, no Cloudflare/WAF
// challenge, no CAPTCHA). No pagination, no "load more", no JS rendering required. So
// this follows the same fetch-once-cache-and-match-locally shape as vicBpcDataset.js /
// asicDpnDataset.js, but simpler still — no browser.js/Puppeteer dependency needed.
const REGISTER_URL =
  'https://www.asic.gov.au/online-services/search-asic-registers/court-enforceable-undertakings-register';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// ASIC_EU_CACHE_DIR points at a Railway persistent Volume when set, so a successful
// fetch survives a redeploy instead of being wiped with the rest of os.tmpdir(). Falls
// back to os.tmpdir() for local dev. Mirrors vicBpcDataset.js's VBA_BPC_CACHE_DIR pattern.
const CACHE_DIR = (() => {
  const dir = process.env.ASIC_EU_CACHE_DIR;
  return dir && fs.existsSync(dir) ? dir : os.tmpdir();
})();
const CACHE_PATH = path.join(CACHE_DIR, 'asic_enforceable_undertakings.json');

// Recent rows wrap the party name in its own <p>. Older rows (pre-~2011) have no <p> at
// all — just bare text nodes separated by <br>, followed directly by the media-release
// <a> with no separator (e.g. "Mrs I C Hilder<br><a>Media Release 98/236</a>"). Naively
// taking .text() on those joins the name and link text with no space in between
// ("HilderMedia Release..."). Strip the <a> and turn <br> into a join point first.
function extractPartyText($, cell) {
  const $ps = cell.find('p');
  if ($ps.length > 0) {
    return $($ps[0]).text().replace(/\s+/g, ' ').trim();
  }
  const $clone = cell.clone();
  $clone.find('a').remove();
  $clone.find('br').replaceWith('\n');
  return $clone
    .text()
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('; ');
}

function parseRecords(html) {
  const $ = cheerio.load(html);
  const records = [];

  $('table.asic-table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    // A handful of very old rows (e.g. the 2002 Barton Capital Securities entry) use
    // colspan to merge columns for an explanatory note — only 3 <td>s instead of 4.
    // Rare enough (1 in ~500 live) that skipping rather than special-casing is fine.
    if (cells.length < 4) return;

    const section = $(cells[0]).text().replace(/\s+/g, ' ').trim();
    const partyCell = $(cells[1]);
    const partyText = extractPartyText($, partyCell);
    if (!partyText) return;

    const mediaLink = partyCell.find('a').first();
    const mediaUrl = mediaLink.attr('href') || '';

    const pdfLinks = $(cells[2])
      .find('a')
      .toArray()
      .map((a) => ({ href: $(a).attr('href') || '', text: $(a).text().trim() }))
      .filter((l) => l.href);

    const date = $(cells[3]).text().replace(/\s+/g, ' ').trim();

    records.push({ section, partyText, mediaUrl, pdfLinks, date });
  });

  return records;
}

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

/**
 * Fetches (or returns a cached copy of) the full ASIC Court Enforceable Undertakings
 * register.
 *
 * Returns { records, stale, cachedAt }. `stale` is true when the live fetch failed and
 * a previously-cached copy was returned instead (`cachedAt` is that copy's mtime) —
 * callers should surface this to the user rather than presenting it as fresh data.
 * Throws only when the live fetch fails AND no cached copy exists.
 *
 * _axios is injectable so tests can simulate a fetch failure and stale fallback without
 * touching the network — same pattern as captcha.js's _http.
 */
async function doFetchAsicEuRecords(_axios = axios) {
  let html;
  try {
    const { data } = await _axios.get(REGISTER_URL, { headers: HEADERS, timeout: 30_000 });
    html = data;
  } catch (err) {
    const cached = await readCachedRecords();
    if (cached) return cached;
    throw err;
  }

  const records = parseRecords(html);

  try {
    await fs.promises.writeFile(CACHE_PATH, JSON.stringify(records));
  } catch {
    // Cache write failure is non-fatal
  }
  return { records, stale: false, cachedAt: new Date() };
}

// Concurrent callers hitting a cold cache would otherwise each trigger their own fetch
// of the same page — coalesce into one in-flight request, mirroring the inFlightFetch
// pattern in asicDpnDataset.js / vicBpcDataset.js.
let inFlightFetch = null;

async function fetchAsicEuRecords(_axios = axios) {
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = doFetchAsicEuRecords(_axios);
  try {
    return await inFlightFetch;
  } finally {
    inFlightFetch = null;
  }
}

module.exports = { fetchAsicEuRecords, parseRecords, CACHE_PATH, REGISTER_URL };
