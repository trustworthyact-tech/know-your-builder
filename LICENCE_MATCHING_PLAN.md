# Licence matching plan: identifier-first NSW/ACT licence and people discovery

Status: **Phase 1 done (2026-10-09, branch `fix/licence-matching-phase1`); Phase 2 done (2026-10-09, branch `feature/licence-matching-phase2`, not yet deployed); Phase 2b done (2026-10-11, same branch); Phase 3 done (2026-10-11, same branch) — ship 2, 2b and 3 together; production credit check still to do** (drafted 2026-10-09). Work through the phases in order and
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
- **Business-name caps (revised 2026-10-09, after Phase 1's production check): 10 for the
  NSW licence search; 3 for `courts_act` (2 proxy credits per name) and `fwo`.** The
  original single cap of 10 was decided before one 11-business-name search was measured at
  55 credits; 10 would only have cut it to ~13 terms. Licences are what a trading-name search
  misses most, so NSW keeps 10. ACT licence matching is local and free, so it's uncapped.
  Any future proxy-backed per-name search must pick a cap and check its credit cost
  (constants in `server/scrapers/licenceMatching.js`).
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
  Live: TURNKEY CREATIONS now yields Constable + Walmsley as Directors.
  **Production check (2026-10-09):** one Turnkey search used 55 credits (758 → 813), 0
  HTTP 429s, but `nswFairTrading` timed out queued behind ~42 FWO/ACT court requests — fixed
  with NSW priority in `proxyLimiter.js` (branch `fix/proxy-limiter-nsw-priority`). The
  credit cost makes the Budget targets below wrong for many-business-name companies; see
  CLAUDE.md's "ScrapeOps proxy credits run out" entry before starting Phase 2.

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

- [x] **2.1 Shared module `server/scrapers/licenceMatching.js`.** This is how the logic
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
  - **As built:** also `COURT_FWO_BUSINESS_NAME_CAP = 3`, `searchableName` (normalised, suffix
    dropped — what's typed into a register search), `makeNameMatcher` (compiled once per
    query; minimum significant-word length is 3, not the old 4, so "BHP"-style names work),
    `entityNames(identity)`, and `asIdentity(nameOrIdentity, abn)` so standalone/live-test
    callers can still pass a plain company name. Two refinements to `classifyMatch`'s rule:
    (1) a record is only *rejected* when it carries an identifier of a kind the identity also
    has — a trust (ABN only) is not rejected by a record carrying only its trustee company's
    ACN; it falls back to name-only. (2) When the ABR entity type is unknown (identity lookup
    timed out, or standalone caller), the ABN's last 9 digits become `possibleAcn`: it can
    confirm a match (and NSW searches it) but never reject one. ABR exposes no ACN field, so
    the ACN is always derived from a company's ABN.
- [x] **2.2 Orchestrator** (`server/searchOrchestrator.js`). Build the identity once from
  `abnPromise` (adds about 1–2s before licence discovery starts) and pass it to NSW, ACT and
  people discovery. The typed name becomes the fallback only when there is no ABN. Cap
  `resolveAlternateNames()` output passed to `courts_act` at 10.
  - **As built:** `identityPromise` bounds `abnPromise` at 8s and fails open to the typed
    name/ABN; with no ABN typed it resolves immediately. NSW discovery and ACT people
    discovery start from it; the 20s discovery bound covers identity + NSW. `courts_act` and
    `fwo` get business names capped at 3. The `nswFairTrading` key no longer awaits
    `resolveDirectors()` and no longer gets `markPartialIfNoDirectors()` (it doesn't search
    under person names any more, so a missing person list doesn't make it partial).
    Courts still search under the typed `companyName`, not the legal name — not in this
    plan's scope; a trading-name search still misses court records filed under the legal
    name unless it's also an ABR business name.
- [x] **2.3 NSW** (`nswFairTrading.js`). Queries in priority order, at most 3 concurrent via
  `proxyLimiter`, leaving headroom for courts and FWO:
  - (a) ABN digits, ACN digits and legal name. These feed people discovery and must finish
    inside the 20s discovery timeout.
  - (b) business names (≤10) and trust name. These run in the main `nswFairTrading` key (45s).
  Dedupe by `licenceId`. Fetch one details page per unique licence. Apply `classifyMatch`
  using the hit's `ABN`/`ACN`. Also match the hit's `businessNameList`. Fix the metadata to
  show `ACN` (and `ABN` when present).
  - **As built:** a 3-slot per-search limiter covers searches *and* details fetches. Dedupe
    is by `licenceId` across all queries. Every item carries `metadata.MatchedBy`
    (`ABN` / `ACN` / `Name only — verify`). Rejected hits are logged, not shown. Queries are
    sent normalised (lowercase, suffix dropped). Live: Turnkey typed as "Canberra Granny Flat
    Builders" → 259006C via ACN; Universal → 85273C via ABN; Ardent → 354290C via ABN.
- [x] **2.4 ACT** (`actLicences.js`: licences, disciplinary, `resolveActAssociatedNames`).
  Match `licensee_acn` / `a_c_n` digit-wise against ABN and ACN, plus names (legal, business,
  trust). Apply `classifyMatch`.
  - **As built:** one pass over the rows per search. Entity matches carry `MatchedBy`; rows
    matched only via a person's name (directors/partners passed in) carry
    `MatchedBy: 'Linked person — name match'` — a separate label from `Name only — verify`,
    since the person was linked to the entity by a licence record. **Superseded by 2b.4**:
    that label is gone; person-name matches are `Name only — verify` unless tied by number.
- [x] **2.5 People discovery.** Take Directors / Nominated Supervisor (NSW) and Partners /
  Nominees (ACT) from `confirmed` licences, plus the personal licences NSW lists under each
  party (`parties[].licences`). People from `name-only` licences are included, tagged with
  lower confidence.
  - **As built:** `associatedNames` entries are `{ name, role, confidence: 'confirmed' |
    'name-only' }`; `resolveDirectors()` still flattens them to names. Linked personal
    licences become NSW result items (`MatchedBy: 'Linked on licence record'`, plus
    `LinkedVia: '<role> on licence <number>'`), or `Name only — verify` when the company
    licence they came from was name-only. Each one gets its own details fetch for compliance
    history (1 credit each) — the plan assumed none.
- [x] **2.6 Drop NSW searches under each person's name** in `searchNSWFairTrading`. The
  details payload already links each person's licences, which saves about 2 proxy credits per
  search. Keep ACT per-person matching, which is local and free.
  - **Trade-off seen live:** a licence NSW doesn't link to the person is no longer found —
    e.g. Universal's "Raja Mohan Kamineni" supervisor certificate, which the old name search
    turned up, is not linked under "Raj Mohan" on 85273C.
- [x] Verify (Phase 2): `npm test` 200/200 (new `licenceMatching.test.js`, rewritten
  `nswFairTrading.test.js`); new live `tests/test-licence-matching.js` (9/9, in
  `run-all.sh`); `test-ws3-director-discovery` now passes (was failing on `main`);
  `test-nsw-fairtrading`, `-licence`, `test-act-licences`, `test-act-disciplinary`,
  `test-launch-scope`, `test-ws4-fault-injection` pass. `test-ws0-pilot` fails identically on
  `main` (no local ASIC DPN cache). **Not yet done: the production load/credit check below.**

## Phase 2b: person searches, linked companies, legal + trading names (decided 2026-10-11)

Agreed with the user after Phase 2 was built. Same branch as Phase 2.

- [x] **2b.1 NSW searches names the user typed.** Phase 2.6 dropped *all* person-name
  searches, which made a director-only search run zero NSW queries and report "no licence
  found" — a false clean. Typed names are searched again (in the discovery queries, so their
  linked companies are known in time for courts). Names discovered from a licence record are
  still not searched: the record already links their licences. A typed person's licence found
  by name is `Name only — verify` (could be a namesake).
- [x] **2b.2 Person → linked company.**
  - NSW: a personal licence's details list the company licences the person holds a role on
    (`parties[].licences`, e.g. Constable's 241240C → Turnkey 259006C as Nominated
    Supervisor). Explicit link; the company's details are fetched once for its ACN and
    compliance (1 credit per linked company). Applies to typed people and to people found on
    the searched entity's own licences (phoenix signal).
  - ACT: company licence rows name people in `partners` / `nominees`. Match each listed name
    individually against the person's full name (local, free) — e.g. Frank Walmsley → Turnkey,
    though he holds no licence. Name-based, so these links are verify-confidence.
  - Linked companies carry `{ name, abn, acn, via, confidence }`; the searched entity itself
    is excluded. Their licences appear in the licence results with
    `MatchedBy: 'Linked company — via <person>'` (or `Name only — verify` when the link is
    name-based).
- [x] **2b.3 Linked companies feed the name-based checks.** Legal name only (not their own
  business names — that fans out to 30+ credits), **at most 3 linked companies per search**,
  confirmed links first. Fed into: all court searches, FWO, ASIC enforceable undertakings,
  ACT disciplinary. Not fed into ABN-keyed single-entity checks (ATO debt, ASIC insolvency,
  payment times, modern slavery).
- [x] **2b.4 One uncertainty label.** ACT licences matched via a person: a **nominee** licence
  is confirmed when its licence number appears in a confirmed licence's nominees field
  ("NAME: 20091091-Builder-Class C") → `Linked on licence record`, same as NSW. Every other
  person-name match → `Name only — verify`. The "Linked person — name match" label is removed.
- [x] **2b.5 Courts/FWO search legal name and typed name.** Always both (a typed trading name
  is still searched); the cap of 3 applies only to the remaining ABR business names. About
  +3 credits per search when they differ.

- [x] **2b as built / verified (2026-10-11):**
  - ACT linked companies are also tied **by nominee licence number** when a person's licence
    is confirmed: a company whose nominees field lists that number is a confirmed link even if
    the name is written differently ("N J CONSTABLE"). Partner/nominee *name* links stay
    name-only.
  - A person's linked companies come from people on the searched entity's own licences too
    (phoenix signal), not only from typed names. NSW fetches details for the first 3 linked
    company licences (ACN + compliance); further ones are listed without a fetch.
  - NSW with nothing to search under (no name, ABN or person) now reports `unavailable`, not
    "no licence".
  - **Pre-existing bug fixed along the way:** `fwo.js` sent a blank query for a director-only
    search and its name filter passed every result — six unrelated FWO outcomes on a person
    search. A blank primary query is now skipped.
  - Verified: `npm test` 206/206; `tests/test-licence-matching.js` 12/12 (adds director-only
    "Nickolas Jai Constable" → Turnkey via NSW, and "Frank Walmsley" → Turnkey via ACT);
    full local `runSearchRequest` for Turnkey-as-trading-name (court/FWO terms = legal name +
    2 people + 3 business names; NSW Caselaw uncapped) and director-only Walmsley (Turnkey fed
    into courts/FWO). Related live scripts pass. **Production credit check still not done.**

## Phase 3: report

**Revised 2026-10-11** for Phase 2b (user-approved).

- [x] **3.1 Provenance per result:** `metadata.MatchedBy` — `ABN` | `ACN` |
  `Linked on licence record` | `Linked company — via <person>` | `Name only — verify` —
  shown by `ResultCard` (it already renders metadata generically).
  - Court and FWO results record which search term found them ("found searching: X" — legal
    name, trading name, person or linked company). Check how `courtRecords.js` can carry the
    term through; it doesn't today.
  - The report lists the linked companies found (per person, and how) — section 8.1, near
    the existing associated-companies display.
- [x] **3.2 No licence found by identifier or name:** the summary says "No licence linked
  to this ABN found" (not a clean pass); for a director-only search (no ABN), "No licence
  found under this name", and it says when no linked company could be found.
  People-dependent keys stay `partial` and say why.
- [x] **3.3 `riskGrouper.ts`:** `Name only — verify` results never drive a finding (one rule —
  it's the only uncertain label). `Linked on licence record` results drive findings normally.
  **Records against a linked company** (licences, court cases, FWO) raise a separate,
  lower-severity **"associated company"** finding, never folded into the searched entity's own
  findings — a phoenix signal, not proof against the entity — and only for confirmed links.
  Court/FWO hits found under a person discovered only from a name-only licence are
  verify-only too. Add test cases for each. Saved reports keep their frozen `riskSummary`.
  **Don't deploy Phase 2b before 3.3:** until then a linked company's cancelled licence would
  read as the searched entity's own licensing finding.

- [x] **Phase 3 as built / verified (2026-10-11):**
  - **3.1:** court, FWO and ASIC EU results now carry `matchedTerm` (FWO and ASIC EU gained it;
    courts already had it). The orchestrator labels them with `FoundBySearching`, plus
    `LinkedCompany` / `MatchedBy` for linked-company hits and hits under name-only people —
    pure helpers `buildTermProvenance` / `labelResultsByTerm` in `licenceMatching.js`.
    `ResultCard` shows a "Matched by name only — verify" or "Associated company: X" badge. New
    `web/components/LinkedCompanies.tsx` lists linked companies in section 8.1 (via whom,
    confirmed or name-only, records found), or says none were found when there were people;
    `ReportSection` gained a `children` slot for it.
  - **3.2:** shared `licenceSummary()` — "No NSW contractor licence linked to this ABN found
    (searched by ABN, ACN and name)" / "… found under this name" (no ABN), and found counts
    add "(N matched by name only — verify)". The "none found" linked-company line lives in the
    8.1 list rather than a register summary.
  - **3.3:** `riskGrouper` counts only the entity's own results (drops `Name only — verify`
    and anything with `LinkedCompany`). Confirmed linked-company records (court, FWO, ASIC EU,
    ACT disciplinary, and licences only when cancelled/suspended or with compliance history)
    become one "Associated company …" trigger per company inside **Corporate Structure &
    Phoenix Risk**, never raising its severity — chosen over a new risk-group id so the
    comparison view, saved `riskSummary` shape and emails need no change. New
    `web/lib/riskGrouper.test.ts` (6 tests, `npm test` in `web/` via `tsx --test`).
  - **Two pre-existing person-search bugs fixed** (found rendering a director-only report):
    ASIC insolvency sent a blank name and returned 10 unrelated notices, which the risk
    summary flagged as a significant insolvency finding; ATO debt, payment times and modern
    slavery got the same blank name. All four now report "Not searched — no company name or
    ABN was given" (`status: 'error'`, `unavailable`). And `resolveDirectors()` deduped
    case-sensitively, so NSW's "Frank Walmsley" and ACT's "FRANK WALMSLEY" were searched twice.
  - Verified: server `npm test` 211/211; web `npm test` 6/6 and `tsc --noEmit` clean; live
    `test-licence-matching`, `test-court-records`, `test-fwo`, `test-asic-eu`,
    `test-launch-scope`, `test-ws4-fault-injection`, `test-ws3-director-discovery` pass;
    `/report/preview` rendered with real Turnkey and Frank Walmsley output (plus one synthetic
    linked company to exercise the associated-company path) and checked by screenshot.
  - Not changed: `web/workers/monitoring.ts`'s `detectChanges` still counts raw result totals,
    so linked-company and name-only records would count toward change alerts (the worker isn't
    deployed — see CLAUDE.md). Saved reports keep their frozen `riskSummary`.

## Testing (Phase 2 + 3)

- Unit tests (no network) for `licenceMatching.js`: name normalisation, `classifyMatch`
  (including ACN-in-ABN-field and ABN-in-ACN-field), trust-name parse, ACN derivation.
- Live fixtures (add to `run-all.sh`):

| Case | Expected |
|---|---|
| TURNKEY CREATIONS PTY LTD, searched as "Canberra Granny Flat Builders" + ABN 67155832732 | 2 ACT + 2 NSW licences; Constable + Walmsley |
| Universal Property Group Pty Limited (ABN 98078297748) | Bhart Bhushan (Director), Raj Mohan (Nominated Supervisor) |
| Ardent Builders Pty Ltd (ABN 84614738751, NSW ABN-only) | found via ABN |
| An ACT builder record with an 11-digit `licensee_acn` — DEMOLITION BROTHERS (AUST) PTY LTD, ABN 54616886321 (13673468329 is an electrician, filtered out by occupation) | found via ABN |
| A "P/L" name (e.g. ALFRED BUILDERS (AUST) P/L) | name-only match |
| A NSW family-trust licensee | found via trust name |

- Production load check: Turnkey from the production container (`railway ssh`). Expect
  discovery under 20s, `nswFairTrading` under 45s, zero 429s, and credits per search logged
  (compare ScrapeOps `used_api_credits` before and after).
- `npx tsc --noEmit` in `web/` (Phase 3).

## Budget targets (no ScrapeOps upgrade)

**Revised estimate for Phase 2 as built (not yet measured in production):** NSW per search =
2–3 identifier/legal-name queries + 1 per business name (≤10) + trust name + 1 details per
licence found + 1 per linked personal licence. Turnkey: ~15 NSW credits (was ~6), but
`courts_act` drops from ~14 terms to ~6 (−16) and `fwo` from ~14 to ~6 (−8) with the cap of
3 → roughly 55 → ~35 credits. Typical (0–3 business names): about +2–4.

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
