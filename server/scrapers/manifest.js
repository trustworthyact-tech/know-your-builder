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
  // timeoutMs raised 10_000 -> 45_000 (2026-10-02): still genuinely bucket 1/bulk-dataset —
  // this key's own register read is a fast in-process lookup (see asicDpnDataset.js's
  // memCache) — but searchOrchestrator.js's invocation closure awaits resolveDirectors()
  // first, which can wait up to 20s on the shared live NSW lookup (nswDirectorDiscoveryPromise)
  // — the same dependency that already justified a 45_000+ budget for
  // courts_federal/courts_nsw/courts_act/fwo/nswFairTrading below. This key shares that exact
  // dependency but was left at bucket-1's default 10s, which left no margin for a slow NSW
  // response even before the register read happened — confirmed live: a real request timed
  // out here even after the memCache fix landed, while sharing resolveDirectors() with
  // asicEnforceableUndertakings (below, same fix) which timed out in the same request.
  { key: 'asicDisqualified', label: 'ASIC — Disqualified Persons Register', jurisdiction: 'national', bucket: 1, sourceType: 'bulk-dataset', cadence: '12h', timeoutMs: 45_000, mvpScope: true },
  // timeoutMs raised twice on 2026-09-15 (see CLAUDE.md's "ASIC Insolvency" incomplete-work
  // entry for the full investigation): 20s → 60s once the ASP.NET/WAF-gated multi-step form
  // itself was measured at ~28s standalone; 60s → 120s once real concurrent-search-load
  // testing (after fixing a separate navigation-race bug) showed this same flow taking up
  // to 94.8s under realistic Puppeteer-pool contention — not queueing (it got a page slot
  // immediately every time tested) but the shared browser's per-page execution genuinely
  // slowing down under concurrent load. Reclassified bucket 2 → 4 ("otherwise slow/
  // fragile") to match. Still not fully reliable even at 120s — see the CLAUDE.md entry.
  { key: 'asicInsolvency', label: 'ASIC Published Notices — Insolvency', jurisdiction: 'national', bucket: 4, sourceType: 'live-source', cadence: null, timeoutMs: 120_000, mvpScope: true },
  // timeoutMs was 20_000, bucket 2 — found live 2026-09-23 (the same "Morris Property
  // Group" investigation that fixed fwo): this scraper shares asicInsolvency.js's exact
  // WAF-gated ASP.NET-postback mechanism against the same site
  // (publishednotices.asic.gov.au) but never got that file's 2026-09-15 navigation-race
  // fix or its resulting bucket-4/120s timeout bump — moved to bucket 4 / 120_000 to
  // match, same reasoning (WAF-clearing + form fill + postback + possible archived-results
  // second navigation legitimately costs real time on a warm shared browser, and this
  // mechanism's own history shows wide variance under load).
  { key: 'atoDebt', label: 'ASIC Published Notices — ATO Tax Debt', jurisdiction: 'national', bucket: 4, sourceType: 'live-source', cadence: null, timeoutMs: 120_000, mvpScope: true },
  { key: 'courts_federal', label: 'Federal Courts', jurisdiction: 'national', bucket: 2, sourceType: 'live-fulltext-search', cadence: null, timeoutMs: 45_000, mvpScope: true },
  { key: 'courts_qld', label: 'QLD Courts & Tribunals', jurisdiction: 'qld', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'courts_nsw', label: 'NSW Courts & Tribunals', jurisdiction: 'nsw', bucket: 2, sourceType: 'live-fulltext-search', cadence: null, timeoutMs: 45_000, mvpScope: true },
  { key: 'courts_vic', label: 'VIC Courts & Tribunals', jurisdiction: 'vic', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'courts_wa', label: 'WA Courts & Tribunals', jurisdiction: 'wa', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'courts_sa', label: 'SA Courts & Tribunals', jurisdiction: 'sa', bucket: 3, sourceType: 'manual-link', cadence: null, timeoutMs: 10_000, mvpScope: false },
  { key: 'courts_nt', label: 'NT Courts & Tribunals', jurisdiction: 'nt', bucket: 2, sourceType: 'live-fulltext-search', cadence: null, timeoutMs: 45_000, mvpScope: false },
  // timeoutMs was 45_000 — live-measured 2026-09-15 (see CLAUDE.md): with the per-term
  // loop now concurrent (courtRecords.js), 3 terms through the proxy measured ~16-20s; 60s
  // keeps a margin for the proxy's response-time variance. Since 2026-10-06 this value also
  // drives courts_act's internal deadline (searchOrchestrator.js derives it from here), so
  // the ACT/ACAT fetches cap themselves to fit inside it and return an honest partial
  // result instead of being discarded by runScraper's timeout. Proxy is now ScrapeOps
  // (ScraperAPI's credits ran out 2026-09-23 — see courtRecords.js's viaProxy).
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
  // timeoutMs was 20_000 — found live 2026-09-23 (a real "Morris Property Group" search):
  // fairwork.gov.au (Akamai-fronted) was actively blocking Railway's IP with an instant
  // HTTP/2 stream reset; fixed by routing through the ScrapeOps proxy (see fwo.js's
  // viaProxy). Even fixed, fetchFwoResults' own retry (2 attempts x 20s axios timeout)
  // means a single term can legitimately take up to 40s in the worst case — raised to
  // 45_000 for real margin, matching courts_act/nswFairTrading's identical reasoning.
  { key: 'fwo', label: 'Fair Work Ombudsman — Enforcement Outcomes', jurisdiction: 'national', bucket: 2, sourceType: 'live-scrape', cadence: null, timeoutMs: 45_000, mvpScope: true },
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
  // timeoutMs raised 20_000 -> 45_000 (2026-10-06), still bucket 1 — same fix as
  // asicDisqualified/asicEnforceableUndertakings (2026-10-02): both invocation closures
  // await resolveDirectors() before their own register read, and that waits on the NSW
  // director lookup (bounded at 20s by itself — the whole old budget) plus ACT's own
  // director discovery. Both timed out at exactly 20s in the same production request;
  // live-measured from the Railway container, NSW alone took 3.5-7.7s with no other load.
  // Matches every other resolveDirectors()-dependent key's 45s budget.
  { key: 'actLicences', label: 'ACT Access Canberra — Builder Licence Register', jurisdiction: 'act', bucket: 1, sourceType: 'open-data-api', cadence: null, timeoutMs: 45_000, mvpScope: true },
  { key: 'actDisciplinary', label: 'ACT Access Canberra — Register of Disciplinary Actions', jurisdiction: 'act', bucket: 1, sourceType: 'open-data-api', cadence: null, timeoutMs: 45_000, mvpScope: true },
  { key: 'waLicenceRegister', label: 'WA Building Services — Contractor Licence Register', jurisdiction: 'wa', bucket: 4, sourceType: 'live-scrape-captcha', cadence: null, timeoutMs: 90_000, mvpScope: false },
  { key: 'tasLicenceRegister', label: 'TAS Occupational Licensing — Licence Register', jurisdiction: 'tas', bucket: 4, sourceType: 'live-scrape-captcha', cadence: null, timeoutMs: 90_000, mvpScope: false },
  { key: 'asicExtract', label: 'ASIC — Director Company History', jurisdiction: 'national', bucket: 4, sourceType: 'live-scrape-captcha', cadence: null, timeoutMs: 90_000, mvpScope: true },
  // timeoutMs raised 10_000 -> 45_000 (2026-10-02), still bucket 1 — same reasoning as
  // asicDisqualified above: this key's invocation closure also awaits resolveDirectors()
  // before its own (now fast, memCache'd) register read, and shares the exact same
  // 20s-bounded live NSW dependency that justifies every other resolveDirectors()
  // consumer's 45_000+ budget.
  { key: 'asicEnforceableUndertakings', label: 'ASIC — Court Enforceable Undertakings Register', jurisdiction: 'national', bucket: 1, sourceType: 'static-page-dataset', cadence: '24h', timeoutMs: 45_000, mvpScope: true },
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
