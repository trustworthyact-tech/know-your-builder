// Load server/.env regardless of how this file is launched. `npm start`/`npm run dev`
// already pass --env-file=.env, but CLAUDE.md also documents plain `node index.js`,
// which does not — without this, every scraper that needs an API key (CAPTCHA_API_KEY,
// SCRAPERAPI_KEY) silently sees `undefined` and reports the key as missing.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { searchByName } = require('./scrapers/abn');
const { getDecisionSignedUrl } = require('./scrapers/qbcc');
const { runSearchRequest } = require('./searchOrchestrator');
const { SCRAPERS } = require('./scrapers/manifest');
const scraperHealth = require('./scrapers/scraperHealth');
const healthHistory = require('./scrapers/healthHistory');
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

// Shared gate for every /api/admin/* route below. Fails closed: with no ADMIN_HEALTH_KEY
// set, every admin route refuses to serve rather than being silently open. Not a general
// admin auth system — just enough gate that these aren't public. Returns true/false and
// writes the response itself on failure, so callers can `if (!requireAdminKey(req, res)) return;`.
function requireAdminKey(req, res) {
  const configuredKey = process.env.ADMIN_HEALTH_KEY;
  if (!configuredKey) {
    res.status(503).json({
      error: 'ADMIN_HEALTH_KEY is not set in server/.env — this endpoint is disabled until it is.',
    });
    return false;
  }
  if (req.get('x-admin-key') !== configuredKey) {
    res.status(401).json({ error: 'Missing or incorrect x-admin-key header.' });
    return false;
  }
  return true;
}

// Scraper-health stopgap (reliability plan) — a minimal read of the in-memory circuit
// breaker state (server/scrapers/scraperHealth.js). Fast and sync, still useful for
// scripts/curl. See WS4_IMPLEMENTATION_PLAN.md's 4.5 (runbook) for how to use it.
app.get('/api/admin/scraper-health', (req, res) => {
  if (!requireAdminKey(req, res)) return;
  res.json(scraperHealth.buildHealthReport(SCRAPERS));
});

// WS0.8 (reliability plan) — the real dashboard's data source: the same in-memory snapshot
// as above, merged with persisted 7-day history from health_check_event
// (server/scrapers/healthHistory.js). historyAvailable is false (not a misleading 0%) when
// no DATABASE_URL is configured, e.g. local dev per CLAUDE.md's run instructions.
app.get('/api/admin/scraper-health/full', async (req, res) => {
  if (!requireAdminKey(req, res)) return;

  const report = scraperHealth.buildHealthReport(SCRAPERS);
  const rollup = await healthHistory.getRollup({ windowDays: 7 });
  res.json(healthHistory.mergeHistory(report, rollup));
});

// The reliability dashboard page itself — a static shell with no embedded data (it prompts
// for the admin key client-side and calls /api/admin/scraper-health/full with it), so no
// server-side gate is needed here; the data endpoint above is where ADMIN_HEALTH_KEY is
// actually enforced.
app.get('/admin/scraper-health', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-scraper-health.html'));
});

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

  await runSearchRequest({ abn, acn, companyName, tradingName, directors }, { send });

  res.end();
});

app.listen(PORT, () => console.log(`Know Your Builder server running on http://localhost:${PORT}`));

startPaymentTimesRefresh();
startAsicDpnDatasetRefresh();
// vicBpc is out of launch scope by default (see manifest.js's ENABLED_JURISDICTIONS /
// CLAUDE.md "Launch scope") — its refresh job drives a Cloudflare-clearing Puppeteer
// session every 24h (see vicBpcDataset.js), a real cost with no payoff while nothing
// ever queries the cache it fills. Gated on the manifest's own inScope flag rather than a
// second hardcoded check, so re-enabling VIC (env var + web/lib/scope.ts) also resumes
// this without a further code change. The other three refresh jobs all back
// always-in-scope national/ACT keys, so they stay unconditional.
if (SCRAPERS.find((s) => s.key === 'vicBpc')?.inScope) {
  startVicBpcDatasetRefresh();
}
startAsicEuDatasetRefresh();
startActLicencesDatasetRefresh();
