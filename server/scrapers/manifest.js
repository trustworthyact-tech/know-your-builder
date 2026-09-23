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

// Temporary, reversible decommissioning — found live 2026-09-15: waLicenceRegister and
// tasLicenceRegister are both CAPTCHA-gated with 90s budgets, and (per their own history
// in CLAUDE.md) observed holding a Puppeteer page slot anywhere from 33s to 120s+ per
// solve — the two longest, least predictable consumers of browser.js's shared page pool.
// Under real concurrent search load this was starving the MVP-scope scrapers that also
// need that pool (asicInsolvency, courts_federal, atoDebt), which is a materially worse
// outcome than these two non-MVP checks themselves being briefly unavailable.
//
// `enabled` below was a dead field before this — present on every SCRAPERS entry but
// never read anywhere. This wires it to a comma-separated env var instead of a hardcoded
// per-entry value so it can be toggled by a Railway variable change + restart, not a code
// change + PR + deploy each time (same operational shape as PUPPETEER_MAX_CONCURRENT_
// PAGES). searchOrchestrator.js skips invoking a disabled key entirely and sends an
// honest `completeness: 'unavailable'` result — never a silently-empty "checked, clean"
// one, matching this codebase's convention everywhere else a check can't run.
const DISABLED_SCRAPER_KEYS = new Set(
  (process.env.DISABLED_SCRAPER_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
);

// Launch scope (2026-09): Know Your Builder is released covering national registers plus
// NSW and ACT courts/licensing only — see CLAUDE.md "Launch scope". This is a distinct
// concept from `mvpScope` above (which decides breaker/timeout routing) even though they
// happen to select the same 16 keys today — `inScope` decides whether a key is invoked at
// all. Every jurisdiction outside this set keeps its full, working scraper file; nothing
// is deleted. `ENABLED_JURISDICTIONS` is env-var-driven (same operational shape as
// DISABLED_SCRAPER_KEYS/PUPPETEER_MAX_CONCURRENT_PAGES above) so re-enabling a state for a
// future release is a Railway variable change, not a code change — though the web side
// (web/lib/scope.ts) also needs updating to match, since it independently filters what the
// live progress list and report UI expect to see.
//
// Deliberately jurisdiction-based, not key-based like DISABLED_SCRAPER_KEYS: an
// out-of-scope key here is a permanent (for this release), planned absence — reported
// honestly by never streaming a result for it at all — not a temporary/reversible
// single-key decommission due to an operational problem. Conflating the two would mean a
// state re-enable and an incident-driven disable read identically in the report.
const ENABLED_JURISDICTIONS = new Set(
  (process.env.ENABLED_JURISDICTIONS || 'national,nsw,act')
    .split(',')
    .map((j) => j.trim())
    .filter(Boolean)
);

const SCRAPERS = [
  { key: 'abn', label: 'ABR — Business Register', jurisdiction: 'national', bucket: 2, sourceType: 'live-api', cadence: null, timeoutMs: 20_000, mvpScope: true },
  { key: 'asic', label: 'ASIC Connect — Company Search', jurisdiction: 'national', bucket: 4, sourceType: 'live-scrape-captcha', cadence: null, timeoutMs: 90_000, mvpScope: true },
  { key: 'asicDisqualified', label: 'ASIC — Disqualified Persons Register', jurisdiction: 'national', bucket: 1, sourceType: 'bulk-dataset', cadence: '12h', timeoutMs: 10_000, mvpScope: true },
  // timeoutMs raised twice on 2026-09-15 (see CLAUDE.md's "ASIC Insolvency" incomplete-work
  // entry for the full investigation): 20s → 60s once the ASP.NET/WAF-gated multi-step form
  // itself was measured at ~28s standalone; 60s → 120s once real concurrent-search-load
  // testing (after fixing a separate navigation-race bug) showed this same flow taking up
  // to 94.8s under realistic Puppeteer-pool contention — not queueing (it got a page slot
  // immediately every time tested) but the shared browser's per-page execution genuinely
  // slowing down under concurrent load. Reclassified bucket 2 → 4 ("otherwise slow/
  // fragile") to match. Still not fully reliable even at 120s — see the CLAUDE.md entry.
  { key: 'asicInsolvency', label: 'ASIC Published Notices — Insolvency', jurisdiction: 'national', bucket: 4, sourceType: 'live-source', cadence: null, timeoutMs: 120_000, mvpScope: true },
  { key: 'atoDebt', label: 'ASIC Published Notices — ATO Tax Debt', jurisdiction: 'national', bucket: 2, sourceType: 'live-source', cadence: null, timeoutMs: 20_000, mvpScope: true },
  { key: 'courts_federal', label: 'Federal Courts', jurisdiction: 'national', bucket: 2, sourceType: 'live-fulltext-search', cadence: null, timeoutMs: 45_000, mvpScope: true },
  { key: 'courts_qld', label: 'QLD Courts & Tribunals', jurisdiction: 'qld', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'courts_nsw', label: 'NSW Courts & Tribunals', jurisdiction: 'nsw', bucket: 2, sourceType: 'live-fulltext-search', cadence: null, timeoutMs: 45_000, mvpScope: true },
  { key: 'courts_vic', label: 'VIC Courts & Tribunals', jurisdiction: 'vic', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'courts_wa', label: 'WA Courts & Tribunals', jurisdiction: 'wa', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'courts_sa', label: 'SA Courts & Tribunals', jurisdiction: 'sa', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'courts_nt', label: 'NT Courts & Tribunals', jurisdiction: 'nt', bucket: 2, sourceType: 'live-fulltext-search', cadence: null, timeoutMs: 45_000, mvpScope: false },
  // timeoutMs was 45_000 — live-measured 2026-09-15 (see CLAUDE.md): with the per-term
  // loop now concurrent (courtRecords.js), 3 terms through ScraperAPI's proxy measured
  // ~16-20s each dominating factor; 60s keeps a real margin for ScraperAPI's own
  // response-time variance rather than sitting right at the edge.
  { key: 'courts_act', label: 'ACT Courts & Tribunals', jurisdiction: 'act', bucket: 2, sourceType: 'live-fulltext-search-proxy', cadence: null, timeoutMs: 60_000, mvpScope: true },
  { key: 'courts_tas', label: 'TAS Courts & Tribunals', jurisdiction: 'tas', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'paymentTimes', label: 'Payment Times Reporting Register', jurisdiction: 'national', bucket: 1, sourceType: 'bulk-dataset', cadence: '8h', timeoutMs: 10_000, mvpScope: true },
  // bucket 2 / live-scrape / 20s, NOT bucket 1 — modernSlavery.js is a plain live axios+cheerio
  // scrape (see CLAUDE.md's WS1.4 entry: bulk ingestion for this register was investigated and
  // explicitly decided against — "modernSlavery.js stays exactly as it is — live per-query
  // scrape, no caching"). This entry previously claimed bucket 1/bulk-dataset/10s, which doesn't
  // match the real code — found during the WS4 reliability-plan audit (2026-09-10): with
  // mvpScope:true routing this through runScraper(), the wrong 10s timeout (meant for a local
  // dataset lookup) was being enforced against a real live HTTP fetch, which needs the
  // live-call default of 20s like every other bucket-2 entry.
  { key: 'modernSlavery', label: 'Modern Slavery Statements Register', jurisdiction: 'national', bucket: 2, sourceType: 'live-scrape', cadence: null, timeoutMs: 20_000, mvpScope: true },
  { key: 'qbcc', label: 'QBCC — Licence Register', jurisdiction: 'qld', bucket: 2, sourceType: 'live-api', cadence: null, timeoutMs: 20_000, mvpScope: false },
  { key: 'fwo', label: 'Fair Work Ombudsman — Enforcement Outcomes', jurisdiction: 'national', bucket: 2, sourceType: 'live-scrape', cadence: null, timeoutMs: 20_000, mvpScope: true },
  { key: 'vicBpc', label: 'VIC Building Authority — Disciplinary Register', jurisdiction: 'vic', bucket: 1, sourceType: 'bulk-dataset', cadence: '24h', timeoutMs: 10_000, mvpScope: false },
  { key: 'vicVbaLicence', label: 'VIC Building Authority — Licence Register', jurisdiction: 'vic', bucket: 2, sourceType: 'live-api', cadence: null, timeoutMs: 20_000, mvpScope: false },
  { key: 'waBuildingEnergy', label: 'WA Building and Energy — Enforcement', jurisdiction: 'wa', bucket: 2, sourceType: 'live-scrape', cadence: null, timeoutMs: 20_000, mvpScope: false },
  // timeoutMs was 20_000 — live-measured 2026-09-23 (see CLAUDE.md, the ScraperAPI->ScrapeOps
  // migration): the full flow (fetchNswCompanyLookup's Phase A lookup, then
  // searchNSWFairTrading's sequential per-director enrichment loop — 1 licence search +
  // 1 licence-details fetch per director, each round-tripping through the ScrapeOps proxy)
  // took 16.6s in an isolated, uncontended test — already razor-thin against a 20s budget —
  // and a real production request (multiple scrapers competing for the same proxy's
  // concurrency limit) timed out outright. Not a correctness bug: the isolated run found
  // real data (licence 85273C, director, compliance history) correctly. Raised to 45_000,
  // matching courts_federal's bucket-2 budget for a comparable multi-round-trip live case.
  { key: 'nswFairTrading', label: 'NSW Fair Trading — Contractor Licence Register', jurisdiction: 'nsw', bucket: 2, sourceType: 'live-api', cadence: null, timeoutMs: 45_000, mvpScope: true },
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
  enabled: !DISABLED_SCRAPER_KEYS.has(entry.key),
  inScope: ENABLED_JURISDICTIONS.has(entry.jurisdiction),
}));

const byKey = new Map(SCRAPERS.map((s) => [s.key, s]));

function getScraper(key) {
  return byKey.get(key);
}

module.exports = { SCRAPERS, getScraper, DEFAULT_BREAKER };
