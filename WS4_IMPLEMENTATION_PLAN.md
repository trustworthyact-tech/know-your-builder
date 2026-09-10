# WS4 Implementation Plan — Integration & Cutover

Source: [Know Your Builder Reliability Plan](https://claude.ai/code/artifact/fd5f3b6c-4ee5-4dea-8df4-e7a45df87da2), Workstream 4 (activities 4.1–4.6), cross-checked
against the actual current state of `server/` and `web/` as of 2026-09-09 (WS0 core, WS1,
partial WS2, and WS3 are already landed per `CLAUDE.md`'s "Incomplete work" log). Companion:
`~/Downloads/RELIABILITY_PLAN_DELIVERY_CONSTRAINTS.md` — the delivery-model note this plan's
"who signs off on what" framing follows.

**How to use this file in a future session:** each activity below has the plan's own ID
(4.1–4.6). They are **not parallelizable as a Wave** the way `SECURITY_REMEDIATION_PLAN.md`'s
waves were — 4.1 is a hard prerequisite for 4.2 and 4.4 (both need the extracted, testable
route handler 4.1 produces), and 4.3 has its own external prerequisite (see "Scope decisions
and open dependency" below). Treat it as a sequence: 4.1 → {4.2, 4.4 in parallel} → 4.5 → 4.6,
with 4.3 slotted in whenever its dependency clears. One activity per branch, per `CLAUDE.md`'s
existing convention — deploy small, watch the daily register-health-check Action.

---

## Scope decisions made before this plan was written

Two things in the source plan document don't match where the codebase already is. Both were
raised with the user and decided explicitly — recorded here so a future session doesn't
re-litigate them:

1. **4.1 covers the original ~16 MVP-scope keys only, not all 29 live scrapers.** The source
   plan's Constraint 1/2 scoped the reliability framework to NSW + ACT + national checks. Since
   that document was written, `CLAUDE.md` shows the other ~13 keys (QBCC, VIC BPC, VIC VBA
   licence, WA Building & Energy, NT Building Practitioners, WA/TAS licence registers, and the
   five manual-link/QLD-VIC-WA-SA-TAS-NT court jurisdictions) were already built and shipped.
   **Decision: leave those ~13 on the existing plain try/catch path, unchanged, for now.** They
   are not being removed or regressed — they just aren't brought under the manifest/breaker in
   this pass. A follow-up "WS4.1b" extending the same mechanism to the remaining keys is real
   future work, not done here.
2. **4.6's expansion proof targets a genuinely new register**, not a re-enable of something
   already shipped (there's nothing "out of scope" left among the 16 in-scope keys to
   re-enable). Candidate chosen below.

## Open dependency this plan does **not** resolve: WS0.5 — RESOLVED 2026-09-10

~~Activity 4.3 ("degradation UX review — confirm Stale / Partial / Unavailable read clearly")
assumes those states are visibly distinct in the report UI. They are not, yet~~ — **WS0.5
landed 2026-09-10**, outside this plan's original activity list, per user decision after a
"go back through the plan" audit found no real reason it had been passed over three sessions
running. See `CLAUDE.md`'s dedicated "WS0.5 — completeness states landed in the report UI"
entry for the full record, including a real bug it surfaced and fixed (13 of the report's
sections build a synthetic `SearchResult` object that was silently dropping
`completeness`/`asOf` before display — only section 8.1 worked correctly until this fix).

4.3 can now run as originally specified, against real UI, not the backend-only fallback
described below.

**This plan did not originally include building WS0.5** (that's ~4–6dd of its own, per the
source document) — it's out of the WS4 activity list, but was pulled forward. Two ways to
proceed were flagged here for a decision at execution time rather than assumed — kept for
the record, superseded by the "landed" note above:
- Land WS0.5 first (recommended if there's room — it's the "highest-value trust fix in the
  plan" per the source doc's own framing), then run 4.3 for real against the actual UI, or
- Descope 4.3 in this pass to a **backend-only** check — confirm the NDJSON stream carries the
  right `completeness` value in each of the four states for a forced-degraded request — and
  revisit the visual review once WS0.5 ships.

---

## Live verification checklist — needs your credentials/access

This sandbox has no `server/.env` (no `CAPTCHA_API_KEY`, `SCRAPERAPI_KEY`, `DATABASE_URL`)
and no Railway access, so every item below is real, structurally-verified work that still
needs a pass with real credentials against a real deploy before it's fully trusted. Nothing
here is blocking — the code is shipped and tested as far as this environment allows — but
each is a genuine gap between "verified here" and "verified for real," recorded once, in one
place, rather than scattered across each commit's own `CLAUDE.md` entry.

1. **Sign off on 4.3's UX review.** Read the published walkthrough —
   [Coverage Signal Review](https://claude.ai/code/artifact/00399edb-10f7-4015-81bc-f92e459f2f60)
   — and answer its four questions (does the coverage caveat register clearly, does it
   compete with a significant-finding banner, is "Clear" + a coverage badge together
   legible, anything you'd change). This is the one item on this list that's a judgment
   call, not a technical check.

2. **Re-run the 4.4 load test against a real staging/preview deploy**, not this sandbox.
   `node server/tests/load-test-ws4.js <concurrency> <timeoutMs>` from a machine that can
   reach it, with real `CAPTCHA_API_KEY`/`SCRAPERAPI_KEY` set server-side so the
   CAPTCHA-gated scrapers actually run instead of failing fast on a bad key — that's the
   only way to reproduce the specific `MAX_CONCURRENT_PAGES` starvation class this activity
   exists to catch. Pull `railway metrics --raw --cpu --memory --json` for the same window,
   same pattern as the 2026-08-28 root-cause session in `CLAUDE.md`. Try concurrency 5 and
   10, per the source plan's own suggestion.

3. **Confirm `DATABASE_URL` is actually set in Railway production**, and that
   `dataset_snapshot`/`register_record` are actually being written to Postgres rather than
   silently running on `datasetStore.js`'s disk-fallback path the whole time. `railway
   variables --kv` or the dashboard confirms the env var; a quick `SELECT dataset_key,
   row_count, status, fetched_at FROM dataset_snapshot;` against the real DB (or the new
   admin health endpoint below, once extended to surface this) confirms it's live.

4. **Sanity-check the four new dataset row-count floors** (`MIN_SANE_ROW_COUNT` in
   `asicDpnDataset.js`: 100, `asicEnforceableUndertakingsDataset.js`: 50,
   `actLicencesDataset.js`: 5,000 licence / 30 disciplinary, `vicBpcDataset.js`: 100 — added
   in the WS0–3 audit pass) against a real refresh. These are estimates from historical
   counts already documented in `CLAUDE.md` (32,001 / 377 / ~943 / etc.), not verified
   against a fresh live pull. Let the existing background refreshers run once with real
   credentials (or trigger them manually) and confirm each real count clears its floor with
   real margin — if any register has shrunk closer to its floor than expected, that's worth
   knowing before it silently starts rejecting genuinely valid smaller updates.

5. **Set `ADMIN_HEALTH_KEY` in Railway** and hit
   `GET https://<production-url>/api/admin/scraper-health` with the `x-admin-key` header
   (see `CLAUDE.md`'s "Checking scraper health" section for the literal steps) to confirm
   it returns real breaker state from production traffic, not just the synthetic state this
   sandbox's tests constructed.

6. **General production smoke test of the WS4.1 cutover** — run one real search (any of the
   fixtures used throughout this file's tests) against production after deploying this
   branch, and compare the report against a pre-cutover report for the same entity if one
   exists. Everything here was verified structurally and against a local dev server with
   fake credentials; it has never run against production with the real orchestrator path.

---

## 4.1 — Orchestrator on the manifest

**Source doc:** 3–4 dev-days. **Current state:** `server/index.js:404–420` already routes 9 of
the 16 in-scope keys (`nswFairTrading`, `courts_nsw`, `courts_federal`, `courts_act`, `asic`,
`asicInsolvency`, `asicExtract`, `fwo`, `atoDebt`) through `runScraper()` via a hand-maintained
`RUN_SCRAPER_KEYS` Set that has to be kept in sync with `manifest.js` by hand — exactly the
"must stay in sync" gap pattern this codebase's own tests already exist to catch elsewhere.
`manifest.js`'s own top comment says invocation closures "stay in `index.js` until the WS4
orchestrator cutover" — this activity is that cutover, for the MVP-scope subset.

**In-scope keys not yet wrapped (7):** `abn` (explicitly deferred here — WS1.7's own note:
"wrapping it in the breaker only makes sense as part of the full manifest-driven orchestrator
cutover (WS4.1)"), `asicDisqualified`, `asicEnforceableUndertakings`, `paymentTimes`,
`modernSlavery`, `actLicences`, `actDisciplinary`. The dataset-backed five already fail open via
`datasetStore.js`'s stale-cache fallback — wrapping them mainly buys uniform `completeness`/
`asOf` stamping and a safety timeout against a hung cache read, not a live-site fix.

**Steps:**
1. Add an `mvpScope: true/false` boolean to each `manifest.js` entry (the 16 keys above `true`,
   the rest `false`). This — not a second Set in `index.js` — becomes the actual source of
   truth, which is what "Orchestrator... derive[s] from it" in the source doc's activity 0.1
   actually meant.
2. Extract the per-request search orchestration currently inline inside
   `app.post('/api/search', ...)` into an exported function — e.g.
   `runSearchRequest({ abn, acn, companyName, tradingName, directors, isDeepCheck }, { send })`
   in a new `server/searchOrchestrator.js` (or `server/scrapers/orchestrator.js`, matching the
   `scrapers/` module convention). This is explicitly called out as WS4.1's job already:
   `test-ws2-live-hardening.js`'s own doc comment says the courts_act manual-fallback branch
   "lives inline in index.js's route handler, which isn't yet extracted into a directly-callable
   function (that's WS4.1's job)." Doing this also unblocks 4.2 — fault-injection tests can call
   it directly instead of spinning up a live HTTP server.
3. Inside the extracted function, replace the current two-loop structure
   (`RUN_SCRAPER_KEYS.has(key)` branch vs. plain try/catch) with: iterate
   `SCRAPERS.filter(s => s.mvpScope)`, call `runScraper(entry, invocations[entry.key], { send })`
   for each; iterate the remaining (non-MVP) entries on the existing inline try/catch, unchanged.
   The `courts_act` open-circuit → `buildManualFallback('act')` special case
   (`index.js:432–435` today) carries over verbatim into the manifest-driven branch.
4. Keep every scraper's own invocation closure (the `fn` bodies currently in the `searches`
   array — `resolveDirectors()`/`resolveExtraSearchTerms()` wiring etc.) exactly as-is; only
   their indexing changes, from array position to a `{ [key]: fn }` map keyed by manifest key.
5. `app.post('/api/search', ...)` itself shrinks to: validate request → set NDJSON headers →
   call `runSearchRequest(...)` → `res.end()`.

**Explicitly not touched:** `web/app/search/SearchContent.tsx`'s `INITIAL_SEARCHES` — already
covered by an existing sync test (per `CLAUDE.md`'s WS0 note) rather than literal runtime
derivation from `manifest.js`; making it import the manifest at build time is a bigger, separate
Next.js-side change not warranted by this activity's budget.

**Exit criteria:** `RUN_SCRAPER_KEYS` Set is gone, replaced by `manifest.js`'s `mvpScope` flag;
`abn` and the five dataset keys are now breaker-wrapped; `test-ws0-pilot.js`,
`test-ws2-live-hardening.js`, `test-ws3-director-discovery.js` all still pass unmodified (their
public contracts — `runScraper`, `getScraper`, `buildManualFallback` — don't change shape); a
live request for the Universal Property Group fixture returns byte-identical result shapes to
before the refactor (diff the NDJSON stream pre/post).

---

## 4.2 — End-to-end + fault injection

**Source doc:** 4–5 dev-days. **Depends on 4.1's `runSearchRequest` extraction.**

New file: `server/tests/test-ws4-fault-injection.js`, following `test-ws2-live-hardening.js`'s
existing shape (`collector()` for `send`, `pass`/`fail`/`step`/`header`/`summary` from
`./lib/helpers`, `scraperHealth._resetAll()` between cases).

**Test matrix:**
1. **Real NSW fixture** — Universal Property Group Pty Limited / ABN 98078297748 (the fixture
   used throughout `CLAUDE.md`'s NSW history). Full run through `runSearchRequest`; assert every
   in-scope key reaches `done` or `error` (none left at `searching` past its manifest
   `timeoutMs`), and that `nswFairTrading`/`courts_nsw` return their known real hits (licence
   85273C, the recorded compliance history).
2. **Real ACT fixture** — Geocon Constructors (ACT) Pty Ltd / licence 2013583 (used throughout
   the WS3 entries). Assert `actLicences`, `actDisciplinary`, `courts_act` return their known
   real hits (partner NIKOLAOS GEORGALIS, the 5 Supreme Court + 2 ACAT decisions).
3. **Known-bad national entity** — reuse whichever fixture `test-asic-eu.js`/the DPN match tests
   already self-discover from the live register (per their existing "self-discovers a real
   current fixture" pattern) to confirm `asicDisqualified`/`asicEnforceableUndertakings` still
   flag correctly end-to-end through the wrapped route, not just in isolation.
4. **Not-found / fictitious entity** — assert a clean `completeness: 'complete'`, zero-result
   outcome across all 16 keys — this is the "silently wrong success" shape the whole reliability
   plan exists to prevent, so it needs its own explicit assertion, not just "didn't throw."
5. **Forced-down injection, one key at a time (16 cases)** — for each in-scope key, force
   `scraperHealth`'s internal state to open (call `recordFailure` `breaker.failureThreshold`
   times, or add a small test-only `forceOpen(key)` helper to `scraperHealth.js` if that's
   cleaner) and assert: `courts_act` degrades to `buildManualFallback('act')` with
   `completeness: 'unavailable'`; every other key degrades to the generic "Temporarily
   unavailable" message with `completeness: 'unavailable'` — and, critically, that no key ever
   reports `completeness: 'complete'` or a "clean" summary while its circuit is open. This last
   assertion is the direct regression test for the exact failure class documented throughout
   `CLAUDE.md` (a degraded check reading as a false "clear").

**Exit criteria:** new test added to `server/tests/run-all.sh`; all 5 matrix rows pass; a
forced-open circuit never produces a false-complete result for any of the 16 keys.

---

## 4.3 — Degradation UX review

**Source doc:** 2 dev-days, product-facing. Per the delivery-constraints note, "is this ready"
is explicitly founder judgment, not something to automate — Claude's role here is prep, not the
call itself.

**What Claude can do:** once 4.2's forced-down fixtures exist, run each of the four completeness
states (Complete / Partial / Stale / Unavailable) against a real report and capture what
actually renders — screenshots via the local dev server (`web/`'s `npm run dev` against a
locally-run `server/`), one per state, plus the NSW/ACT "everything healthy" baseline for
comparison. Package these into a short walkthrough doc (or reuse an Artifact, matching this
project's existing pattern for review material) for the founders to read against the "does this
read clearly, does it alarm without cause" question.

**Blocked on:** the WS0.5 dependency flagged above — see "Open dependency" section. If WS0.5
hasn't landed by the time this activity comes up, descope to the backend-only NDJSON check
described there instead of a visual walkthrough, and revisit.

**Prep delivered (2026-09-10):** WS0.5 landed, so the walkthrough is real UI, not a
backend-only fallback. Published as an Artifact — [Coverage Signal Review](https://claude.ai/code/artifact/00399edb-10f7-4015-81bc-f92e459f2f60)
— four exhibits (clean-but-incomplete, finding + incomplete coverage together, dual badges
on one section, an unavailable check in context), each a real Puppeteer render of the actual
`ReportSection`/`RiskSummaryPanel`/`CompletenessBadge` components against synthetic
sessionStorage data (not mockups), with four specific yes/no questions for sign-off.
**Status: awaiting founder review** — this activity is not "done" until that sign-off
happens; Claude's role stops at prep, per the note below.

**Founder-owned:** the actual sign-off that Stale/Partial/Unavailable read clearly to a
homeowner and don't create false alarm. Not something to mark "done" without that explicit
confirmation.

---

## 4.4 — Concurrency & load test

**Source doc:** 2–3 dev-days.

**Update (2026-09-10):** `load-test-ws4.js` built and run locally at concurrency 3 and 8
against real fixtures — zero crashes, zero contradictory status/completeness combos, no
TTFB degradation, and the same 5 non-mvp-scope keys stuck in both runs (consistent, not
concurrency-induced). Full record in `CLAUDE.md`'s WS4.4 entry, including a real bug found
in the script's own first version (a socket-inactivity timeout that never actually fired
against a stream with intermittent activity, fixed with a plain absolute-deadline timer).
**The real-deploy re-run against staging (below) is still the open item** — this sandbox has
no real credentials, so it structurally can't reproduce the CAPTCHA/Puppeteer-driven
starvation class this activity exists to catch.

New script: `server/tests/load-test-ws4.js` (plain Node, `http` or `axios`, no new dependency —
matches the "no test framework" convention already established). Fires N concurrent
`POST /api/search` requests against a **running** server (this one needs the real Express
process, not just `runSearchRequest` in-process, to also exercise the rate limiter and the NDJSON
streaming path) using the two real fixtures from 4.2, and records: time-to-first-byte,
time-to-last-scraper-done, and a per-key "stuck" count (any key not reaching `done`/`error`
within `manifest.timeoutMs` + a grace window).

**Two real constraints to route around, both already documented in `CLAUDE.md`:**
- `searchLimiter` caps at 20 req/min per IP (`index.js:57–62`) — the load test must either run
  from several source IPs/proxies or the test needs a temporary env-gated bypass; don't point it
  at production and trip the real limiter.
- Every past concurrency incident in this project's history was only reproduced against the real
  Railway container, not locally (CPU/memory metrics pulled via `railway metrics`, direct
  `railway ssh` access already set up per the ACT-courts incident entry in `CLAUDE.md`). Run this
  test twice: once locally for logic correctness (no crash, no unhandled rejection), once against
  a staging/preview Railway deploy for the real signal. A clean local run is not evidence of "no
  starvation" — say so explicitly in the results, don't over-claim.

**Tuning:** only bump `PUPPETEER_MAX_CONCURRENT_PAGES` (env var, no code change needed — already
read at `browser.js:20`) from its current default of 3 if the staging run shows real headroom,
mirroring the 2026-08-28 finding (0.37 of 8 vCPU, 16.6% memory at pool size 3). Note this env var
only affects the non-MVP-scope Puppeteer-heavy scrapers (`waLicenceRegister`,
`tasLicenceRegister`, `qbcc`'s older paths, `asicExtract`) plus the dataset-refresh jobs that use
Puppeteer internally (`vicBpcDatasetRefresh.js`) — none of the 16 MVP-scope keys from 4.1 are
Puppeteer-dependent anymore (they're all either bulk-dataset reads or plain-`axios`/ScraperAPI-
proxied live calls), so this tuning is really validating the framework doesn't regress the
*rest* of the app under MVP-scope load, not fixing an MVP-scope bottleneck.

**Exit criteria:** documented p50/p90/stuck-count for N=5 and N=10 concurrent requests, both
locally and against staging; `PUPPETEER_MAX_CONCURRENT_PAGES` value decided and set (Railway env
var, not code) with the measurement that justified it recorded here or in `CLAUDE.md`.

---

## 4.5 — Runbook + dashboard handoff

**Source doc:** 2 dev-days. **Real gap found while planning this:** WS0.8 (reliability
dashboard) is not built yet either — there is currently no UI to "hand off." This activity is
scoped down accordingly to what actually exists today.

**Update (2026-09-10):** a minimal stopgap now exists ahead of this activity —
`GET /api/admin/scraper-health` (auth via `x-admin-key` header / `ADMIN_HEALTH_KEY` env var),
backed by `scraperHealth.js`'s new `buildHealthReport()`. It's raw JSON behind a `curl`
command, not a UI, and has no persisted history (in-memory, resets on restart) — see
`CLAUDE.md`'s "Checking scraper health" section for the literal usage steps. This activity
(4.5) should still happen for the real thing (a page, not JSON) and for WS0.8's persisted
7-day success rate — the stopgap exists only because "how do we check if this is working"
came up before 4.5 was scheduled.

Given this user's own stored preference for founder-facing docs (**always literal,
click-by-click instructions, never high-level advice** — see `feedback_stepbystep_wp_elementor`
in memory), write `RUNBOOK.md` at the repo root in that style, covering only real, currently-
available levers:
- **Reading breaker state today:** there is no dashboard or admin endpoint — the only way to see
  `scraper_health`'s in-memory Map right now is a Railway log line (`recordFailure`/breaker-open
  events aren't currently logged at all — flagged as a small gap; consider adding one `console
  .warn` in `scraperHealth.js`'s `recordFailure` when a circuit opens, cheap and directly useful
  here). Document exactly this limitation rather than describing a dashboard that doesn't exist.
- **Resetting a breaker:** today, only a full process restart clears it (`state` is a
  module-level `Map`, reset on process start). Document the literal Railway steps to restart the
  service. `_resetAll()` is test-only, not exposed at runtime — note that a runtime reset
  endpoint (`POST /api/admin/scraper-health/reset`, behind a shared-secret header) would be a
  cheap follow-up if breaker resets turn out to be needed often; not built in this pass.
- **Forcing a re-ingest:** the four `start*Refresh()` intervals (`paymentTimesRefresh.js`,
  `asicDpnDatasetRefresh.js`, `vicBpcDatasetRefresh.js`, `asicEuDatasetRefresh.js`/
  `actLicencesDatasetRefresh.js`) only run on their own timer today — no manual trigger exists.
  Document the literal restart-forces-an-immediate-refresh behavior (each `start*Refresh()` runs
  once immediately per `CLAUDE.md`'s description of the pattern — confirm this per-file before
  writing it down as fact) as the current manual-refresh method.
- **Spotting drift:** point at the daily `.github/workflows/register-health-check.yml` run and
  its email-on-failure behavior, plus the documented IP-reputation-noise caveat (`act-licences`,
  `court-records`, `asic-insolvency` fail on GitHub's shared runners sometimes — re-run
  `workflow_dispatch` before assuming a real break).

**Exit criteria:** `RUNBOOK.md` exists, uses literal numbered steps throughout, and does not
describe any tool (dashboard, reset endpoint) that doesn't actually exist yet — each gap is
named as a gap, not glossed over.

**Done (2026-09-10):** `RUNBOOK.md` written at the repo root — six sections (is the site up,
is a specific check broken, resetting a breaker, forcing a re-ingest, the server won't
respond at all, spotting drift), each literal numbered steps, plus an explicit "what's
genuinely missing" section so it doesn't quietly imply a dashboard/reset endpoint/history
exists. The re-ingest claim ("restarting forces an immediate re-pull") was verified against
all four `*Refresh.js` files' actual code this session (WS0–3 audit), not assumed. The
Railway restart step leads with `railway redeploy` (CLI) since that's the one this project's
own history (`CLAUDE.md`'s incident entries) already shows working, with a dashboard-based
fallback flagged as approximate since Railway's UI wording isn't something this session could
verify directly. `CLAUDE.md`'s own "Checking scraper health" section trimmed to a brief
technical pointer at this file, to avoid the same steps drifting out of sync in two places.

---

## 4.6 — Expansion proof

**Source doc:** 1 dev-day. Pass condition (per the source doc, and echoed as the one
objectively-verifiable WS4 item in the delivery-constraints note): touches only a manifest entry
plus one fetch function; anything more means the framework failed its goal.

**Candidate: VIC Supreme Court judgment summaries.** Already de-risked by real investigation
recorded in `CLAUDE.md`'s "VIC/QLD direct-to-court investigation" entry (2026-09-07): a genuine,
static-HTML, no-restrictive-ToS page exists (`courts.vic.gov.au`'s own judgment-summaries page —
real case titles, real PDF links), previously not built because it's rolling-12-months-only and
VCAT (the more relevant tribunal) isn't covered by it. For a scoped *proof* rather than a
production-complete VIC solution, that limitation is acceptable — the point of 4.6 is testing the
framework's marginal cost, not shipping complete VIC coverage.

**Steps:**
1. One new manifest entry in `manifest.js`: `{ key: 'courts_vic_supreme', jurisdiction: 'vic',
   bucket: 2, sourceType: 'live-fulltext-search', mvpScope: false, timeoutMs: 20_000 }` (kept
   `mvpScope: false` deliberately — this is a proof-of-mechanism addition, not a scope change to
   the 16 MVP keys from 4.1).
2. One new fetch function, `fetchVicSupremeResults(companyName)` in a new
   `server/scrapers/courtsVicSupreme.js`, following the existing `courtRecords.js` pattern
   (`fetchOne`/`nameMatchesEntity` conventions already established there).
3. Wire the single new key into `index.js`'s existing non-MVP inline loop (the same place
   `courts_qld` etc. already live) — one line.
4. Time the whole activity from a clean start. If it touches any file outside
   {`manifest.js`, the new scraper file, one line in `index.js`}, or exceeds one day, the proof
   has failed and that's a real, useful finding about the framework, not a reason to force it
   through.

**Fallback if VIC Supreme Court turns out messier than the 2026-09-07 investigation suggested:**
spend at most 2 hours checking whether any of QLD/WA/SA/TAS/NT publish an `actLicences.js`-style
open-data licence dataset (Socrata/CKAN) not yet found — a bulk-dataset addition is an even
cleaner proof of "one manifest entry + one fetch function" than a live court scraper, since it
carries no `resolveExtraSearchTerms`/retry-matrix complexity. Don't spend longer than that
before falling back to the VIC Supreme Court candidate — the point is proving the mechanism, not
finding the theoretically cleanest possible candidate.

**Exit criteria:** elapsed time and file list recorded in this document (or `CLAUDE.md`) once
run; pass/fail against the ≤1-day, manifest-plus-one-file bar stated plainly either way.

---

## Effort summary

| Activity | Source estimate | Status |
|---|---|---|
| 4.1 Orchestrator cutover (16 MVP-scope keys) | 3–4 dd | **Done (2026-09-10)** — see `CLAUDE.md`'s WS4.1 follow-up entry for the execution record |
| 4.2 Fault injection | 4–5 dd | **Done (2026-09-10)** — caught and fixed a real process-crashing bug on its first run, see `CLAUDE.md`'s WS4.2 follow-up entry |
| 4.3 Degradation UX review | 2 dd (+ founder time) | **Prep delivered (2026-09-10)** — [walkthrough published](https://claude.ai/code/artifact/00399edb-10f7-4015-81bc-f92e459f2f60), awaiting founder sign-off |
| 4.4 Concurrency & load test | 2–3 dd | **Local pass done (2026-09-10)** — see `CLAUDE.md`'s WS4.4 entry; real-deploy re-run against staging with real credentials still needed for the signal this activity actually wants |
| 4.5 Runbook | 2 dd | **Done (2026-09-10)** — `RUNBOOK.md` at repo root, descoped to what exists (no 0.8 dashboard yet) |
| 4.6 Expansion proof | 1 dd | Not started — candidate selected, not yet run |
| **Total** | **14–18 dd** | |
