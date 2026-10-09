# Licence matching plan: identifier-first NSW/ACT licence and people discovery

Status: **Phase 1 done (2026-10-09, branch `fix/licence-matching-phase1`); Phases 2–3 not started** (drafted 2026-10-09). Work through the phases in order and
tick items off here as they land, so a fresh session can pick up mid-way. The permanent rules
this plan implements (and that every future state/territory licence register must follow) are
in CLAUDE.md under "Scraper conventions" → "Licence-register entity matching".

---

## Why: what was found (2026-10-09, all live-verified)

1. **Searches started from a trading name miss licences and people.** Every name-based check
   uses the request's `companyName` verbatim. The ABR legal name from the ABN lookup is never
   substituted. Real case: TURNKEY CREATIONS PTY LTD (ABN 67 155 832 732) has 11 ABR business
   names. Report `cmuze0nhp0001jzwuyb2u6map` (2026-10-08) was run as "Canberra Granny Flat
   Builders": 0 licences, 0 people, and every people-dependent check went `partial`. Report
   `cmv08blz700017mt1kjm7b0le` (2026-10-09), run under the legal name, found 2 ACT + 2 NSW
   licences, plus Nickolas Jai Constable and Frank Walmsley. Two entry paths produce this:
   typing a trading name alongside the ABN (`HomeSearch.tsx:27-29`), and choosing a
   business-name row in the disambiguation list (`HomeSearch.tsx:99-100`).
2. **NSW drops every director when a company has more than one.** Verify NSW labels the
   role group `"Director"` (one director) or `"Directors"` (several).
   `nswFairTrading.js`'s `ASSOCIATED_ROLES` only accepts the exact group name `director` /
   `nominated supervisor`. Universal Property Group (1 director) works. Turnkey (2 directors:
   Constable, Walmsley) yields only Constable, and only as Nominated Supervisor. Each
   `parties[]` entry carries its own `role: "Director"`, which is the reliable field.
3. **Neither register is reliably searchable by ABN. Identifiers are inconsistent.**
   - **NSW Verify** (`advQuery` free-text search): an ABN search works only when NSW recorded
     an ABN (Universal Property Group yes, Turnkey no). An ACN search works when an ACN is
     recorded. Spaced formats return nothing, so search digits only. Results carry optional
     `ABN`, `ACN`, `businessNameList` and `licenseeType` fields. In a 1,242-licence sample
     (biased toward company/trust names), identifiers were: ABN+ACN 48%, ACN only 36%, ABN
     only 2% (e.g. Ardent Builders Pty Ltd, ABN 84614738751), neither ~13% of organisations.
     One record had a 9-digit ACN in its ABN field. `nswFairTrading.js` reads `hit.ABN` into
     metadata, which is empty whenever only an ACN is recorded.
   - **ACT** (Socrata `de4w-gbt3`, matched locally from the in-memory/DB cache): no ABN field
     at all. `licensee_acn` holds an 11-digit ABN in 94 records and is stored both spaced and
     unspaced. The disciplinary register (`avib-prrz`) uses `a_c_n`.
4. **Name-only records exist in both registers.** These have a name but no ABN and no ACN.
   - **NSW:** 191 of 1,450 sampled organisation licences. Breakdown: 141 Pty Ltd companies,
     35 written as "P/L" (e.g. "ALFRED BUILDERS (AUST) P/L"), 13 trusts (some truncated by
     NSW itself), 2 partnerships. 190 of 191 are Expired/Surrendered/Cancelled, so mostly
     legacy records. They still matter as licence history.
   - **ACT:** 90 non-individual records with no ACN (68 trading-style names, 15 companies,
     7 partnerships).
5. **Failed NSW lookups are indistinguishable from "no licence".**
   `fetchAndBuildResultsForQuery`'s `catch { // non-fatal }` returns empty results. This hid
   proxy 429s in testing too: a "12 parallel, 0 failures" result was really 3 × HTTP 429.
6. **Proxy constraints (ScrapeOps, production):** free plan, **1,000 credits/month (723
   used at 2026-10-09)**, **max 5 concurrent requests account-wide**. It is shared by
   `nswFairTrading.js`, `courtRecords.js` (ACT Courts + ACAT, 2 requests per search term)
   and `fwo.js`, each wrapping requests independently with its own `viaProxy`. NSW needs the
   proxy because Verify NSW blocks Railway's IP addresses. Measured from the production
   container: about 3.3–3.7s per NSW request through the proxy; 12 requests at concurrency 4
   took 19.8s with no errors; at concurrency 12, 3 of 12 failed with HTTP 429.
7. **Usage at the time:** 44 saved reports in 30 days. ABR business names per entity:
   median 0, p90 3, max 11.

## Decisions (user, 2026-10-09)

- **No ScrapeOps upgrade for now.** The plan must therefore be roughly credit-neutral per
  search. Watch `used_api_credits`
  (`GET https://proxy.scrapeops.io/v1/account?api_key=…`, run from the production container
  via `railway ssh`, since the key lives only in Railway env).
- **Business-name cap = 10, applied to the NSW licence search AND to the ACT court search**
  (`courts_act`, which spends 2 proxy credits per name). ACT licence matching is local and
  free, so the cap is irrelevant there. Apply the same cap to any future proxy-backed
  per-name search.
- **Name-only matches are "verify" only.** Show them in the report, labelled
  "matched by name only — verify", but they must never drive a `riskGrouper` finding or
  severity. Revisit later.

---

## Phase 1: urgent fixes (one PR, independent of Phase 2)

- [x] **1.1 NSW role detection.** In `associatedNamesFromDetails`
  (`server/scrapers/nswFairTrading.js`), classify each party by `party.role`
  (`Director` / `Nominated Supervisor`), not by `roleGroup.name`. Regression test using a
  details payload with a `"Directors"` group containing 2 parties (shape is in finding 2).
- [x] **1.2 Report failed NSW lookups.** `fetchAndBuildResultsForQuery` returns a `failed`
  flag per query, and when any query failed, `searchNSWFairTrading` /
  `fetchNswCompanyLookup` set `completeness: 'partial'` with summary text naming the failure.
  This is the captcha-gated-check pattern in CLAUDE.md "Scraper conventions", applied to a
  plain HTTP check. A failed details fetch already leaves `ComplianceHistory` unset; keep
  that behaviour.
  - **Every search failed → `status: 'error'`, `completeness: 'unavailable'`**; only some
    failed → `partial`. This matches `courtRecords.js`'s allFailed/anyFailed split, which
    `validateResult.js` and the report's `isAllErrored()` already rely on.
  - **Also fixed (found while implementing, not in the original plan):** the orchestrator's
    20s discovery-timeout fallback was a truthy empty object, so `searchNSWFairTrading`
    reused it as a finished company query and reported "no licence records found" whenever
    NSW was slow. Now the orchestrator keeps the raw lookup promise (`nswCompanyLookupPromise`):
    discovery bounds it at 20s, and the `nswFairTrading` key awaits the *same* request inside
    its 45s budget (no duplicate proxy credit). Only a lookup that genuinely failed is
    re-queried, once.
- [x] **1.3 Shared proxy limiter.** New `server/scrapers/proxyLimiter.js`: one process-wide
  semaphore (default 5, env `PROXY_MAX_CONCURRENCY`) plus one retry with backoff on HTTP 429.
  Route all three `viaProxy` callers (`nswFairTrading.js`, `courtRecords.js`, `fwo.js`)
  through it. Optionally also dedupe the three copies of `viaProxy` into it. Unit-test with
  a fake `_http`, using the injectable-dependency convention.
- [x] Verify: `npm test` (169/169) + `server/tests/run-all.sh` (same 5 pre-existing failures
  as `main`: act-licence, tas-cbos-licence, vicbpc, wa-be-licence, ws3-director-discovery).
  Live: TURNKEY CREATIONS now yields Constable + Walmsley as Directors. **Still to do after
  deploy:** ScrapeOps `used_api_credits` before/after one Turnkey search, and check logs for
  429s and `[proxyLimiter] ... waited` lines.

## Phase 2: identifier-first matching (second PR)

**Reliability-framework constraints (from the 2026-10-09 consistency review against
CLAUDE.md, `manifest.js`, `runScraper.js` and `validateResult.js`).** These apply to every
Phase 2/3 item below:

- **Bound the identity lookup and fail open.** `abnPromise` has no timeout of its own (each
  ABR call is 15s, and there are several), so "build identity from `abnPromise`" must be
  `withTimeout(...)` with a fallback to the typed name — otherwise a slow ABR call eats the
  20s discovery window and re-creates the "one slow upstream serialises 13 scrapers" problem
  fixed on 2026-09-08. The discovery 20s now has to cover ABN + limiter queue + NSW (a).
- **No new manifest keys.** All of Phases 2–3 changes how existing keys (`nswFairTrading`,
  `actLicences`, `actDisciplinary`, `courts_act`) search, not which keys exist. A new key
  would also need `searchOrchestrator.js` `invocations`, `INITIAL_SEARCHES`, a launch-scope
  decision and `manifest.test.js`.
- **The 10-name cap must also cover `fwo`.** FWO is proxy-backed and gets
  `resolveExtraSearchTerms()` (all business names, uncapped, all concurrent) — the same
  exposure as `courts_act`, which the cap decision says to cover ("any proxy-backed per-name
  search"). NSW Caselaw (direct, free) and Federal (Puppeteer, no proxy) stay uncapped.
- **NSW's "at most 3 concurrent" (2.3) is a per-scraper sub-limit on top of
  `proxyLimiter.js`'s global 5**, not a change to the global limiter.
- **Keep the completeness split:** all identifier/name queries failed → `status: 'error'` /
  `unavailable`; some failed → `partial`; "no licence linked to this ABN found" is a
  completed check and stays `complete` (the summary carries the caution, `riskGrouper` raises
  nothing). Never resolve a failure into an empty `complete` result.
- **`riskGrouper` stays completeness-agnostic** (WS0.5 decision); 3.3 only filters out
  `MatchedBy: 'Name only — verify'` items. Saved reports keep their frozen `riskSummary`.
- **ACT matching changes stay on the read side** (`actLicences.js` against the memCache /
  `datasetStore` rows). Don't touch `actLicencesDataset.js` ingestion or its row-count floors.
- **Unit tests go in `server/package.json`'s `test` list; live fixtures in `run-all.sh`**
  (which the daily GitHub Actions health check also runs, without `SCRAPEOPS_API_KEY`, so
  NSW goes direct from GitHub's runner IPs there).
- **Health dashboard blind spot:** `runScraper` records breaker *success* for any resolved
  result, including `status: 'error'` from all-failed NSW/courts searches. ScrapeOps credit
  exhaustion would therefore show as failing reports but a "healthy" dashboard. Not changed
  here; check ScrapeOps usage directly (see Decisions).

- [ ] **2.1 Shared module `server/scrapers/licenceMatching.js`.** This is how the logic
  carries over to future registers: every licence scraper uses it rather than re-implementing
  matching per file (an intentional exception to the file-local-helper habit, because the
  rules must not drift). Exports:
  - `resolveEntityIdentity({ abn, acn, companyName }, abnResult)` → `{ legalName, abn, acn,
    entityType, businessNames (capped, see below), trustName, typedName }`. The ACN comes
    from user input, or from the last 9 digits of the ABN when the ABR entity type is a
    company. If the ABR payload exposes the ACN directly, prefer that. Trust name: parse
    "The Trustee for X" → "X".
  - `normaliseDigits(v)`; `identifiersMatch(recordValues[], identity)`, which compares any
    9- or 11-digit value against both the ABN and ACN, in either field.
  - `normaliseEntityName(name)`: P/L, Pty Limited and Proprietary Limited → pty ltd; strip
    bracketed words such as "(Aust)"; `&` → and; collapse whitespace. Then reuse the
    existing whole-word / punctuation-safe matching.
  - `classifyMatch(record, identity)` → `'confirmed' | 'rejected' | 'name-only'`: identifiers
    match → confirmed; identifiers present but different → rejected even if the name matches;
    no identifiers and name matches → name-only.
  - `BUSINESS_NAME_CAP = 10`.
- [ ] **2.2 Orchestrator** (`server/searchOrchestrator.js`). Build the identity once from
  `abnPromise` (adds about 1–2s before licence discovery starts) and pass it to NSW, ACT and
  people discovery. The typed name becomes the fallback only when there is no ABN. Cap
  `resolveAlternateNames()` output passed to `courts_act` at 10.
- [ ] **2.3 NSW** (`nswFairTrading.js`). Queries in priority order, at most 3 concurrent via
  `proxyLimiter`, leaving headroom for courts and FWO:
  - (a) ABN digits, ACN digits and legal name. These feed people discovery and must finish
    inside the 20s discovery timeout.
  - (b) business names (≤10) and trust name. These run in the main `nswFairTrading` key (45s).
  Dedupe by `licenceId`. Fetch one details page per unique licence. Apply `classifyMatch`
  using the hit's `ABN`/`ACN`. Also match the hit's `businessNameList`. Fix the metadata to
  show `ACN` (and `ABN` when present).
- [ ] **2.4 ACT** (`actLicences.js`: licences, disciplinary, `resolveActAssociatedNames`).
  Match `licensee_acn` / `a_c_n` digit-wise against ABN and ACN, plus names (legal, business,
  trust). Apply `classifyMatch`.
- [ ] **2.5 People discovery.** Take Directors / Nominated Supervisor (NSW) and Partners /
  Nominees (ACT) from `confirmed` licences, plus the personal licences NSW lists under each
  party (`parties[].licences`). People from `name-only` licences are included, tagged with
  lower confidence.
- [ ] **2.6 Drop NSW searches under each person's name** in `searchNSWFairTrading`. The
  details payload already links each person's licences, which saves about 2 proxy credits per
  search. Keep ACT per-person matching, which is local and free.

## Phase 3: report

- [ ] **3.1 Provenance per result:** `metadata.MatchedBy = 'ABN' | 'ACN' | 'Name only — verify'`,
  shown by `ResultCard` (it already renders metadata generically).
- [ ] **3.2 No licence found by identifier or name:** the summary says "No licence linked
  to this ABN found" (not a clean pass). People-dependent keys stay `partial` and say why.
- [ ] **3.3 `riskGrouper.ts` excludes `Name only` results** from every trigger (decision
  above). Add a test case for this.

## Testing (Phase 2 + 3)

- Unit tests (no network) for `licenceMatching.js`: name normalisation, `classifyMatch`
  (including ACN-in-ABN-field and ABN-in-ACN-field), trust-name parse, ACN derivation.
- Live fixtures (add to `run-all.sh`):

| Case | Expected |
|---|---|
| TURNKEY CREATIONS PTY LTD, searched as "Canberra Granny Flat Builders" + ABN 67155832732 | 2 ACT + 2 NSW licences; Constable + Walmsley |
| Universal Property Group Pty Limited (ABN 98078297748) | Bhart Bhushan (Director), Raj Mohan (Nominated Supervisor) |
| Ardent Builders Pty Ltd (ABN 84614738751, NSW ABN-only) | found via ABN |
| An ACT record with an 11-digit `licensee_acn` (e.g. value 13673468329) | found via ABN |
| A "P/L" name (e.g. ALFRED BUILDERS (AUST) P/L) | name-only match |
| A NSW family-trust licensee | found via trust name |

- Production load check: Turnkey from the production container (`railway ssh`). Expect
  discovery under 20s, `nswFairTrading` under 45s, zero 429s, and credits per search logged
  (compare ScrapeOps `used_api_credits` before and after).
- `npx tsc --noEmit` in `web/` (Phase 3).

## Budget targets (no ScrapeOps upgrade)

| | Proxy credits per search vs today | NSW time |
|---|---|---|
| Typical (0–3 business names) | about neutral (+2–4 identifier/name queries, −2 from 2.6) | ~7–10s |
| Turnkey (11 business names) | about +6 net (NSW +~8, −2 from 2.6; ACT courts drop 1 name to the cap, saving 2) | discovery <20s; full check ~30s of 45s |

If monthly credits run out, NSW, ACT courts and FWO all fail together. Check usage before
and after shipping.

## Known limits (not solved by this plan)

- A company with no licence of its own, trading under a director's personal licence, can't
  be linked to that person without ASIC officer data (ASIC's DSP is closed until 2027).
- Directors appointed after a licence was recorded don't appear on it.
- Trust names truncated by NSW may still fail to match.
- Only NSW and ACT. Other jurisdictions adopt this via the CLAUDE.md convention when they
  come into scope.
