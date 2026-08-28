// Load server/.env regardless of how this file is launched. `npm start`/`npm run dev`
// already pass --env-file=.env, but CLAUDE.md also documents plain `node index.js`,
// which does not — without this, every scraper that needs an API key (CAPTCHA_API_KEY,
// SCRAPERAPI_KEY) silently sees `undefined` and reports the key as missing.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { searchABN, searchByName } = require('./scrapers/abn');
const { searchCourtRecords } = require('./scrapers/courtRecords');
const { searchPaymentTimes } = require('./scrapers/paymentTimes');
const { searchModernSlavery } = require('./scrapers/modernSlavery');
const { searchQBCC, getDecisionSignedUrl } = require('./scrapers/qbcc');
const { searchASIC } = require('./scrapers/asic');
const { searchASICDisqualifiedFromDataset } = require('./scrapers/asicDpnMatch');
const { searchAsicInsolvency } = require('./scrapers/asicInsolvency');
const { searchAtoDebt } = require('./scrapers/atoDebt');
const { searchFWO } = require('./scrapers/fwo');
const { searchVicBpc } = require('./scrapers/vicBpc');
const { searchVicVbaLicence } = require('./scrapers/vicVbaLicence');
const { searchWABuildingEnergy } = require('./scrapers/waBuildingEnergy');
const { searchNSWFairTrading } = require('./scrapers/nswFairTrading');
const { searchNTBuildingPractitioners } = require('./scrapers/ntBuildingPractitioners');
const { searchACTLicences, searchACTDisciplinary } = require('./scrapers/actLicences');
const { searchWALicenceRegister } = require('./scrapers/waLicenceRegister');
const { searchTASLicenceRegister } = require('./scrapers/tasLicenceRegister');
const { searchAsicExtract } = require('./scrapers/asicExtract');
const { searchAfsaNpii } = require('./scrapers/afsaNpii');
const { generateLinks } = require('./scrapers/links');
const { startPaymentTimesRefresh } = require('./scrapers/paymentTimesRefresh');
const { startAsicDpnDatasetRefresh } = require('./scrapers/asicDpnDatasetRefresh');

// Fail fast on missing scraper credentials rather than surfacing "missing key"
// errors deep inside individual scraper calls at request time.
for (const key of ['CAPTCHA_API_KEY', 'SCRAPERAPI_KEY']) {
  if (!process.env[key]) {
    console.error(`Fatal: ${key} is not set. Check server/.env.`);
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.WEB_APP_ORIGIN }));
app.use(express.json());

// In-memory store — fine while this process runs as a single instance (per
// CLAUDE.md's run instructions); switch to a Redis-backed store if this ever
// scales horizontally, since counts would no longer be shared across processes.
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// Lightweight manual shape validation — no schema-validation library is used
// anywhere in server/, so this stays consistent with the rest of the codebase
// rather than introducing zod for a single file. Only guards against wrong
// *types* reaching the scrapers (e.g. `directors` as a string would break the
// `.some(Boolean)` / `.map()` calls downstream) — format/checksum validation
// (e.g. ABN checksum) is deliberately left to the scrapers.
function validateSearchFields({ abn, acn, companyName, tradingName, directors }) {
  if (companyName !== undefined && typeof companyName !== 'string') {
    return 'companyName must be a string';
  }
  if (abn !== undefined && typeof abn !== 'string') {
    return 'abn must be a string';
  }
  if (acn !== undefined && typeof acn !== 'string') {
    return 'acn must be a string';
  }
  if (tradingName !== undefined && typeof tradingName !== 'string') {
    return 'tradingName must be a string';
  }
  if (directors !== undefined) {
    if (!Array.isArray(directors) || !directors.every((d) => typeof d === 'string')) {
      return 'directors must be an array of strings';
    }
  }
  return null;
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Redirects to a freshly-signed URL for a QBCC adjudication decision PDF.
// The signed URL itself expires 120s after issue, so it can't be stored in a
// saved report — this must be re-fetched at click time instead.
app.get('/api/qbcc/decision-pdf', async (req, res) => {
  const { fileName } = req.query;
  if (typeof fileName !== 'string' || !/^[0-9_]+\.pdf$/.test(fileName)) {
    return res.status(400).json({ error: 'Invalid fileName' });
  }
  try {
    const signedUrl = await getDecisionSignedUrl(fileName);
    if (!signedUrl) return res.status(404).json({ error: 'Decision document not found' });
    res.redirect(302, signedUrl);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Failed to retrieve decision document' });
  }
});

app.post('/api/search/disambiguate', async (req, res) => {
  const { companyName } = req.body;
  if (!companyName) return res.status(400).json({ error: 'companyName is required', matches: [] });
  if (typeof companyName !== 'string') {
    return res.status(400).json({ error: 'companyName must be a string', matches: [] });
  }
  try {
    const matches = await searchByName(companyName);
    res.json({ matches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed', matches: [] });
  }
});

// Streaming search endpoint — sends results as they arrive
app.post('/api/search', searchLimiter, async (req, res) => {
  const { abn, acn, companyName, tradingName, directors, isDeepCheck } = req.body;

  const shapeError = validateSearchFields({ abn, acn, companyName, tradingName, directors });
  if (shapeError) {
    return res.status(400).json({ error: shapeError });
  }
  if (isDeepCheck !== undefined && typeof isDeepCheck !== 'boolean') {
    return res.status(400).json({ error: 'isDeepCheck must be a boolean' });
  }

  const hasDirectors = Array.isArray(directors) && directors.some(Boolean);
  if (!companyName && !abn && !hasDirectors) {
    return res.status(400).json({ error: 'Company name, ABN, or director name is required' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');

  const send = (result) => res.write(JSON.stringify(result) + '\n');

  // Shared promises so scrapers can reuse results without duplicate HTTP calls
  const abnPromise  = searchABN(abn, companyName, acn);
  const asicPromise = searchASIC(companyName, abn, acn, process.env.CAPTCHA_API_KEY);

  // Returns the best available ABN: request-supplied first, then first ABN scraper result.
  // Safe to call concurrently — all callers await the same promise.
  async function resolveAbn() {
    if (abn) return abn;
    const abnResult = await abnPromise;
    return (abnResult.results ?? [])[0]?.metadata?.ABN?.replace(/\s/g, '') ?? '';
  }

  // Returns ABR-registered business/trading names for this ABN — a sole trader's
  // licence or QBCC adjudication decision is often filed under a business name
  // rather than their personal name.
  async function resolveAlternateNames() {
    const abnResult = await abnPromise;
    return [...new Set([...(abnResult.businessNames ?? []), ...(abnResult.tradingNames ?? [])])];
  }

  // Returns the union of request-supplied directors and those discovered by ASIC.
  // Safe to call concurrently — all callers await the same promise.
  async function resolveDirectors() {
    const asicResult = await asicPromise;
    const asicDirectors = (asicResult.results ?? [])
      .filter((r) => r.metadata?.Role === 'Director')
      .map((r) => r.title)
      .filter(Boolean);
    return [...new Set([...(directors ?? []), ...asicDirectors])];
  }

  // Directors + ABR trading/business names, combined — for scrapers that treat their
  // "extra terms" parameter generically as more names to search under (courtRecords, FWO),
  // not just directors. resolveDirectors/resolveAlternateNames depend on different
  // upstream promises (asicPromise vs abnPromise), so run them concurrently rather than
  // awaiting serially.
  async function resolveExtraSearchTerms() {
    const [directorNames, alternateNames] = await Promise.all([resolveDirectors(), resolveAlternateNames()]);
    return [...new Set([...directorNames, ...alternateNames])];
  }

  const searches = [
    { key: 'abn', label: 'ABR — Business Register', fn: () => abnPromise },
    {
      key: 'asic',
      label: 'ASIC Connect — Company Search',
      fn: () => asicPromise,
    },
    {
      key: 'asicDisqualified',
      label: 'ASIC — Disqualified Persons Register',
      fn: async () => searchASICDisqualifiedFromDataset(await resolveDirectors()),
    },
    {
      key: 'asicInsolvency',
      label: 'ASIC Published Notices — Insolvency',
      fn: () => searchAsicInsolvency(companyName, abn, acn),
    },
    {
      key: 'atoDebt',
      label: 'ASIC Published Notices — ATO Tax Debt',
      fn: () => searchAtoDebt(companyName, abn, acn),
    },
    {
      key: 'courts_federal',
      label: 'Federal Courts',
      fn: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'federal'),
    },
    {
      key: 'courts_qld',
      label: 'QLD Courts & Tribunals',
      fn: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'qld'),
    },
    {
      key: 'courts_nsw',
      label: 'NSW Courts & Tribunals',
      fn: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'nsw'),
    },
    {
      key: 'courts_vic',
      label: 'VIC Courts & Tribunals',
      fn: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'vic'),
    },
    {
      key: 'courts_wa',
      label: 'WA Courts & Tribunals',
      fn: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'wa'),
    },
    {
      key: 'courts_sa',
      label: 'SA Courts & Tribunals',
      fn: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'sa'),
    },
    {
      key: 'courts_nt',
      label: 'NT Courts & Tribunals',
      fn: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'nt'),
    },
    {
      key: 'courts_act',
      label: 'ACT Courts & Tribunals',
      fn: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'act'),
    },
    {
      key: 'courts_tas',
      label: 'TAS Courts & Tribunals',
      fn: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'tas'),
    },
    {
      key: 'paymentTimes',
      label: 'Payment Times Reporting Register',
      fn: async () => searchPaymentTimes(companyName, await resolveAbn(), acn),
    },
    {
      key: 'modernSlavery',
      label: 'Modern Slavery Statements Register',
      fn: () => searchModernSlavery(companyName, abn),
    },
    {
      key: 'qbcc',
      label: 'QBCC — Licence Register',
      fn: async () => searchQBCC(companyName, abn, await resolveDirectors(), await resolveAlternateNames()),
    },
    {
      key: 'fwo',
      label: 'Fair Work Ombudsman — Enforcement Outcomes',
      fn: async () => searchFWO(companyName, abn, await resolveExtraSearchTerms()),
    },
    {
      key: 'vicBpc',
      label: 'VIC Building Authority — Disciplinary Register',
      fn: async () => searchVicBpc(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'vicVbaLicence',
      label: 'VIC Building Authority — Licence Register',
      fn: async () => searchVicVbaLicence(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'waBuildingEnergy',
      label: 'WA Building and Energy — Enforcement',
      fn: async () => searchWABuildingEnergy(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'nswFairTrading',
      label: 'NSW Fair Trading — Contractor Licence Register',
      fn: async () => searchNSWFairTrading(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'ntBuildingPractitioners',
      label: 'NT Building Practitioners Board — Licence Register',
      fn: async () => searchNTBuildingPractitioners(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'actLicences',
      label: 'ACT Access Canberra — Builder Licence Register',
      fn: async () => searchACTLicences(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'actDisciplinary',
      label: 'ACT Access Canberra — Register of Disciplinary Actions',
      fn: async () => searchACTDisciplinary(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'waLicenceRegister',
      label: 'WA Building Services — Contractor Licence Register',
      fn: async () => searchWALicenceRegister(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'tasLicenceRegister',
      label: 'TAS Occupational Licensing — Licence Register',
      fn: async () => searchTASLicenceRegister(companyName, abn, await resolveDirectors(), process.env.CAPTCHA_API_KEY),
    },
    {
      key: 'asicExtract',
      label: 'ASIC — Director Company History',
      fn: async () => searchAsicExtract(companyName, abn, acn, await resolveDirectors(), process.env.CAPTCHA_API_KEY),
    },
    {
      key: 'links',
      label: 'Additional Database Links',
      fn: () => Promise.resolve(generateLinks({ abn, acn, companyName, tradingName, directors })),
    },
  ];

  // Deep check scrapers — only added when isDeepCheck: true
  if (isDeepCheck) {
    searches.push(
      {
        key: 'afsaNpii',
        label: 'AFSA NPII — Director Personal Insolvency (Deep Check)',
        fn: async () => searchAfsaNpii(await resolveDirectors()),
      }
    );
  }

  await Promise.all(
    searches.map(async ({ key, label, fn }) => {
      send({ key, label, status: 'searching' });
      try {
        const result = await fn();
        send({ key, label, status: 'done', ...result });
      } catch (err) {
        console.error(`[${key}]`, err);
        send({ key, label, status: 'error', error: 'Search failed', results: [] });
      }
    })
  );

  res.end();
});

app.listen(PORT, () => console.log(`Know Your Builder server running on http://localhost:${PORT}`));

startPaymentTimesRefresh();
startAsicDpnDatasetRefresh();
