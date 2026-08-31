const cheerio = require('cheerio');
const { fetchVbaBpcRecords } = require('./vicBpcDataset');

// The VBA (Victorian Building Authority) rebranded to the Building and Plumbing
// Commission. The old prosecution & disciplinary register at
// vba.vic.gov.au/tools/prosecution-and-disciplinary-register now redirects to
// bpc.vic.gov.au/compliance-and-enforcement-register, which is a completely
// different SPA — no more List.js search box or .accordion__block markup.
//
// Crucially, that new page's own search box doesn't do a server-side search at
// all: the page fetches its entire ~943-record dataset from a backend API up
// front and filters it client-side in JS, so the API returns the same full list
// no matter what query string is sent to it. There is nothing left to "search"
// server-side — so this scraper no longer drives Puppeteer per query. Instead
// vicBpcDataset.js fetches (and caches) the whole register once, and we do the
// name matching locally against that cached list. Confirmed live 2026-08-28.
const PROSECUTION_REGISTER_URL = 'https://www.bpc.vic.gov.au/compliance-and-enforcement-register';

// Every significant word must appear in the record text to prevent false positives.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameMatchesEntity(text, companyName) {
  if (!companyName) return false;
  const words = companyName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(lower));
}

// Strips HTML tags from the API's rich-text fields (summary / actionTaken come
// back as HTML, e.g. "<div><p>...</p></div>").
function stripHtml(html) {
  if (!html) return '';
  return cheerio.load(html).text().replace(/\s+/g, ' ').trim();
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Maps one API record into this scraper's result-item shape (same field names
// parseAccordionItems() used to produce: title, url, date, status, description,
// jurisdiction, metadata).
function mapRecordToResult(record) {
  const data = record.data || {};
  const title = (record.titlePrefix || '') + (record.title || '');

  const status =
    (data.decisionType && capitalize(data.decisionType)) ||
    data.disciplinaryProceeding ||
    (record.titlePrefix ? record.titlePrefix.trim() : '') ||
    'Compliance action';

  const summaryText = stripHtml(data.summary);
  const actionText = stripHtml(data.actionTaken);
  const description = (summaryText || actionText || `BPC compliance action — ${title}`).slice(0, 300);

  return {
    title,
    url: PROSECUTION_REGISTER_URL,
    date: data.decisionDate || '',
    status,
    description,
    jurisdiction: 'VIC',
    metadata: {
      Source: 'Victorian Building Authority / Building and Plumbing Commission',
      Registration: Array.isArray(data.registrations) ? data.registrations.join('; ') : '',
      Proceeding: data.disciplinaryProceeding || '',
      Date: data.decisionDate || '',
      Action: actionText.slice(0, 200),
    },
  };
}

async function searchVicBpc(companyName, abn, directors) {
  const queries = [
    // Strip Pty Ltd so matching works on the distinctive words
    companyName.replace(/\s*(?:pty|proprietary)?\.?\s*(?:ltd|limited)\.?\s*$/i, '').trim(),
    ...(directors || []).filter(Boolean),
  ];

  let records;
  try {
    const fetched = await fetchVbaBpcRecords();
    records = fetched.records;
  } catch (err) {
    // No live data AND no cache at all — fail loud rather than silently
    // reporting "no proceedings found", mirroring courtRecords.js's
    // buildManualFallback / allFailed convention for a source that could not
    // be checked at all.
    return {
      source: 'Victorian Building Authority — Disciplinary Register',
      jurisdiction: 'VIC',
      category: 'regulatory',
      status: 'error',
      results: [],
      searchUrl: PROSECUTION_REGISTER_URL,
      error: 'Search failed',
      summary: 'Could not reach the VBA/BPC compliance and enforcement register — try again or search manually',
    };
  }

  const allResults = [];
  const seen = new Set();

  for (const query of queries) {
    for (const record of records) {
      if (seen.has(record.id)) continue;
      if (!nameMatchesEntity(record.title || '', query)) continue;
      seen.add(record.id);
      allResults.push(mapRecordToResult(record));
    }
  }

  return {
    source: 'Victorian Building Authority — Disciplinary Register',
    jurisdiction: 'VIC',
    category: 'regulatory',
    results: allResults,
    searchUrl: PROSECUTION_REGISTER_URL,
    summary:
      allResults.length > 0
        ? `${allResults.length} VBA disciplinary proceeding(s) found`
        : 'No VBA disciplinary proceedings found for this entity',
  };
}

module.exports = { searchVicBpc };
