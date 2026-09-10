'use strict';

// One entry per key currently in server/searchOrchestrator.js's scraper list and
// web/app/search/SearchContent.tsx's `INITIAL_SEARCHES` — metadata only. Invocation
// closures (which need bespoke per-scraper argument wiring: companyName/abn/acn/directors/
// alternateNames in varying combinations) live in server/searchOrchestrator.js, keyed by
// `key` — this file stays metadata-only (WS4.1, reliability plan: mvpScope keys are now
// routed through runScraper() using that mapping; see WS4_IMPLEMENTATION_PLAN.md).
//
// Bucket taxonomy (inferred from the reliability-plan artifact's inventory table, made
// explicit here since the artifact never defined it in code):
//   1 = bulk/cached dataset      2 = live API or scrape, no CAPTCHA
//   3 = manual-link-only         4 = live + CAPTCHA, or otherwise slow/fragile
//
// timeoutMs defaults by bucket (overridden per-entry where a specific latency is
// documented in CLAUDE.md): bucket 1 = 10s (local/DB lookup), bucket 2 = 20s (plain
// live call), bucket 2 via Puppeteer/proxy = 45s, bucket 4 (CAPTCHA) = 90s (CAPTCHA
// solves observed 33s–120s+ in production per CLAUDE.md's asicDisqualified history).
//
// mvpScope (added WS4.1, reliability plan): true for the ~16 NSW/ACT/national checks the
// reliability plan's Constraint 1/2 scoped the MVP to — these are the keys
// server/searchOrchestrator.js routes through runScraper()/the circuit breaker. The
// remaining keys (QLD/VIC/WA/SA/TAS/NT state registers, mostly built after the reliability
// plan was drafted — see CLAUDE.md's "Incomplete work" log) are false: still live, still
// served on every search, just not yet brought under the manifest-driven breaker. This is
// a deliberate scope decision recorded in WS4_IMPLEMENTATION_PLAN.md, not a regression —
// extending mvpScope to the rest is real future work ("WS4.1b").

const DEFAULT_BREAKER = { failureThreshold: 5, cooldownMs: 5 * 60_000 };

const SCRAPERS = [
  { key: 'abn', label: 'ABR — Business Register', jurisdiction: 'national', bucket: 2, sourceType: 'live-api', cadence: null, timeoutMs: 20_000, mvpScope: true },
  { key: 'asic', label: 'ASIC Connect — Company Search', jurisdiction: 'national', bucket: 4, sourceType: 'live-scrape-captcha', cadence: null, timeoutMs: 90_000, mvpScope: true },
  { key: 'asicDisqualified', label: 'ASIC — Disqualified Persons Register', jurisdiction: 'national', bucket: 1, sourceType: 'bulk-dataset', cadence: '12h', timeoutMs: 10_000, mvpScope: true },
  { key: 'asicInsolvency', label: 'ASIC Published Notices — Insolvency', jurisdiction: 'national', bucket: 2, sourceType: 'live-source', cadence: null, timeoutMs: 20_000, mvpScope: true },
  { key: 'atoDebt', label: 'ASIC Published Notices — ATO Tax Debt', jurisdiction: 'national', bucket: 2, sourceType: 'live-source', cadence: null, timeoutMs: 20_000, mvpScope: true },
  { key: 'courts_federal', label: 'Federal Courts', jurisdiction: 'national', bucket: 2, sourceType: 'live-fulltext-search', cadence: null, timeoutMs: 45_000, mvpScope: true },
  { key: 'courts_qld', label: 'QLD Courts & Tribunals', jurisdiction: 'qld', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'courts_nsw', label: 'NSW Courts & Tribunals', jurisdiction: 'nsw', bucket: 2, sourceType: 'live-fulltext-search', cadence: null, timeoutMs: 45_000, mvpScope: true },
  { key: 'courts_vic', label: 'VIC Courts & Tribunals', jurisdiction: 'vic', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'courts_wa', label: 'WA Courts & Tribunals', jurisdiction: 'wa', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'courts_sa', label: 'SA Courts & Tribunals', jurisdiction: 'sa', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'courts_nt', label: 'NT Courts & Tribunals', jurisdiction: 'nt', bucket: 2, sourceType: 'live-fulltext-search', cadence: null, timeoutMs: 45_000, mvpScope: false },
  { key: 'courts_act', label: 'ACT Courts & Tribunals', jurisdiction: 'act', bucket: 2, sourceType: 'live-fulltext-search-proxy', cadence: null, timeoutMs: 45_000, mvpScope: true },
  { key: 'courts_tas', label: 'TAS Courts & Tribunals', jurisdiction: 'tas', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'paymentTimes', label: 'Payment Times Reporting Register', jurisdiction: 'national', bucket: 1, sourceType: 'bulk-dataset', cadence: '8h', timeoutMs: 10_000, mvpScope: true },
  { key: 'modernSlavery', label: 'Modern Slavery Statements Register', jurisdiction: 'national', bucket: 1, sourceType: 'bulk-dataset', cadence: '24h', timeoutMs: 10_000, mvpScope: true },
  { key: 'qbcc', label: 'QBCC — Licence Register', jurisdiction: 'qld', bucket: 2, sourceType: 'live-api', cadence: null, timeoutMs: 20_000, mvpScope: false },
  { key: 'fwo', label: 'Fair Work Ombudsman — Enforcement Outcomes', jurisdiction: 'national', bucket: 2, sourceType: 'live-scrape', cadence: null, timeoutMs: 20_000, mvpScope: true },
  { key: 'vicBpc', label: 'VIC Building Authority — Disciplinary Register', jurisdiction: 'vic', bucket: 1, sourceType: 'bulk-dataset', cadence: '24h', timeoutMs: 10_000, mvpScope: false },
  { key: 'vicVbaLicence', label: 'VIC Building Authority — Licence Register', jurisdiction: 'vic', bucket: 2, sourceType: 'live-api', cadence: null, timeoutMs: 20_000, mvpScope: false },
  { key: 'waBuildingEnergy', label: 'WA Building and Energy — Enforcement', jurisdiction: 'wa', bucket: 2, sourceType: 'live-scrape', cadence: null, timeoutMs: 20_000, mvpScope: false },
  { key: 'nswFairTrading', label: 'NSW Fair Trading — Contractor Licence Register', jurisdiction: 'nsw', bucket: 2, sourceType: 'live-api', cadence: null, timeoutMs: 20_000, mvpScope: true },
  { key: 'ntBuildingPractitioners', label: 'NT Building Practitioners Board — Licence Register', jurisdiction: 'nt', bucket: 2, sourceType: 'live-scrape', cadence: null, timeoutMs: 20_000, mvpScope: false },
  { key: 'actLicences', label: 'ACT Access Canberra — Builder Licence Register', jurisdiction: 'act', bucket: 1, sourceType: 'open-data-api', cadence: null, timeoutMs: 20_000, mvpScope: true },
  { key: 'actDisciplinary', label: 'ACT Access Canberra — Register of Disciplinary Actions', jurisdiction: 'act', bucket: 1, sourceType: 'open-data-api', cadence: null, timeoutMs: 20_000, mvpScope: true },
  { key: 'waLicenceRegister', label: 'WA Building Services — Contractor Licence Register', jurisdiction: 'wa', bucket: 4, sourceType: 'live-scrape-captcha', cadence: null, timeoutMs: 90_000, mvpScope: false },
  { key: 'tasLicenceRegister', label: 'TAS Occupational Licensing — Licence Register', jurisdiction: 'tas', bucket: 4, sourceType: 'live-scrape-captcha', cadence: null, timeoutMs: 90_000, mvpScope: false },
  { key: 'asicExtract', label: 'ASIC — Director Company History', jurisdiction: 'national', bucket: 4, sourceType: 'live-scrape-captcha', cadence: null, timeoutMs: 90_000, mvpScope: true },
  { key: 'asicEnforceableUndertakings', label: 'ASIC — Court Enforceable Undertakings Register', jurisdiction: 'national', bucket: 1, sourceType: 'static-page-dataset', cadence: '24h', timeoutMs: 10_000, mvpScope: true },
].map((entry) => ({
  ...entry,
  breaker: DEFAULT_BREAKER,
  enabled: true,
}));

const byKey = new Map(SCRAPERS.map((s) => [s.key, s]));

function getScraper(key) {
  return byKey.get(key);
}

module.exports = { SCRAPERS, getScraper, DEFAULT_BREAKER };
