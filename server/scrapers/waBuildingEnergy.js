const axios = require('axios');

// WA Building and Energy enforcement announcements moved to wa.gov.au when
// www.buildingandenergywa.gov.au (DEMIRS/Building and Energy) was restructured
// into the Department of Local Government, Industry Regulation and Safety (LGIRS).
// The new enforcement content lives at:
//   https://www.wa.gov.au/government/document-collections/disciplinary-and-prosecution-media-releases-builders
// Search is powered by an Elastic Cloud index whose read-only credentials are
// embedded in every wa.gov.au page (public, not a secret).

const BASE = 'https://www.wa.gov.au';
const ELASTIC_HOST = 'https://wa-gov-au-syd-v8-prd.es.ap-southeast-2.aws.found.io:443';
const ELASTIC_INDEX = 'production-wagov-blue-pipeline-cms-search-alias';
const ELASTIC_AUTH = { username: 'client', password: '43674c65465000' };

// All Building and Energy disciplinary/prosecution collection page URLs
const COLLECTION_URLS = [
  '/government/document-collections/disciplinary-and-prosecution-media-releases-builders',
  '/government/document-collections/disciplinary-and-prosecutions-media-releases-electrical',
  '/government/document-collections/disciplinary-and-prosecutions-media-releases-gas',
  '/government/document-collections/disciplinary-and-prosecutions-media-releases-painters',
  '/government/document-collections/disciplinary-and-prosecutions-media-releases-plumbing',
  '/government/document-collections/disciplinary-and-prosecutions-media-releases-building-surveyors',
];

const ENFORCEMENT_KEYWORDS = [
  'prosecut',
  'penalt',
  'fine',
  'suspend',
  'cancel',
  'prohibit',
  'unlicensed',
  'unregistered',
  'illegal',
  'offence',
  'conviction',
  'court',
  'tribunal',
  'order',
  'disciplin',
  'caution',
  'infringement',
];

function isEnforcementOutcome(text) {
  const lower = (text || '').toLowerCase();
  return ENFORCEMENT_KEYWORDS.some((k) => lower.includes(k));
}

// Every significant word must appear in the text.
function nameMatchesEntity(text, companyName) {
  if (!companyName) return false;
  const words = companyName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((w) => lower.includes(w));
}

function buildSearchUrl(companyName, abn) {
  // Point the public-facing search URL at the builders collection page
  const q = abn ? abn.replace(/\s/g, '') : companyName || '';
  return `${BASE}${COLLECTION_URLS[0]}`;
}

// Search the wa.gov.au Elastic index for Building and Energy enforcement announcements
// matching the given query term (company name or ABN).
async function fetchWAResults(query, entityName) {
  if (!query) return [];
  const url = `${ELASTIC_HOST}/${ELASTIC_INDEX}/_search`;
  const body = {
    query: {
      bool: {
        must: [
          {
            multi_match: {
              query,
              fields: ['title', 'body', 'rendered_item', 'field_description'],
              type: 'phrase',
            },
          },
        ],
        filter: [
          { term: { content_type: 'announcement_content' } },
          { match: { field_provider_title: 'Building and Energy' } },
        ],
      },
    },
    size: 20,
    _source: ['title', 'url', 'field_published_date', 'body', 'field_description'],
  };

  try {
    const { data } = await axios.post(url, body, {
      auth: ELASTIC_AUTH,
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000,
    });

    const hits = (data.hits && data.hits.hits) || [];
    const results = [];

    for (const hit of hits) {
      const src = hit._source || {};
      const title = Array.isArray(src.title) ? src.title[0] : src.title || '';
      const relUrl = Array.isArray(src.url) ? src.url[0] : src.url || '';
      const fullUrl = relUrl ? `${BASE}${relUrl}` : '';
      const ts = Array.isArray(src.field_published_date)
        ? src.field_published_date[0]
        : src.field_published_date;
      const date = ts
        ? new Date(ts * 1000).toISOString().slice(0, 10)
        : '';
      const description = Array.isArray(src.field_description)
        ? src.field_description[0]
        : src.field_description || '';
      const bodyText = Array.isArray(src.body) ? src.body[0] : src.body || '';
      const fullText = `${title} ${description} ${bodyText}`;

      if (!title) continue;
      if (!isEnforcementOutcome(fullText) && !isEnforcementOutcome(title)) continue;
      if (!nameMatchesEntity(fullText, entityName)) continue;

      results.push({
        title,
        url: fullUrl || `${BASE}${COLLECTION_URLS[0]}`,
        date,
        status: 'WA Building & Energy enforcement action',
        description: description || bodyText.slice(0, 200) || 'WA Building and Energy enforcement or prosecution outcome',
        jurisdiction: 'WA',
        metadata: {
          Source: 'WA Building and Energy',
          Date: date,
        },
      });
    }

    return results;
  } catch {
    return [];
  }
}

async function searchWABuildingEnergy(companyName, abn, directors) {
  const searchUrl = buildSearchUrl(companyName, abn);
  const allResults = [];

  // Company/ABN search — prefer ABN (more precise), fall back to name
  const companyQuery = abn ? abn.replace(/\s/g, '') : companyName;
  const companyResults = await fetchWAResults(companyQuery, companyName);
  allResults.push(...companyResults);

  // If ABN search returned nothing, also try the name
  if (abn && companyResults.length === 0 && companyName) {
    const nameResults = await fetchWAResults(companyName, companyName);
    allResults.push(...nameResults);
  }

  // Per-director searches
  for (const director of (directors || [])) {
    if (!director) continue;
    const hits = await fetchWAResults(director, director);
    allResults.push(...hits);
  }

  // Deduplicate by URL
  const seen = new Set();
  const results = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  return {
    source: 'WA Building and Energy',
    jurisdiction: 'WA',
    category: 'regulatory',
    results,
    searchUrl,
    summary:
      results.length > 0
        ? `${results.length} WA Building and Energy enforcement action(s) found`
        : 'No WA Building and Energy enforcement actions found for this entity',
  };
}

module.exports = { searchWABuildingEnergy };
