// Load server/.env regardless of how this file is launched. `npm start`/`npm run dev`
// already pass --env-file=.env, but CLAUDE.md also documents plain `node index.js`,
// which does not — without this, every scraper that needs an API key (CAPTCHA_API_KEY,
// SCRAPERAPI_KEY) silently sees `undefined` and reports the key as missing.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { searchABN, searchByName } = require('./scrapers/abn');
const { searchCourtRecords, buildManualFallback } = require('./scrapers/courtRecords');
const { getScraper } = require('./scrapers/manifest');
const { runScraper, withTimeout } = require('./scrapers/runScraper');
const scraperHealth = require('./scrapers/scraperHealth');
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
const { searchNSWFairTrading, fetchNswCompanyLookup } = require('./scrapers/nswFairTrading');
const { searchNTBuildingPractitioners } = require('./scrapers/ntBuildingPractitioners');
const { searchACTLicences, searchACTDisciplinary, resolveActAssociatedNames } = require('./scrapers/actLicences');
const { searchWALicenceRegister } = require('./scrapers/waLicenceRegister');
const { searchTASLicenceRegister } = require('./scrapers/tasLicenceRegister');
const { searchAsicExtract } = require('./scrapers/asicExtract');
const { searchAsicEnforceableUndertakings } = require('./scrapers/asicEnforceableUndertakings');
const { startPaymentTimesRefresh } = require('./scrapers/paymentTimesRefresh');
const { startAsicDpnDatasetRefresh } = require('./scrapers/asicDpnDatasetRefresh');
const { startVicBpcDatasetRefresh } = require('./scrapers/vicBpcDatasetRefresh');
const { startAsicEuDatasetRefresh } = require('./scrapers/asicEnforceableUndertakingsDatasetRefresh');
const { startActLicencesDatasetRefresh } = require('./scrapers/actLicencesDatasetRefresh');

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

  // WS3 (reliability plan) — director discovery via NSW/ACT's own licence registers, a free
  // substitute for ASIC's own officer data (its DSP application path is paused until 2027 —
  // see CLAUDE.md's WS3 entries; the ASIC-backed path resolveDirectors() used to attempt is
  // still broken/unavailable, not just deprioritised). Hoisted once here, same pattern as
  // abnPromise/asicPromise above, so every one of resolveDirectors()'s 13 consumers shares a
  // single lookup instead of each triggering its own. NSW is a live HTTP call, so it's bounded
  // by withTimeout and fails open (empty result, not a rejection) — a slow or down NSW
  // register must never block the other 12 scrapers, which is exactly the class of problem
  // the 2026-09-08 ASIC-dependency removal fixed for this same function; reintroducing an
  // unbounded network dependency here would undo that fix. ACT reads an already-local dataset
  // cache (WS1), so resolveActAssociatedNames only needs a fail-open catch, not a timeout.
  const nswDirectorDiscoveryPromise = withTimeout(fetchNswCompanyLookup(companyName), 20_000).catch(
    () => ({ items: [], associatedNames: [], seen: new Set() })
  );
  const actDirectorDiscoveryPromise = resolveActAssociatedNames(companyName).catch(() => []);

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

  // Merges request-supplied director names with what NSW/ACT's own licence registers surface
  // for this company (see nswDirectorDiscoveryPromise/actDirectorDiscoveryPromise above).
  // Deliberately still a flat string[] — the 13 consumers of this function are unchanged by
  // WS3, only what feeds them got richer. Source/role (Director vs Nominated Supervisor vs
  // Partner vs Nominee — not all equally confident) is preserved separately in each
  // discovering scraper's own result metadata (nswFairTrading.js, actLicences.js) rather than
  // threaded through here, so a report can show provenance without a wider signature change.
  //
  // History: this was a pure ASIC pass-through until 2026-08-13, deprecated to a bare
  // request-supplied-only stub on 2026-09-08 after ASIC Connect's director extraction was
  // confirmed broken and was serializing 13+ scrapers behind its captcha-gated flow for a
  // lookup that reliably returned nothing anyway (see CLAUDE.md's "resolveDirectors() is
  // currently starved" entries). NSW/ACT licence data reopens automated discovery without
  // reintroducing that dependency — see CLAUDE.md's WS3 entries for the full record.
  async function resolveDirectors() {
    const [nswPrimary, actAssociated] = await Promise.all([
      nswDirectorDiscoveryPromise,
      actDirectorDiscoveryPromise,
    ]);
    const discovered = [
      ...nswPrimary.associatedNames.map((a) => a.name),
      ...actAssociated.map((a) => a.name),
    ];
    return [...new Set([...(directors ?? []), ...discovered])];
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

  // WS3 (reliability plan) — marks a director-dependent result as completeness: 'partial'
  // when resolveDirectors() found nothing at all (neither typed nor NSW/ACT-discovered) to
  // search under, so a report can tell "checked the company name only" apart from "also
  // searched under N director name(s)" instead of both rendering identically as a complete
  // check. Never downgrades a result that already set its own more specific completeness
  // (e.g. courtRecords.js's own 'unavailable'/'partial' from a failed/retried live search,
  // or buildManualFallback's 'unavailable') — this only fills in the case that would
  // otherwise default to 'complete' with no signal that director coverage was actually zero.
  function markPartialIfNoDirectors(result, directorCount) {
    if (directorCount > 0) return result;
    if (result.completeness && result.completeness !== 'complete') return result;
    return {
      ...result,
      completeness: 'partial',
      summary: `${result.summary} (no director names available to search under)`,
    };
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
      fn: async () => {
        const [dirs, terms] = await Promise.all([resolveDirectors(), resolveExtraSearchTerms()]);
        return markPartialIfNoDirectors(await searchCourtRecords(companyName, terms, 'federal'), dirs.length);
      },
    },
    {
      key: 'courts_qld',
      label: 'QLD Courts & Tribunals',
      fn: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'qld'),
    },
    {
      key: 'courts_nsw',
      label: 'NSW Courts & Tribunals',
      fn: async () => {
        const [dirs, terms] = await Promise.all([resolveDirectors(), resolveExtraSearchTerms()]);
        return markPartialIfNoDirectors(await searchCourtRecords(companyName, terms, 'nsw'), dirs.length);
      },
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
      fn: async () => {
        const [dirs, terms] = await Promise.all([resolveDirectors(), resolveExtraSearchTerms()]);
        return markPartialIfNoDirectors(await searchCourtRecords(companyName, terms, 'act'), dirs.length);
      },
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
      // Reuses nswDirectorDiscoveryPromise's already-fetched company-name query instead of
      // re-running it — see fetchNswCompanyLookup's doc comment in nswFairTrading.js.
      fn: async () => {
        const dirs = await resolveDirectors();
        const result = await searchNSWFairTrading(companyName, abn, dirs, await nswDirectorDiscoveryPromise);
        return markPartialIfNoDirectors(result, dirs.length);
      },
    },
    {
      key: 'ntBuildingPractitioners',
      label: 'NT Building Practitioners Board — Licence Register',
      fn: async () => searchNTBuildingPractitioners(companyName, abn, await resolveDirectors()),
    },
    {
      key: 'actLicences',
      label: 'ACT Access Canberra — Builder Licence Register',
      fn: async () => {
        const dirs = await resolveDirectors();
        return markPartialIfNoDirectors(await searchACTLicences(companyName, abn, dirs), dirs.length);
      },
    },
    {
      key: 'actDisciplinary',
      label: 'ACT Access Canberra — Register of Disciplinary Actions',
      fn: async () => {
        const dirs = await resolveDirectors();
        return markPartialIfNoDirectors(await searchACTDisciplinary(companyName, abn, dirs), dirs.length);
      },
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
      key: 'asicEnforceableUndertakings',
      label: 'ASIC — Court Enforceable Undertakings Register',
      fn: async () => searchAsicEnforceableUndertakings(companyName, await resolveDirectors()),
    },
  ];

  // WS2 (reliability plan) — these keys are routed through the shared timeout + circuit
  // breaker wrapper (server/scrapers/runScraper.js) instead of the plain try/catch below.
  // Deliberately an explicit allowlist rather than every key in `searches`: the other
  // buckets (dataset/manual-link/CAPTCHA scrapers) haven't individually been verified
  // against this wrapper yet — that's WS1/WS3/WS4.1's job, not this one's. Every key here
  // has a matching entry in server/scrapers/manifest.js.
  const RUN_SCRAPER_KEYS = new Set([
    'nswFairTrading',
    'courts_nsw',
    'courts_federal',
    'courts_act',
    'asic',
    'asicInsolvency',
    'asicExtract',
    'fwo',
    'atoDebt',
  ]);

  await Promise.all(
    searches.map(async ({ key, label, fn }) => {
      if (RUN_SCRAPER_KEYS.has(key)) {
        // ACT Courts is the one live check with a real manual-link fallback (see
        // courtRecords.js's buildManualFallback) — on an open circuit, degrade to that
        // instead of runScraper's generic "unavailable" message, so a homeowner always
        // has a usable path for this jurisdiction (reliability plan Constraint 1).
        // The half-open trial call (isOpen() false right after cooldown) is intentionally
        // not intercepted here — it goes through runScraper like a normal call so recovery
        // can actually be detected.
        if (key === 'courts_act' && scraperHealth.isOpen(key)) {
          send({ key, label, completeness: 'unavailable', ...buildManualFallback('act') });
          return;
        }
        await runScraper(getScraper(key), fn, { send });
        return;
      }

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
startVicBpcDatasetRefresh();
startAsicEuDatasetRefresh();
startActLicencesDatasetRefresh();
