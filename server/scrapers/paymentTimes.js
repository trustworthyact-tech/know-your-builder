'use strict';

const axios = require('axios');
const zlib  = require('zlib');
const fs    = require('fs');
const os    = require('os');
const path  = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const UPDATE_JS_URL = 'https://register.paymenttimes.gov.au/files/js/update.js';
const DOWNLOAD_BASE = 'https://register.paymenttimes.gov.au/files/downloads/';
const CACHE_PATH    = path.join(os.tmpdir(), 'ptrr_register.xlsx');
const ETAG_PATH     = path.join(os.tmpdir(), 'ptrr_register.etag');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// Sheets to search (skip sheet8 = Historical Reports — it's 142 MB uncompressed)
// sheet2 = Standard report, sheet3 = No SB procurement, sheet6 = AASB8 report,
// sheet7 = Records of Non-compliance
const SHEETS_TO_SEARCH = [
  'xl/worksheets/sheet2.xml',
  'xl/worksheets/sheet3.xml',
  'xl/worksheets/sheet6.xml',
  'xl/worksheets/sheet7.xml',
];

// ── ZIP helpers (no external deps) ──────────────────────────────────────────

/**
 * Extract a single file from a ZIP buffer (stored as deflate, method 8).
 * Returns the raw decompressed Buffer.
 */
function extractZipEntry(buf, filename) {
  // Find End-of-Central-Directory record
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdPos = i; break; }
  }
  if (eocdPos < 0) throw new Error('PTRR: invalid ZIP (no EOCD)');

  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  const cdSize   = buf.readUInt32LE(eocdPos + 12);

  // Walk Central Directory
  let pos = cdOffset;
  while (pos < cdOffset + cdSize) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break; // not a CD entry
    const compSize    = buf.readUInt32LE(pos + 20);
    const fnLen       = buf.readUInt16LE(pos + 28);
    const extraLen    = buf.readUInt16LE(pos + 30);
    const commentLen  = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const fn          = buf.slice(pos + 46, pos + 46 + fnLen).toString('utf8');

    if (fn === filename) {
      // Jump to local file header
      const lh       = localOffset;
      const lfnLen   = buf.readUInt16LE(lh + 26);
      const lExtraLen = buf.readUInt16LE(lh + 28);
      const dataStart = lh + 30 + lfnLen + lExtraLen;
      const compData  = buf.slice(dataStart, dataStart + compSize);
      return zlib.inflateRawSync(compData);
    }
    pos += 46 + fnLen + extraLen + commentLen;
  }
  throw new Error(`PTRR: file not found in ZIP: ${filename}`);
}

// ── XML helpers ──────────────────────────────────────────────────────────────

const XML_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&apos;': "'", '&quot;': '"' };
function decodeXml(s) {
  return s.replace(/&(?:amp|lt|gt|apos|quot);/g, m => XML_ENTITIES[m] || m);
}

/**
 * Parse xl/sharedStrings.xml into a flat string array.
 * Each <si> element may contain one or more <t> elements (rich text).
 */
function parseSharedStrings(xml) {
  const strings = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  const tRe  = /<t(?:[^>]*)>([\s\S]*?)<\/t>/g;
  let si;
  while ((si = siRe.exec(xml)) !== null) {
    const parts = [];
    let t;
    tRe.lastIndex = 0;
    while ((t = tRe.exec(si[1])) !== null) parts.push(decodeXml(t[1]));
    strings.push(parts.join(''));
  }
  return strings;
}

/**
 * Convert an Excel serial date number to an ISO date string.
 * Excel epoch: Jan 0, 1900 (= Dec 31 1899), with the infamous leap-year bug.
 */
function excelDateToISO(serial) {
  if (!serial || isNaN(serial)) return '';
  const n = parseFloat(serial);
  if (n < 1) return '';
  // Adjust for Excel's leap-year bug (serial >= 60 means Excel counted Feb 29 1900 which doesn't exist)
  const adjusted = n >= 60 ? n - 1 : n;
  const d = new Date(Date.UTC(1900, 0, 0) + adjusted * 86400000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── Cache management ─────────────────────────────────────────────────────────

/**
 * Download the register Excel file, using ETag to avoid re-downloading
 * if the file hasn't changed since the last call.
 * Returns the file contents as a Buffer.
 */
async function fetchRegisterBuffer() {
  // Step 1: get current filename from update.js
  let fileName;
  try {
    const { data } = await axios.get(UPDATE_JS_URL, { headers: HEADERS, timeout: 10000 });
    const m = String(data).match(/let\s+fileName\s*=\s*"([^"]+)"/);
    fileName = m ? m[1] : null;
  } catch {
    // fallback: if update.js fails, try to use cached file
  }

  if (!fileName) {
    // Try to use a cached copy regardless of freshness
    if (fs.existsSync(CACHE_PATH)) {
      return fs.readFileSync(CACHE_PATH);
    }
    throw new Error('PTRR: could not determine current register filename');
  }

  const url = DOWNLOAD_BASE + fileName;

  // Step 2: conditional GET using stored ETag
  const reqHeaders = { ...HEADERS, Accept: 'application/octet-stream' };
  if (fs.existsSync(ETAG_PATH) && fs.existsSync(CACHE_PATH)) {
    const storedEtag = fs.readFileSync(ETAG_PATH, 'utf8').trim();
    if (storedEtag) reqHeaders['If-None-Match'] = storedEtag;
  }

  const resp = await axios.get(url, {
    headers: reqHeaders,
    responseType: 'arraybuffer',
    timeout: 120000,
    validateStatus: s => s === 200 || s === 304,
  });

  if (resp.status === 304 && fs.existsSync(CACHE_PATH)) {
    // Not modified — use cached copy
    return fs.readFileSync(CACHE_PATH);
  }

  // New or updated file
  const buf = Buffer.from(resp.data);
  try {
    fs.writeFileSync(CACHE_PATH, buf);
    const etag = resp.headers['etag'] || resp.headers['ETag'] || '';
    if (etag) fs.writeFileSync(ETAG_PATH, etag);
  } catch {
    // Cache write failure is non-fatal
  }
  return buf;
}

// ── Search logic ─────────────────────────────────────────────────────────────

/**
 * Search the PTRR Excel workbook for rows matching the query.
 *
 * Strategy:
 *  1. Parse sharedStrings.xml to build a string array.
 *  2. Find all shared-string indices whose value contains the query.
 *  3. For each sheet, find rows where the B column (Business Name) has one of
 *     those indices (or the C column ABN matches directly).
 *  4. Deduplicate by name+ABN and return the most recent report per entity.
 */
function searchWorkbook(buf, query, abn) {
  const queryLower = query ? query.toLowerCase() : '';
  const abnClean   = abn ? abn.replace(/\s/g, '') : '';

  // 1. Parse shared strings
  const ssXml   = extractZipEntry(buf, 'xl/sharedStrings.xml').toString('utf8');
  const strings = parseSharedStrings(ssXml);

  // 2. Find matching string indices (by name or ABN)
  const matchingNameIndices = new Set();
  const matchingAbnIndices  = new Set();
  strings.forEach((s, i) => {
    if (queryLower && s.toLowerCase().includes(queryLower)) matchingNameIndices.add(i);
    if (abnClean && s.replace(/\s/g, '') === abnClean) matchingAbnIndices.add(i);
  });

  if (matchingNameIndices.size === 0 && matchingAbnIndices.size === 0) return [];

  // 3. Search each sheet
  const seen = new Map(); // key: "name|abn" → best result
  const cellRe = /<c r="([A-Z]+)\d+" (?:[^>]*t="([^"]*)")?[^>]*>(?:<v>(.*?)<\/v>)?/g;

  for (const sheetFile of SHEETS_TO_SEARCH) {
    let sheetXml;
    try {
      sheetXml = extractZipEntry(buf, sheetFile).toString('utf8');
    } catch {
      continue;
    }

    const rowRe = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(sheetXml)) !== null) {
      const rowNum  = parseInt(rm[1], 10);
      if (rowNum <= 2) continue; // rows 1+2 are description + header

      const rowXml = rm[2];

      // Quick check: does this row contain any of our matching indices?
      // Check B column for name match, C column for ABN match
      const bMatch = rowXml.match(/<c r="B\d+" t="s"><v>(\d+)<\/v><\/c>/);
      const cMatch = rowXml.match(/<c r="C\d+" t="s"><v>(\d+)<\/v><\/c>/);
      // Also handle ABN as numeric (non-shared-string) in some sheets
      const cNum   = rowXml.match(/<c r="C\d+"><v>(\d+)<\/v><\/c>/);

      const bIdx = bMatch ? parseInt(bMatch[1], 10) : -1;
      const cIdx = cMatch ? parseInt(cMatch[1], 10) : -1;
      const cVal = cNum ? cNum[1] : '';

      const nameHit = bIdx >= 0 && matchingNameIndices.has(bIdx);
      const abnHit  = (cIdx >= 0 && matchingAbnIndices.has(cIdx)) ||
                      (abnClean && cVal === abnClean);

      if (!nameHit && !abnHit) continue;

      // Parse all columns for this row
      const cells = {};
      cellRe.lastIndex = 0;
      let cm;
      while ((cm = cellRe.exec(rowXml)) !== null) {
        const col = cm[1], t = cm[2] || 'n', v = cm[3];
        if (v === undefined || v === null || v === '') { cells[col] = ''; continue; }
        cells[col] = t === 's' ? (strings[parseInt(v, 10)] || '') : v;
      }

      const name      = cells['B'] || '';
      const entityAbn = cells['C'] || '';
      const entityAcn = cells['D'] || '';
      const type      = cells['E'] || '';
      const start     = excelDateToISO(cells['F']);
      const end       = excelDateToISO(cells['G']);
      const avgDays   = cells['U'] || '';
      const within30  = cells['Y'] || '';
      const days3160  = cells['Z'] || '';
      const over60    = cells['AA'] || '';
      const stdTerms  = cells['M'] || '';

      const dedupKey = `${name.toLowerCase()}|${entityAbn}`;

      // Keep the row with the latest period end date
      const prev = seen.get(dedupKey);
      if (!prev || end > (prev.periodEnd || '')) {
        seen.set(dedupKey, {
          name,
          abn: entityAbn,
          acn: entityAcn,
          type,
          periodStart: start,
          periodEnd: end,
          avgDays,
          within30,
          days3160,
          over60,
          stdTerms,
        });
      }
    }
  }

  return [...seen.values()];
}

// ── Public API ───────────────────────────────────────────────────────────────

async function searchPaymentTimes(companyName, abn, acn) {
  const query = companyName || '';
  const abnClean = abn ? abn.replace(/\s/g, '') : '';
  const searchUrl = `https://register.paymenttimes.gov.au/dashboard.html`;

  let buf;
  try {
    buf = await fetchRegisterBuffer();
  } catch (err) {
    return {
      source: 'Payment Times Reporting Register',
      jurisdiction: 'Federal',
      category: 'payment',
      results: [],
      searchUrl,
      summary: `Could not download register: ${err.message}`,
    };
  }

  let rows;
  try {
    rows = searchWorkbook(buf, query, abnClean);
  } catch (err) {
    return {
      source: 'Payment Times Reporting Register',
      jurisdiction: 'Federal',
      category: 'payment',
      results: [],
      searchUrl,
      summary: `Could not parse register: ${err.message}`,
    };
  }

  const results = rows.map(r => {
    const metadata = {};
    if (r.abn)       metadata['ABN'] = r.abn;
    if (r.acn)       metadata['ACN/ARBN'] = r.acn;
    if (r.type)      metadata['Report type'] = r.type;
    if (r.periodStart && r.periodEnd)
      metadata['Reporting period'] = `${r.periodStart} – ${r.periodEnd}`;
    if (r.stdTerms)  metadata['Standard payment terms'] = `${r.stdTerms} days`;
    if (r.avgDays)   metadata['Average payment time'] = `${parseFloat(r.avgDays).toFixed(1)} days`;
    if (r.within30)  metadata['Paid within 30 days'] = `${parseFloat(r.within30).toFixed(1)}%`;
    if (r.days3160)  metadata['Paid 31–60 days'] = `${parseFloat(r.days3160).toFixed(1)}%`;
    if (r.over60)    metadata['Paid after 60 days'] = `${parseFloat(r.over60).toFixed(1)}%`;

    return {
      title: r.name || r.abn || 'Unknown entity',
      url: `https://register.paymenttimes.gov.au/dashboard.html`,
      metadata,
      description: r.periodEnd
        ? `Latest report period ending ${r.periodEnd}`
        : undefined,
    };
  });

  return {
    source: 'Payment Times Reporting Register',
    jurisdiction: 'Federal',
    category: 'payment',
    results,
    searchUrl,
    summary:
      results.length > 0
        ? `Found ${results.length} entity(s) with payment times data`
        : 'No payment times data found — entity may not be a required reporter or not yet submitted',
  };
}

module.exports = { searchPaymentTimes };
