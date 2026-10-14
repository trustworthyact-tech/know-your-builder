# Data sources — audit and reliability plan (drafted 2026-10-12)

Replaces an earlier same-day draft that covered only the three proxy-backed checks. This plan
audits the **16 MVP sources** (`mvpScope: true` in `server/scrapers/manifest.js`: national
registers plus NSW and ACT). For each source it records whether it is working as well as it
could, and the best way to get the data if not. It also sets the order in which sources
should be searched so that each one gets the best possible inputs. Findings about the 13
out-of-scope sources, gathered during the same audit, are listed briefly at the end for
when those states are re-enabled.

Evidence used (2026-10-12):
- the production health endpoint (`/api/admin/scraper-health/full`, 7 days, about 19 runs per key);
- the latest daily `register-health-check` CI run (2026-10-11);
- production logs from the last 10 deployments;
- the ScrapeOps account endpoint;
- a code read of every scraper and of `searchOrchestrator.js`;
- web research on alternative data sources.

Items marked **(verify)** are leads that haven't been confirmed against the live source yet.

## Target

For every in-scope source, over a rolling 7 days:
- **≥95% of searches finish `completeness: 'complete'`**;
- **no false clean results**: a fetch that failed or was blocked is never shown as
  "checked, found nothing";
- recurring cost under about $30/month at 1,000 searches/month;
- **public data only.** Every source is publicly available. Paying for infrastructure to
  reach public data (proxy bandwidth, CAPTCHA solving, hosting) is acceptable; paying for the
  data itself (ASIC paid extracts, InfoTrack, CreditorWatch and similar brokers) is not, and
  is excluded from this plan. Where no public source exists, the plan records a gap.

The dashboard's current `successRate7d` can't measure this. It counts a `partial` result as
a success, and it counts "returned without error" as success even when the result is useless
(`asic` shows 95% but hasn't returned a director in months).

## Main finding

Most of the unreliable sources search a live government site **while the user waits**,
through a proxy or a headless browser. But for several of them, the code only ever matches on
the record's title or summary, never on the full text:
- the court searches keep only results whose case title matches (`titleMatchesTerm`,
  `courtRecords.js:468`);
- FWO matches a media release's title and description.

Those sources can be **copied into our own database by a daily background job** and matched
locally, the same way the ASIC disqualified-persons and enforceable-undertakings checks
already work (both at 100%). The proxy or browser is then used once a day off the search
path, where it can retry for as long as it needs, instead of 40+ times per search under a
45-second limit. Two more sources have official APIs we aren't using.

If Phases 1–3 succeed, **no in-scope live search depends on a proxy**, and the browser is
needed only for Federal Court.

## Does moving to background copies fix the concurrency problem?

Mostly yes, because concurrency is only needed when someone is waiting.

**Why we need concurrency today.** A live search has to finish inside a 45–60s budget while
the user watches. A company with 11 business names generates about 40 proxied requests, and
the only way to fit 40 slow requests into 45 seconds is to run many at once. That's what hits
ScrapeOps' 5-concurrent limit, the 429s and the queueing.

**Why a background crawl doesn't.** Nobody is waiting, so a crawl runs **one request at a
time**, at a polite pace, overnight. It takes as long as it needs, and failed pages are
retried later. A daily crawl collects only what was published that day: a few FWO media
releases, a handful of ACT judgments, a few hundred ASIC notices. That's tens of sequential
requests, not hundreds of concurrent ones. A one-off backfill is larger, but it can be spread
over several nights at concurrency 1. At search time these sources then make **zero** proxy
or browser requests, so the concurrency demand doesn't move; it disappears.

**The challenges themselves still need solving, at concurrency 1:**

| Site | Barrier | What the crawl needs |
|---|---|---|
| ACT courts + ACAT | Cloudflare blocks Railway's IP (no JavaScript challenge) | A clean IP: the proxy, one request at a time |
| FWO | Akamai blocks Railway's IP | Same. If Akamai also rejects Node's TLS fingerprint, ScrapeOps (which makes the request itself) at concurrency 1 fits easily within its free tier |
| ASIC published notices | AWS WAF JavaScript challenge | The headless browser: one page clears the challenge once, then pages through listings with the same session. One browser page overnight, instead of a page per search during the day |

**Where concurrency is still needed:**
- **Federal Court** stays a live, browser-based search until Phase 5. Phase 4's proxy
  transport and browser priority are for it.
- **Fallback to live search** if a listing turns out not to be crawlable (the "verify" items
  in Phase 3). That source stays on Phase 4's transport, at today's request volume.
- **NSW licences**, if the API.NSW route fails verification (Phase 2).

**The honest limit:** if a site blocks the proxy's IP addresses outright, the crawl fails
the same way a live search would. The difference is the consequence: the data goes stale and
the report says so with an as-of date, instead of a search failing or reading as clean. The
ingestion job alerts, and there is a day to fix it rather than a failed search for every user
in the meantime.

## Audit

Columns: **Now** is today's mechanism and measured health. **Problem** is what's wrong with
it. **Best approach** is the recommended replacement.

### Identity and corporate (national, in scope)

| Source | Now | Problem | Best approach |
|---|---|---|---|
| `abn` | Scrapes the ABR website's HTML; 100% | Works, but every check depends on it for identity, and it scrapes HTML that can change. Identity resolution is cut off at 8s | **Official ABN Lookup web services**: free, needs a one-off GUID registration. Gives legal name, entity type, ACN, business names and status as structured data |
| `asic` | Browser + 2captcha on ASIC Connect; 95% "success" | Pays for a CAPTCHA solve on every search but returns no directors (ASIC removed free officer data). Searches the typed name, not the legal name | **ASIC companies bulk dataset** (data.gov.au, weekly) for status, type, registration/deregistration dates and **former names**, which matter for phoenix risk. Drop the CAPTCHA path. (verify: fields and size, see storage under Risks) |
| `asicExtract` | Browser + 2captcha; officer search by director name | Only works if someone typed a director's name; free officer data is unavailable until 2027 (ASIC data API applications are paused) **No public source for officer data exists today** (ASIC's free data API applications reopen in 2027; paid extracts are excluded). Keep the search for names we already have, and record the gap (Phase 6). Directors come from public licence registers (NSW/ACT, already built) and typed names |
| `asicDisqualified` | Bulk dataset; 100% | — | Keep |
| `asicEnforceableUndertakings` | Daily scrape of one static page; 100% | — | Keep |
| `asicInsolvency` | Browser through AWS WAF, per search; **53%** | The worst source we have. The WAF challenge plus a form postback, under concurrent load. Searches the typed name only, and never checks linked companies (a phoenix signal) | **Daily crawl of new notices into our own database** (one browser session a day with unlimited retries, plus a one-off backfill), then match locally by ACN and legal name. Also check linked companies. (verify: browse-by-date listing and volume) |
| `atoDebt` | Same site and mechanism; **58%** | Same as above | Same crawl as `asicInsolvency`; one job covers both notice types |
| `paymentTimes` | Bulk XLSX; 100% | — | Keep |
| `modernSlavery` | Plain HTML scrape; 100% | Searches the typed name; the ABN path works | Pass the legal name and ABN from identity. Otherwise keep |

### Courts and enforcement

| Source | Now | Problem | Best approach |
|---|---|---|---|
| `courts_nsw` | Plain HTTP, NSW Caselaw; 100% | Works. NSW Caselaw has a robots-exclusion policy (noted in CLAUDE.md) | Keep. Review the site's terms before raising volume |
| `courts_act` | ScrapeOps proxy, ACT courts + ACAT; 89% | Proxy queueing (up to 20s), 429s, credits nearly exhausted; a block page can read as clean | **Our own database of case titles**: a daily crawl through the proxy plus a one-off backfill (ACT is CC-BY 4.0). Equivalent to today's results because matching is title-only. (verify: date-sorted listing on both sites) |
| `fwo` | ScrapeOps proxy; 95% | Same proxy problems; Akamai blocks Railway | **Our own database of FWO media releases**: a daily crawl plus a backfill of about 70 listing pages. Low volume, a few releases a week |
| `courts_federal` | Browser through Cloudflare; **74%** | Cloudflare challenges hold browser pages, and those pages are shared with other checks | Short term: route the browser through the residential proxy (Phase 4) and make it the browser's top-priority job. Long term: a database of case titles built from the Open Australian Legal Corpus (CC-BY, to about 2024) plus a daily "latest judgments" crawl, **but only after asking the Federal Court for permission**, since its scraping permission is negotiated case by case |

### Licence and disciplinary registers

| Source | Now | Problem | Best approach |
|---|---|---|---|
| `nswFairTrading` | Verify NSW's internal JSON backend through the ScrapeOps proxy; 95% | Railway can't reach Verify NSW; proxy problems | **API.NSW Trades API**: official search and licence-detail endpoints, free tier of 2,500 calls/month, OAuth token. (verify: it includes the compliance history we read today, and Railway can reach it.) Keep the current path as a fallback |
| `actLicences`, `actDisciplinary` | ACT open-data API, cached in memory; 89% | The failures come from waiting on NSW director discovery, not from the source itself | Keep. They improve when NSW moves to the API |

### Rebuilt sources still need a block-page check

Moving a source to a daily copy doesn't remove the false-clean risk. It moves it into the
ingestion job. Every daily copy must refuse to replace good data with bad: check minimum row
counts (already in place for five datasets) and the page markers used by the response
checks (Phase 0).

## Search order

### Today

`searchOrchestrator.js` already works in roughly the right order:
1. ABN lookup;
2. identity (cut off at 8s; falls back to the typed name);
3. NSW company lookup (20s) and ACT associated names;
4. people and linked companies;
5. term-expanded searches (courts, FWO, disqualified persons, enforceable undertakings).

Gaps:
- **Several sources skip identity:** `asic`, `asicInsolvency`, `atoDebt`, `modernSlavery`,
  and `asicExtract` search under the typed name. If the user typed a business name, those
  sources search the wrong entity.
- **Linked companies only feed courts, FWO, disciplinary and enforceable undertakings.** Their
  insolvency notices aren't checked, though that is the clearest phoenix signal.
- **Identity is cut off at 8s** because the ABN lookup is an HTML scrape. An API would make
  that bound rarely matter.
- **Business-name caps (3 for courts/FWO) exist only to save proxy credits.** Once courts and
  FWO are searched in our own database, a search term costs nothing and the caps can go.

### Target order

```
Stage 0  input      typed name / ABN / ACN / typed people
   │
Stage 1  identity   ABR API (+ ASIC companies dataset for status and former names)
   │                → legal name, ACN, entity type, business names, trust name, former names
   │                bounded (~5s); falls back to the typed name and marks dependents partial
   ▼
Stage 2  entity     NSW and ACT licence registers by ABN/ACN, then legal/business names;
         lookups    ASIC status; insolvency/ATO notices by ACN + legal name;
                    payment times; modern slavery; entity-level disciplinary registers
   │                → licence numbers, nominees, supervisors, partners
   ▼
Stage 3  people &   people from licence records (+ typed people)
         links      → people's own licences → linked companies (cap 3)
   │
   ▼
Stage 4  expanded   courts, FWO, disqualified persons, enforceable undertakings,
         searches   person-level disciplinary records, and insolvency notices for linked
                    companies, all against the full term set
```

Rules:
1. **Every source waits on the smallest dependency it needs.** Sources keyed on ABN/ACN
   start as soon as identity resolves, not after people are found.
2. **Every stage has a time bound and falls back to whatever it has.** A source that ran
   without a later stage's input is marked `partial` with the reason, never left waiting
   indefinitely.
3. **Identifiers before names, at every stage.** Same rule as the licence-matching convention.
4. **Local sources search every term; only live sources are capped.** Caps apply only where
   a query costs money or time against someone else's site.
5. **Results stream as each source finishes.** A slow later stage never holds back an
   earlier result. (Already true; keep it.)

## Fit with the existing reliability architecture

Checked against the code on 2026-10-12. The plan fits the architecture, with seven gaps
that the phases below must close. Gaps 1 and 2 correct this plan's earlier assumption that
`datasetStore.js` could be reused as it is.

**What it reuses unchanged:**
- **Manifest keys stay the same.** No source is added or renamed, only its mechanism
  changes. So `manifest.test.js`'s three-way key check (manifest, `searchOrchestrator.js`
  invocations, web `INITIAL_SEARCHES`), `web/lib/scope.ts`, `ENABLED_JURISDICTIONS` and the
  report sections need no changes. This is the same approach WS4.6 used for `courts_vic`.
- **`runScraper()`** keeps wrapping every MVP key, with its timeout and circuit breaker.
  Local reads go through it like any other source.
- **Completeness states** (WS0.5): `stale` with `asOf` for a lagging ingestion job;
  `partial` when a stage fell back. The report already renders both.
- **`DISABLED_SCRAPER_KEYS`** stays the per-key kill switch.
- **Ingestion safeguards:** minimum-row floors, `recordIngestionFailure()`, fall back to the
  last good copy, and in-flight request sharing, as in `asicDpnDataset.js`.
- **In-memory cache** in front of Postgres (the 2026-10-02 fix): Railway runs in San
  Francisco and Supabase in Sydney, so search-time reads must not cross the Pacific
  unfiltered.
- **`proxyLimiter.js` stays the only way to make a proxied request** (CLAUDE.md convention).
  Phase 4 changes what's inside it, not that rule.
- **Injectable dependencies** (`_http`, `_fetchAllPages`) so every job is unit-testable
  without the network.

**Gaps the plan must close:**
1. **Incremental storage.** `replaceDatasetRecords()` replaces a whole dataset. A daily crawl
   adds new items to an existing copy, so `datasetStore.js` needs an append/upsert by a stable
   record key (a new `record_key` column and unique index in `schema.sql`, idempotent like the
   rest). Row-count floors then apply to the backfill, and a freshness check covers daily
   runs.
2. **Name search at scale.** `queryDataset()` filters with `normalised_name ILIKE '%name%'`,
   which can't use the existing index. That's fine for 32k ACT rows, but slow on hundreds of
   thousands of notices. Add a `pg_trgm` trigram index (supported on Supabase), and match ACN
   first wherever the source has one.
3. **Process isolation.** Refresh jobs run inside the same server process as live searches
   and share its 6-page browser pool. The ASIC notices crawl must run off-peak (overnight
   AEST), take one browser page at low priority, and back off while a search is running. If
   contention still shows, move the jobs to a separate Railway worker service.
4. **Ingestion health on the dashboard.** `health_check_event` records only search-time
   outcomes. A failing ingestion job would show as a healthy source serving old data. Show
   each job's last success, row count and age on `/admin/scraper-health`, and alert on age.
5. **Manifest entries.** Moved sources become `bucket: 1` with a `cadence` (the manifest test
   requires `cadence` only for bucket 1) and a corrected `sourceType`. **Timeouts must still
   cover the dependency chain:** the courts, FWO and insolvency keys wait on
   `resolveExtraSearchTerms()`/`resolveDirectors()`, so they keep 45s+ budgets even though
   their own read is fast (the 2026-10-02/10-06 lesson).
6. **Scope-gated jobs.** Start each new refresh job only if its key is `inScope`, like
   `vicBpc`'s job in `index.js`.
7. **This is WS0.6.** The shared ingestion pattern in Phase 3 is the generic ingestion
   runner WS0.6 called for and never built. Build it as one reusable module, not three copies.

## Phases

Ordered by value for effort. Effort figures are rough.

### Phase 0 — urgent fixes (built 2026-10-13, branch `feature/data-sources-phase0`)
- [ ] **ScrapeOps credits:** 143 of 1,000 left on 2026-10-12, **27 left on 2026-10-13** (after
  Phase 2's 3-credit verification)
  (about one heavy search). Check the reset date; decide between a one-month $29 bridge or
  ACT courts and FWO being unavailable until local copies (Phase 3) ship. **Still 27 left on
  2026-10-14**, no reset yet. Phase 4's residential route can't replace ScrapeOps for now:
  residential providers block government sites (see Phase 4).
- [x] **Block-page checks** in `fwo.js` and the ACT court/ACAT fetchers: require a marker
  that appears only on a real results page, so a challenge page can't read as "no results".
  Add a regression test. **Moved into Phase 2 (2.2)**, which builds the response check into
  the shared request helper those fetchers will use.
- [x] **Dashboard measures completeness:**
  - `health_check_event` gains a `completeness` column (idempotent `ALTER … ADD COLUMN IF NOT
    EXISTS`; dry-run against production in a rolled-back transaction).
  - `runScraper` logs each outcome's completeness; failures and circuit-open skips are logged
    as `unavailable`.
  - `/admin/scraper-health` shows a **7-day complete rate**, counted only from rows logged
    since this change.
- [x] **Identity everywhere in scope:**
  - `asicInsolvency`, `atoDebt` and `modernSlavery` search the legal name and resolved
    ABN/ACN. Verified end to end: typed "Canberra Granny Flat Builders" → TURNKEY CREATIONS
    PTY LTD, ACN 155832732.
  - Also fixed: the notice checks derived an "ACN" from the last 9 digits of *any* ABN. For a
    trust or sole trader that meant searching a non-existent number and reporting "no
    notices". A known non-company now gets "Not a company — ASIC published notices apply to
    companies".
  - `modernSlavery` timeout 20s → 30s, to cover the identity wait.
- [x] **Unavailable datasets reported as complete:** found 2026-10-13 in a local run where
  the caches were empty. `paymentTimes` ("data is not yet available") and `asicDisqualified`
  ("register data unavailable") return `done`/`complete` with that text in the summary, so
  the completeness badge shows a check that never ran as complete. Both must return
  `unavailable`. Check every other dataset-backed key for the same shape.
  **Done:** `paymentTimes` (both its failure paths) and `asicDpnMatch` now return
  `status: 'error'`. The EU and ACT registers already did. **Also fixed:** no scraper ever set
  `completeness: 'stale'`, so an out-of-date cached copy showed as complete, mentioned only in
  the summary text. `validateResult.staleFields()` now marks `paymentTimes`, `asicDisqualified`,
  `asicEnforceableUndertakings`, `actLicences` and `actDisciplinary` as `stale` with `asOf`
  when their cache is past its SLA.
- [x] **Zero-width characters:** strip them in `licenceMatching.js`'s name normalisation.
  (It already turned them into spaces, which worked at the start of a name but split a word
  when one sat inside it; they're now removed.)
  Found in an out-of-scope register (VIC BPC), where it makes names never match; the fix is
  one line and protects the NSW/ACT registers against the same data problem.

### Phase 1 — identity foundation (about 2–2.5 days; needs an ABR GUID)

**Goal:** identity, which every check depends on, comes from an official API, with a local
fallback for companies. `asic` stops paying for a CAPTCHA solve on every search and gains
former names and external-administration status. A failed lookup is never reported as
"not found".

**Findings that shaped this phase (2026-10-12):**
- `abn.js` swallows fetch errors and returns "No ABR records found". ABR's site was in
  maintenance (HTTP 503) while this plan was written, so every search in that window
  silently fell back to the typed name, and the dashboard still showed `abn` at 100%.
- ASIC's company dataset (data.gov.au, resource `5c3914e6-…`, `company_YYYYMM.csv`,
  tab-separated, 400MB, refreshed weekly, last 2026-10-05) has about 3.6M rows. Each former
  name is its own row, pointing at the current name (`Current Name Indicator` blank, plus
  `Current Name` and `Current Name Start Date`). Status codes from ASIC's help file:
  `REGD` registered, `DRGD` deregistered, `EXAD` external administration (receivership or
  liquidation), `SOFF` strike-off action in progress, `NOAC` not active, `NRGD` not
  registered, `CNCL` cancelled, `DISS` dissolved by Act of Parliament.
- **Bug:** `riskGrouper.ts`'s ASIC rule flags a status only if it contains neither "active"
  nor "registered". So "Not active" (and "Not registered") would pass as healthy.
- **Storage:** the production Postgres is 45MB, shared with the web app's own tables, on a
  Supabase plan whose limit is unconfirmed. 3.6M rows would add roughly 1GB. The Railway
  service's volume (`/data`, 5GB, 119MB used) is the better home: local disk, no Sydney
  round trip, and no risk to the app's database. This deliberately departs from
  `datasetStore.js`'s Postgres pattern; health is still recorded in `dataset_snapshot` (1.2).
- **Runtime:** production is Node 23.2, which can't use `node:sqlite` without an experimental
  flag. Use `better-sqlite3`, the only new dependency. The CSV is available unzipped, and
  cheerio, already installed, parses XML, so no other libraries are needed.

#### 1.0 Before starting (you) — done 2026-10-13
- [x] Register for an ABN Lookup web services GUID at abr.business.gov.au/Tools/WebServices
  (free; it arrives by email). The site was in maintenance on 2026-10-12, so retry later.
- [x] Add `ABR_GUID` to Railway (server service). Verified from the production container:
  5/5 lookups, 200–850ms. (Not in local `server/.env`; local runs passed it in from Railway.)

#### 1.1 ABN lookup on the official API (done 2026-10-13)
- [x] **Baselines captured** from the old page scrape for five ABNs: Turnkey, Universal
  Property Group, a trust, and two sole traders, one with a legacy trading name. They're kept
  outside the repo because the sole traders are individuals.
- [x] **API chosen:** XML `SearchByABNv202001` with `includeHistoricalDetails=Y`. JSON
  `AbnDetails` lacks trading names and name history.
- [x] **Same result shape:** the three non-company fixtures are identical to their baselines.
  The two companies are identical plus additions:
  - `ACN`;
  - `Former name(s)`: dated, newest first, deduped across punctuation variants;
  - `date`: the registration date (ISO).

  Former organisation names (companies and trusts, not sole traders) also feed the search
  terms, merged with ASIC's (`resolveFormerNames`). The API also returns business-name
  history; only current names are used, as before.
- [x] **`date` was always empty before.** So `riskGrouper`'s "registered within the past 2
  years" modifier (it only adds to existing findings) never fired; it now can.
- [x] **Name search** (`searchABN`'s name branch and `searchByName` for the disambiguate route)
  uses JSON `MatchingNames`. Status codes: `0000000001` Active, `0000000002` Cancelled.
- [x] **Honest failure:**
  - an ABR "not a valid ABN" exception is a genuine "not found";
  - any other API fault (including an unrecognised GUID) falls back to the page scrape;
  - both failing returns `status: 'error'`, `completeness: 'unavailable'`;
  - `searchByName` now throws instead of returning `[]`. The web client already treats that
    as "no matches" and carries on.
- [x] **Timeouts:** API 5s, page scrape 12s (fits `abn`'s 20s manifest budget). Identity bound
  8s → 5s.
- [x] **Tests:** `scrapers/abn.test.js` (9, synthetic XML/JSON, wired into `npm test`).

#### 1.2 ASIC company data — live DataStore API (done 2026-10-12, branch `feature/data-sources-phase1`)
**Changed from the plan above:** ASIC's help file notes that the dataset is also queryable
through data.gov.au's CKAN DataStore API. Measured from the Railway container: 30/30 lookups by
ACN succeeded (p50 11ms, p95 ~1s), and 10 concurrent lookups all succeeded. The DataStore held
4.45M rows, including a company registered on the day of the latest weekly file, so it's
current. Querying it live gives the same data with no 400MB download, no local database and
no new dependency, so the weekly-copy design is **not built**. It stays the fallback if
`asic`'s measured complete rate drops below 95%.
- [x] `lookupAsicCompany({ acn, abn })` (ACN, then ABN column) and
  `lookupAsicCompaniesByName(name)` (full-text search, then exact normalised name; about 0.3s)
  in `asic.js`. Each query is retried once; a failed lookup throws, and the caller reports it
  as unavailable.
- [x] Status, type and class codes mapped to plain words (ASIC help file, 11/07/2025);
  unknown codes are shown as-is.
- [x] Not used: `Current Name Start Date`. Universal Property Group's former-name rows both
  carry 25/08/2026 although it traded under its current name in 2011, so it isn't a reliable
  rename date.
- [x] Recorded for the weekly-copy fallback, if it's ever needed: `better-sqlite3` 13 crashes
  (segfault) on the production container's Nix Node 23.2, 12 fails to build, **11.10.0
  works**; `node:sqlite` works only with `--experimental-sqlite` on 23.2. The `/data` volume
  had 4.5GB free.

#### 1.3 Switch `asic` to the ASIC data (done 2026-10-12)
- [x] `asicPromise` starts from `identityPromise` (keeping its `.catch(() => {})`), not from
  the typed name at time zero. Look up by identity's ACN (or possible ACN), then by ABN, then
  by exact legal name.
- [x] **Result shape** matches today's company item:
  - `title`; `url` (the public ASIC Connect detail link); `status` (as a label); `date`
    (registration date);
  - `metadata`: `ACN`, `Type`, `Status`, `Registered`, `Deregistered`, `Former names`
    (in source order; the dataset doesn't date them, see 1.2).

  `ResultCard` renders metadata generically, so no web change is needed.
- [x] **Entities that aren't companies** (sole traders, partnerships, most trusts): the
  summary says "Not a company — no ASIC company record expected". That isn't a finding and
  isn't partial.
- [x] **Not found despite an ACN:** "No ASIC company record found for ACN X". (No `stale`
  case, since the source is live.) With no ABN or ACN, name matches are "Name only — verify".
- [x] **Remove the CAPTCHA path from `asic`.** `fetchAdfPageWithCaptcha` stays for
  `asicExtract`. Keep the dormant `ASIC_DATA_API_KEY` director branch only if it fits
  cleanly; it can't run before 2027. Kept, as `fetchDirectorsFromDataApi` (directors only).
  `test-asic-director-fallback.js` (which tested the removed ASIC Connect parsers) is replaced
  by the live `test-asic-company.js` and new unit tests in `asic.test.js`.
- [x] **Manifest:** `asic` is now `bucket: 2`, `sourceType: 'live-api'`, `timeoutMs: 30_000`
  (identity up to 8s + 4s ASIC fallback + two 8s attempts). The label is now "ASIC Company
  Register", in both the manifest and web `INITIAL_SEARCHES`.

#### 1.4 Identity gains former names and an ABR-outage fallback (mostly done 2026-10-12)
- [x] ~~`resolveEntityIdentity` adds `formerNames` and `asicStatus`~~. Changed: former names
  come from the `asic` result (`formerNames`, confirmed by ACN/ABN only) through a bounded
  `resolveFormerNames()` in the orchestrator, so identity doesn't wait on the ASIC lookup.
- [x] **When the ABR lookup fails or times out** and the ABN belongs to a company, take the
  legal name and ACN from the dataset's ABN column. That keeps company identity working
  during ABR outages. Business names still need ABR, so the affected checks stay `partial`.
  Implemented as `withAsicIdentityFallback()` (`licenceMatching.js`), bounded at 4s.
- [x] Shortened the identity bound from 8s to 5s (API measured at 200–850ms from Railway).
- [x] **Former names join the search terms** (courts, FWO and ASIC enforceable undertakings;
  labelled as the entity's own names). Verified live: NSW court searches for Universal
  Property Group now find cases filed under its former names Bathla Investments and Bathla
  Construction. Not done yet: the NSW/ACT licence registers searching former names, which is
  deferred to Phase 2 so it doesn't add NSW proxy requests now.
  - `resolveExtraSearchTerms()` adds them, labelled with "former name" provenance;
  - the NSW/ACT licence registers also search them by name;
  - matches only by name stay "Name only — verify", per the licence-matching convention;
  - keep a cap (for example 3 most recent) while courts and FWO are still live and paid
    per request. Phase 3 removes the cap.

#### 1.5 Fix the ASIC status risk rule (done 2026-10-12)
- [x] Replace the substring check with an explicit list:
  - **"Registered"** is clean;
  - **External administration, Strike-off action in progress, Not active, Not registered,
    Deregistered** are `significant`;
  - an unrecognised status is `findings`, never silently clean.
- [x] Tests in `riskGrouper.test.ts` for each status, including "Not active" (the bug).

#### 1.6 Verify
- [x] `cd server && npm test` (214/214); `cd web && npm test` (9/9) and `npx tsc --noEmit`
  (clean). 2026-10-12.
- [x] `test-launch-scope.js` (3/3), `test-ws4-fault-injection.js` (49/49),
  `test-licence-matching.js` (12/12), new `test-asic-company.js` (6/6, live). Run locally
  with the ScrapeOps and CAPTCHA keys blanked so no credits were spent.
- [x] (2026-10-13) Re-ran the fixtures end to end through `runSearchRequest`, with the key set:
  - **Turnkey**, typed as its trading name "Canberra Granny Flat Builders": resolves to its
    legal name; ABN lookup 276ms.
  - **Universal Property Group:** still finds the Bathla cases.
  - **The trust:** "Not a company".
  - All 16 keys reported. Full suites green again: server 223/223, web 9/9, tsc clean,
    fault injection 49/49, launch scope 3/3, licence matching 12/12, ASIC company 6/6.
- [x] Before deploying, end to end through `runSearchRequest` for Turnkey and Universal
  Property Group: `asic` about 1.1s, correct status and former names, all 16 keys reported.
- [ ] Deploy. Confirm in the logs: `asic` succeeds and stays fast under real load, and
  2captcha calls drop (only `asicExtract` should still make them).
- [ ] Check the dashboard after 7 days: `abn` and `asic` complete rates ≥95%.

#### 1.7 Record
- [ ] Update CLAUDE.md (scraper conventions, `asic`/`abn` entries, the volume-storage
  deviation and why), tick these boxes, and note anything that differed from this plan.

**Done when:** identity comes from the ABR API with honest failure reporting; `asic` reads
the local dataset with no CAPTCHA; former names reach the search terms; "Not active" and
external administration are flagged; and all tests pass.

### Phase 2 — NSW licences off the proxy, and sites retried directly (built 2026-10-13, branch `feature/data-sources-phase2`)

**Revised 2026-10-13: no API.NSW account needed.** Tested from the Railway container:

| Site | Direct from Railway | Notes |
|---|---|---|
| Verify NSW search (`advQuery`) | 8/8 OK, ~200ms | The block from 2026-09-15 has lifted |
| Verify NSW licence details | 3/3 OK, ~250ms | Same |
| ACT courts, ACAT | 403, Cloudflare | Still blocked |
| FWO | Timed out after 15s | Still blocked |
| API.NSW Trades API (`api.onegov.nsw.gov.au/tradesregister/v1`) | 401 (live, needs an OAuth key) | A 2020 product, possibly the retired OneGov backend; data shape unverified |

So NSW can go direct now, with the proxy as fallback. Blocks come and go (NSW was blocked a
month ago), so the same helper tries every proxied site directly and remembers the result.
A site that unblocks Railway then stops costing proxy credits on its own, and one that
re-blocks falls back to the proxy without a deploy.

#### 2.1 Direct first, proxy as fallback (`proxyLimiter.js`)
- [x] New `fetchDirectFirst({ site, request, validate, label, priority })`:
  1. Unless the site is in a "direct is blocked" cooldown, try the request **directly**, with
     a short timeout (NSW 8s; ACT and FWO 5s).
  2. If that fails (network error, timeout, 403/429/5xx) or the response fails `validate`,
     put the site in a 30-minute cooldown and send the request **through the proxy**, using
     the existing semaphore, priority tier and 429 retry.
  3. A direct success clears the cooldown.
  4. Never throws a different shape than today: a request that fails both routes throws, and
     the callers' existing "failed → `partial`/`unavailable`" handling stays as it is.
- [x] Logging: one line when a site's direct request fails (and the cooldown starts) and one
  when direct works again, rather than one per request. A blocked site's traffic is then
  visible without dozens of lines per search; ScrapeOps' own `used_api_credits` counts
  proxied requests. (Changed from the per-request logging planned above.)
- [x] Callers no longer build ScrapeOps URLs themselves. The helper does it for the proxy
  route, keeping NSW's `keep_headers`. `proxyLimiter.js` stays the only way to make a proxied
  request (CLAUDE.md convention).
- [x] With no `SCRAPEOPS_API_KEY` (local dev), only the direct route runs, as today.

#### 2.2 Response checks: a block page is a failure, never "no results"
This is Phase 0's block-page item.
- [x] `validate` for each site, built from real saved responses (results page, no-results
  page, challenge page) and kept as test fixtures:
  - **NSW search:** a JSON body with a `results` array.
  - **NSW details:** a JSON body with `componentData`.
  - **ACT courts / ACAT:** the results container or the site's own no-results text.
  - **FWO:** the search page's result list or its no-results text.
- [x] A response that fails `validate` on the proxy route is a failed request: same as an
  error, so `partial`/`unavailable`, never an empty clean result.

#### 2.3 Move the three scrapers onto it
- [x] `nswFairTrading.js`: search and details (priority stays `high`).
- [x] `courtRecords.js`: ACT courts and ACAT.
- [x] `fwo.js`.

Today ACT and FWO will take the proxy route after one fast failed direct attempt per 30
minutes (ACT fails in under 0.3s; FWO's 5s timeout is paid at most once per cooldown).

#### 2.4 Former names in the NSW and ACT licence searches (deferred from 1.4)
- [x] NSW and ACT licence registers also search the entity's former names (from
  `resolveFormerNames`). NSW requests are now free when direct; ACT is a local dataset. A
  match by name only stays "Name only — verify"; identifier matches are unaffected.

#### 2.5 Tests and verification
- [x] **Unit tests** for `fetchDirectFirst`, with injected fake routes:
  - direct succeeds → no proxy call;
  - direct fails → proxy;
  - an invalid direct response → proxy;
  - the cooldown skips direct, and a direct success clears it;
  - both routes fail → throws;
  - no proxy key → direct only;
  - an invalid proxy response → failure, not empty results.
- [x] **Regression tests:** a saved challenge page for ACT and FWO must produce
  `partial`/`unavailable`, never "no cases found". Confirmed against `main`'s code: fed the
  same Cloudflare page, it reported "No cases found in ACT courts and tribunals" and "No Fair
  Work Ombudsman enforcement outcomes found". Fixtures are trimmed real pages in
  `server/scrapers/fixtures/`.
- [x] **Existing tests:**
  - `npm test`: 238/238, including the new `blockPages.test.js` and 8 new `fetchDirectFirst`
    tests;
  - `test-launch-scope` 3/3, `test-ws4-fault-injection` 49/49, `test-licence-matching` 12/12,
    `test-asic-company` 6/6, `test-nsw-fairtrading` 5/5, `test-court-records` 11/11.
- [x] **From the Railway container, before merging (2026-10-13):** the branch's code was run
  against production's real proxy key:
  - NSW went direct (no credit; 1.8s);
  - ACT courts and ACAT failed directly (403, about 0.2s) and found all 7 Geocon cases
    through the proxy;
  - FWO timed out directly at 5s, then succeeded through the proxy.

  3 credits spent (970 → 973).
- [ ] **After deploy:** ScrapeOps `used_api_credits` should stop rising for NSW requests, and
  logs should show no "nsw: direct request failed" lines.

#### 2.6 API.NSW Trades API: not needed now
- [ ] Revisit only if Verify NSW blocks Railway again **and** the proxy route proves
  unreliable for it. It would then be a third route behind direct and proxy. It needs an
  account (free tier: 2,500 calls/month, OAuth key/secret, tokens last about 12 hours), and
  its data shape must first be checked against what we read from Verify NSW today.

**Effect on proxy credits:** NSW was about 5–15 credits of a heavy search; ACT courts (2 per
search term) and FWO (1 per term) are most of the rest. So Phase 2 slows the credit drain but
doesn't stop it. Phase 4 (residential proxy) or Phase 3 (local copies of ACT and FWO) does.

### Phase 3 — our own copies of FWO, ACT courts/ACAT and ASIC notices (about 5–6 days, including the shared ingestion module)
- [ ] One shared ingestion module (WS0.6), closing architecture gaps 1–7:
  - append/upsert storage and a trigram name index;
  - one request at a time, off-peak scheduling, low browser priority;
  - ingestion health on the dashboard;
  - manifest updates that keep 45s+ budgets for the dependency chain;
  - scope-gated start;
  - minimum-row and page-marker checks.

  Each job: a one-off backfill spread over several nights, then a daily crawl of new items,
  run through the proxy (FWO, ACT) or one browser page (ASIC notices), retrying until it
  completes.
- [ ] **FWO:** media-release listing pages → title, summary, date, URL. Match locally with
  the existing FWO matching code.
- [ ] **ACT courts + ACAT:** date-sorted listings → case title, court, date, URL. Match with
  `titleMatchesTerm`. (verify listings first)
- [ ] **ASIC published notices** (insolvency + ATO): daily notices → notice type, company
  name, ACN, date, URL. Match by ACN first, then name. Decide the backfill window, for
  example 7 years. (verify volume and listing)
- [ ] Remove the business-name caps for these sources (search rule 4). Add linked companies
  to the insolvency search.
- [ ] Mark each result `stale` with its as-of date if its ingestion job is behind (the
  pattern already exists).

### Phase 4 — proxy transport (code built 2026-10-13; residential route on hold, see the trial result)
Built ahead of Phase 3, so for now it serves the live searches (NSW, ACT courts/ACAT, FWO) and
Federal Court's browser. Once Phase 3 lands it serves mainly the ingestion jobs.

**Nothing changes in production until `PROXY_URL` is set.** With it unset, the route chain is
exactly Phase 2's (direct → ScrapeOps) and the browser is unproxied. So the code merged
without a provider.

**Provider trial result (2026-10-14): residential proxies block government sites, so this
route is on hold.**
- [x] **The trial:** DataImpulse (standard residential, $1/GB) and Decodo ($4/GB pay-as-you-go),
  run from the Railway container with `tests/proxy-trial.js`, 50 requests per site.
  - Both gave 8 distinct Australian exit IPs on the IP check (ipinfo.io).
  - Both failed **every** request to every site: 0/50 for NSW, ACT courts, ACAT and FWO (HTTP
    403) and for Federal Court (`ERR_TUNNEL_CONNECTION_FAILED`). The proxies themselves
    refused the connections. NSW answers Railway directly, so the sites weren't the cause.
  - The script reported every refusal as a failure, never as a clean result.
- **Cause: provider policy.** [DataImpulse](https://docs.dataimpulse.com/blocked-websites)
  has blocked all government websites since December 2023. It will unblock named sites after
  KYC verification if support approves the use case. [Decodo](https://decodo.com/questions/do-you-have-any-blocked-sites)
  restricts government sites too, and its documentation suggests KYC doesn't lift that.
  Oxylabs, Bright Data and Webshare publish similar restrictions, so switching providers is
  unlikely to help. This plan assumed residential proxies could reach these sites; that
  assumption was wrong, and it wasn't checked before the trial.
- [ ] **Waiting on DataImpulse (asked 2026-10-14):** an unblock request for the five domains
  (`verify.licence.nsw.gov.au`, `www.courts.act.gov.au`, `www.acat.act.gov.au`,
  `www.fairwork.gov.au`, `search.judgments.fedcourt.gov.au`), with KYC. If approved, rerun the
  trial against DataImpulse alone:
  `PROXY_TRIAL_URLS="dataimpulse=http://LOGIN__cr.au:PASS@gw.dataimpulse.com:823" node tests/proxy-trial.js --n 50`.
  If it passes the ≥98% bar, set `PROXY_URL` in Railway. If FWO fails on Node's TLS
  fingerprint, also set `PROXY_ROUTES_FWO=direct,scrapeops,residential`.
- [ ] **Decodo:** refund requested or account left unused. Not pursued further.
- **Meanwhile:** Phase 3's local copies are now the main fix for ACT courts/ACAT and FWO, and
  ScrapeOps stays the only proxy route.
- **Running the trial again:** `tests/proxy-trial.js` is self-contained (it copies the page
  checks rather than importing the scrapers), so it runs against whatever is deployed. If the
  deployed copy is older, copy it into the container from a Mac first:
  `railway ssh -- "echo $(base64 < server/tests/proxy-trial.js | tr -d '\n') | base64 -d > /app/tests/proxy-trial.js"`,
  then run it with `railway ssh -- 'cd /app && PROXY_TRIAL_URLS="…" node tests/proxy-trial.js --n 50'`.

- [x] `proxyLimiter.js` rewritten as one call, `proxiedRequest({ site, method, url, headers,
  data, validate, priority, deadlineMs, directTimeoutMs, keepHeaders })`:
  - Route chain: direct (Phase 2's 30-minute cooldown kept) → residential
    (`HttpsProxyAgent(PROXY_URL)`) → residential again with a new agent (a new connection, so
    a rotating gateway gives a new IP) → ScrapeOps (keeping NSW's `keep_headers`). The order
    is configurable with `PROXY_ROUTES`, or per site with `PROXY_ROUTES_<SITE>`. Routes without
    credentials are skipped.
  - Every attempt shares one deadline from the caller's budget. Direct gets
    `directTimeoutMs`, each residential attempt up to 12s, and the last route whatever time
    is left. Time queued for a slot counts against the deadline.
  - A response that fails the page check moves on to the next route. From the last route it
    throws `InvalidResponseError`.
  - Limits: residential is 4 per site (`RESIDENTIAL_SITE_CONCURRENCY`) and 12 overall
    (`RESIDENTIAL_MAX_CONCURRENCY`); ScrapeOps stays at 5 (`PROXY_MAX_CONCURRENCY`) with its
    429 retry. NSW's priority tier and starvation bound now live in a shared
    `priorityGate.js`.
  - Logging: one line per failed proxy attempt. Direct failures still log only when the
    cooldown starts or ends (the Phase 2 change), not on every request.
  - `https-proxy-agent` ^7 is now a direct dependency.
  - Tests: `priorityGate.test.js` (6) and `proxyLimiter.test.js` (24), with fake routes.
- [x] **ScrapeOps share alert:** per-route counts and ScrapeOps' share of the last 200
  proxied requests appear on `/admin/scraper-health` (new "Proxy routes" table; also
  `proxyRoutes` in `/api/admin/scraper-health/full`). With a residential proxy set, a share
  above 5% (minimum 20 requests) logs `[proxyLimiter] ALERT: …`, at most hourly. Counts reset
  when the server restarts.
- [x] **Federal Court's browser:**
  - Pages open in the browser pool's new high-priority tier (`browser.js` now uses
    `priorityGate.js`, following the 2026-10-02 design principles).
  - With `PROXY_URL` set, the page goes through the residential proxy in its own browser
    context, so other scrapers' pages aren't proxied. Credentials are passed with
    `page.authenticate`. A failed proxied attempt skips the proxy for 10 minutes, so the
    existing per-term retry goes direct, as today. `PROXY_ROUTES_FEDERAL=direct` turns the
    proxy off for this site.
  - **Bug fixed along the way:** an uncleared Cloudflare challenge used to be parsed as "no
    cases found" (a silent false clean). The page must now pass `isFedcourtResultsPage`.
    Fixtures: `fed-hit.html`, `fed-none.html`.
- [ ] **Bandwidth, if the residential route is ever enabled before Phase 3 ships.** Response sizes
  measured through the stand-in proxy: FWO ~430KB per query, ACT courts ~96KB, ACAT ~60KB,
  NSW ~1KB, Federal Court ~160KB of HTML (plus the page's scripts and images). A heavy search
  with ~5 terms that needs a proxy for ACT and FWO is about 3MB. At 1,000 searches/month
  that's about 3GB, roughly $6–12/month at typical residential prices: still inside the $30
  target, but not "well under 1GB". Phase 3's local copies remove most of it. Blocking images
  and fonts on proxied browser pages would cut Federal Court's share; that isn't built.

### Phase 5 — Federal Court long term (about 1 day plus waiting time)
- [ ] Write to the Federal Court asking permission for a daily latest-judgments crawl and a
  one-off index of case titles.
- [ ] If granted: backfill from the Open Australian Legal Corpus (to about 2024) plus a crawl
  of the gap, then a daily crawl. The source then becomes a local lookup.
- [ ] If not: stay on Phase 4's improved browser path and measure the result.

### Phase 6 — directors from public sources only (gap, revisit 2027)
- [ ] Record the gap plainly in the report: without a typed or licence-register-discovered
  name, director-based checks (phoenix detection, disqualified persons) can't run, and the
  report already marks them `partial` with the reason. Keep that wording accurate.
- [ ] Check whether more public registers expose people linked to a company (for example
  ACT and NSW personal licence records, already used) before re-enabling other states.
- [ ] Revisit ASIC's free data API (officer data) when applications reopen in 2027. The
  `ASIC_DATA_API_KEY` code paths already exist and are tested.
- [ ] Deep Check currently returns the same as a free search. That's a product decision
  outside this plan, and it can't be solved with paid data.

## Cost (recurring, at about 1,000 searches/month)

| Item | Monthly |
|---|---|
| ABR web services, ASIC companies dataset | $0 |
| API.NSW Trades API, free tier (up to about 170–500 searches/month) | $0, then premium tier (price to be confirmed) |
| Residential proxy (on hold: providers block government sites, see Phase 4) | $0 now; ~$6–12/month before Phase 3 or ~$2–5 after, if DataImpulse unblocks the domains |
| ScrapeOps free tier, fallback only | $0 |
| 2captcha | only `asicExtract` (searches for names we already have) still uses it once `asic` drops the CAPTCHA |
| Database storage for the new copies | see Risks |

## Risks and open questions

- **Storage.** Decided for the ASIC companies dataset in Phase 1: SQLite on the Railway
  volume (`/data`, 5GB), not the shared 45MB Postgres. Phase 3's notices copy is the next
  large dataset; decide its home the same way (likely the volume too), and check the Supabase
  plan's limit before putting anything large in Postgres.
- **Coverage of the API.NSW Trades API** (compliance history, roles) is unconfirmed. Phase 2
  doesn't switch over until that's verified.
- **Terms of use.** ACT is CC-BY. Review FWO, NSW Caselaw and ASIC published notices' terms
  before running crawls. Federal Court needs explicit permission (Phase 5). A daily crawl is
  a different activity from a user-triggered search, so check the terms for it specifically.
- **Freshness.** Daily copies can be up to a day old. That's acceptable for court titles,
  media releases and notices, but every result shows its as-of date.
- **Residential proxies and government sites.** Residential providers block government
  websites by default (found in the Phase 4 trial, 2026-10-14). Any plan that routes a
  `.gov.au` site through a residential proxy needs that provider's written unblock first.
  ScrapeOps works for these sites today.
- **Health-check blind spots.** CI runs from GitHub's IP addresses, which ACT and Federal
  Court block, so CI can't tell real breakage from IP noise for those sources. The ingestion
  jobs' own success logs become the better signal. Three legacy probe tests in `run-all.sh`
  for MVP sources (`act-licence`, `asic-insolvency`, `fwo`) test pages production no longer
  uses; retire or rewrite them so the daily run reflects real health.

## Out of scope — findings kept for later

Not part of this plan. Recorded so the audit doesn't need repeating when a state is
re-enabled. Every register below still searches under the **typed name**, against the
licence-matching convention in CLAUDE.md, and must move to identity-first matching first.

- **`qbcc`** (QLD): the licensee search returns no status or financial category. QBCC
  publishes a monthly open-data CSV (CC-BY 4.0) of active and suspended licensees with
  licence class and financial category; use it for matching, keep the live backend for
  adjudications.
- **`vicBpc`** (VIC): daily CI fails because register names contain zero-width characters
  (fixed by the Phase 0 normalisation change).
- **`vicVbaLicence`, `ntBuildingPractitioners`** (VIC, NT): sources are fine; identity
  migration only.
- **`waBuildingEnergy`** (WA): calls the undocumented Elasticsearch backend behind
  wa.gov.au's site search, so it can change without notice.
- **`waLicenceRegister`** (WA): browser form, passes CI, disabled to save browser capacity.
  No open data found.
- **`tasLicenceRegister`** (TAS): browser + 2captcha, disabled. The only open data is
  aggregate counts from 2017.
- **`courts_nt`**: browser through Cloudflare, disabled; same treatment as Federal Court.
- **`courts_vic`**: works, but covers only a summarised subset of Supreme Court cases.
- **`courts_qld`, `_wa`, `_sa`, `_tas`**: manual links. Only written permission
  (Queensland Judgments, AustLII) or a paid legal-data licence can change that.
- Suggested re-enable order by data availability: VIC, QLD, WA, NT, TAS.
