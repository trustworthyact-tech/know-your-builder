const { fetchAsicEuRecords, REGISTER_URL } = require('./asicEnforceableUndertakingsDataset');

// Every significant word must appear in the record text to prevent false positives.
// Phrase-anchored (not just "every word present anywhere") for multi-word queries —
// see vicVbaLicence.js / vicBpc.js's identical fix for why a plain "every word present"
// check lets unrelated companies through (e.g. "Kane Constructions" matching unrelated
// records that happen to contain both words separately).
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameMatchesEntity(text, name) {
  if (!name) return false;
  const words = name
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  if (words.length > 1) {
    const phrase = words.map(escapeRegExp).join('\\W+');
    return new RegExp(`(^|\\s)${phrase}(\\s|$)`).test(lower);
  }
  return words.every((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(lower));
}

function stripCompanySuffix(name) {
  return (name || '').replace(/\s*(?:pty|proprietary)?\.?\s*(?:ltd|limited)\.?\s*$/i, '').trim();
}

function mapRecordToResult(record) {
  const pdf = record.pdfLinks[0];
  return {
    title: `${record.partyText} — Court Enforceable Undertaking`,
    url: pdf?.href || REGISTER_URL,
    date: record.date,
    status: 'Court Enforceable Undertaking',
    description: record.section,
    jurisdiction: 'Federal',
    metadata: {
      'Section of Act': record.section,
      'Party Names': record.partyText,
      'Media Release': record.mediaUrl
        ? new URL(record.mediaUrl, 'https://www.asic.gov.au').toString()
        : '',
      'Date of Acceptance': record.date,
    },
  };
}

async function searchAsicEnforceableUndertakings(companyName, directorNames) {
  const queries = [stripCompanySuffix(companyName), ...(directorNames || [])].filter(Boolean);

  let records;
  try {
    const fetched = await fetchAsicEuRecords();
    records = fetched.records;
  } catch {
    // No live data AND no cache at all — fail loud rather than silently reporting
    // "no undertakings found", mirroring vicBpc.js's convention for a source that
    // could not be checked at all.
    return {
      source: 'ASIC — Court Enforceable Undertakings Register',
      jurisdiction: 'Federal',
      category: 'legal',
      status: 'error',
      results: [],
      searchUrl: REGISTER_URL,
      error: 'Search failed',
      summary: 'Could not reach the ASIC Court Enforceable Undertakings register — try again or search manually',
    };
  }

  const allResults = [];
  const seen = new Set();

  for (const query of queries) {
    for (const record of records) {
      const dedupeKey = record.pdfLinks[0]?.href || `${record.partyText}|${record.date}`;
      if (seen.has(dedupeKey)) continue;
      if (!nameMatchesEntity(record.partyText, query)) continue;
      seen.add(dedupeKey);
      allResults.push(mapRecordToResult(record));
    }
  }

  return {
    source: 'ASIC — Court Enforceable Undertakings Register',
    jurisdiction: 'Federal',
    category: 'legal',
    results: allResults,
    searchUrl: REGISTER_URL,
    summary:
      allResults.length > 0
        ? `${allResults.length} court enforceable undertaking(s) found`
        : 'No court enforceable undertakings found for this entity',
  };
}

module.exports = { searchAsicEnforceableUndertakings, nameMatchesEntity };
