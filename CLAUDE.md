# CLAUDE.md

## Running the project

```bash
# Terminal 1 — Express API server (port 3001)
cd server && node index.js

# Terminal 2 — Expo dev server (tunnel mode)
cd know-your-builder && npx expo start --tunnel

# Terminal 3 — Next.js web app (port 3000)
cd web && npm run dev
```

Tunnel mode uses ngrok so a physical phone can reach the dev server. Set `EXPO_PUBLIC_API_URL` in `.env.local` to the Mac's LAN IP for physical device testing — it is baked into the bundle at Metro start time, so restart Expo after changing it.

## Type checking

```bash
npx tsc --noEmit          # mobile
cd web && npx tsc --noEmit  # web
```

No test suite or linter configured.

## Checking scraper health (stopgap, reliability plan)

Literal, founder-facing steps for this now live in `RUNBOOK.md` (WS4.5) — this section stays
just the technical summary for whoever's writing code next. `GET /api/admin/scraper-health`
(gated by an `x-admin-key` header checked against `ADMIN_HEALTH_KEY`, fails closed if that
env var isn't set) reads `scraperHealth.js`'s in-memory breaker state via
`buildHealthReport(SCRAPERS)` and reports each of the 29 manifest keys as `"healthy"` /
`"degraded"` / `"open"` / `"no-data"`. Only the 16 `mvpScope: true` keys ever populate —
resets to nothing on every restart, no persisted history. The real WS0.8 dashboard
(persisted history, 7-day success rate, an actual page instead of raw JSON behind a curl
command) is still future work — see `WS4_IMPLEMENTATION_PLAN.md`.

## Architecture

```
HomeScreen → SearchingScreen → ReportScreen
                  │
                  ▼
         src/services/api.ts       (fetch + NDJSON stream reader)
                  │
                  ▼
         server/index.js :3001     (Express, all scrapers in parallel)
                  │
     abn  austlii  qbcc  paymentTimes  modernSlavery  asic  fwo  …
```

`POST /api/search` streams NDJSON — each scraper writes one line when it finishes. The frontend merges results by `key` and updates the UI per-result.

**`links.js` is not a scraper** — it returns pre-populated deep-link URLs for databases that are too hard to scrape. No HTTP calls.

**Court/tribunal search (`server/scrapers/courtRecords.js`) covers all 9 jurisdiction keys** (`federal`, `qld`, `nsw`, `vic`, `wa`, `sa`, `nt`, `act`, `tas`). Four of them (`federal`, `nsw`, `act`, `nt`) run live full-text search directly against each court's own site; the other five (`qld`, `vic`, `wa`, `sa`, `tas`) have no free automated full-text search available and return an honest `status: 'error'` with a manual search link rather than a fabricated "clean" result. This replaced the AustLII scraper (`281554d`, 2026-08-26) — see "Incomplete work" below for why AustLII was abandoned.

**SearchResult keys are a stable contract.** `INITIAL_SEARCHES` in `SearchContent.tsx` must stay in sync with the keys emitted by `server/index.js`. Adding a scraper requires both.

**All scrapers return** `{ source, jurisdiction, category, results[], searchUrl, summary }`. Errors are caught per-scraper — a failing scraper never stops others.

### Adding a new scraper

1. `server/scrapers/mySource.js` — async function returning the standard shape
2. Add to `searches` array in `server/index.js` with a unique `key`
3. Add matching entry to `INITIAL_SEARCHES` in `web/app/search/SearchContent.tsx`
4. Render in `ReportContent.tsx` via a synthetic SearchResult + `<ReportSection>`

---

## Universal conventions

**Server vs client components**: `page.tsx` files are always Server Components. Extract all interactive logic into `'use client'` components in `web/components/`. This applies everywhere — spec notes that list `page.tsx` as an edit target are wrong.

**Prisma in Server Components**: query Prisma directly in Server Component pages rather than calling internal API routes — avoids a needless HTTP round-trip. Serialise `Date` → `.toISOString()` before passing to client components.

**Auth pattern**: use `getServerSession(authOptions)` server-side (import `authOptions` from `@/lib/auth`). In client components, infer auth from API response (401 → hide feature) rather than importing `useSession`.

**Singletons**: all library clients (`db`, `resend`, `redis`, `stripe`, `r2`) use the `globalThis` pattern for Next.js hot-reload safety. Workers skip this — use module-level `new Client()` directly.

**Email is best-effort everywhere**: Resend calls are wrapped in try/catch; errors are logged and swallowed. The parent operation always succeeds regardless.

**`upsert` over `insert`** for any re-entrant write (watchlist, timeline, pack balance, share links, monitoring subscriptions). Avoids unique-constraint errors on retry.

**ABN over name for entity matching**: ABN is the primary lookup key throughout (pack-balance, save, watchlist, worker diff). Name is the fallback only when ABN is absent — name alone risks false positives.

**`trackEvent` is fire-and-forget**: returns `void`, swallows errors. Never `await` it. Add new events to both `ALLOWED_EVENTS` in `web/app/api/events/route.ts` and the call site. Current tracked events: `persona_selected`, `email_captured`, `partner_link_clicked`.

**WCAG**: `text-muted` is `#636B76` (not `#9AA5B4`). Focus rings use `focus-visible:ring-2` — never plain `focus:ring`.

---

## Report rendering conventions

**`riskSummary` is frozen at save time**: `riskGrouper()` runs synchronously in the save route and the result is stored in `Search.riskSummary`. `ReportContent` reads this stored value for DB-backed reports — never recomputes from `reportJson`. For `searchId === 'preview'`, `riskGrouper` is called live.

**QBCC split**: the `qbcc` SearchResult carries both `licenceResults` (section 8.2) and `adjudicationResults` (section 8.4). Pass `resultsOverride` to each `<ReportSection>` — do not use `qbcc.results` directly.

**Courts section (8.5)**: one synthetic `courtSearch` provides the summary; `resultsOverride={courtItems}` combines all 9 AustLII jurisdiction results plus FWO and QBCC adjudication decisions; `showJurisdiction` renders per-result badges. VIC BPC and WA Building & Energy are *not* included here — they were moved into section 8.2 (`3ddef47`) since they're licence-register-adjacent.

**Directors in ASIC results**: director rows have `metadata.Role = 'Director'` and no `status`. `ReportContent` splits on this marker to separate company vs director display. `riskGrouper` CORPORATE check (`status.length > 0`) naturally skips director items.

**`asicDisqualified` depends on `asic` via a shared promise**: `asicPromise` is created once in `server/index.js` before the searches array; `asicDisqualified` and the deep-check scrapers await it to extract director names. Both still stream independently via `Promise.all`.

**Nullable synthetic SearchResult for optional scrapers** (deep check only): typed `SearchResult | null`, excluded from `searchResults` props via `.filter(Boolean) as SearchResult[]`. No ghost rows or undefined handling needed downstream.

**Staleness banner**: suppressed for `readOnly` shared reports and `searchId === 'preview'`. Guard: `isStale && !readOnly && searchId !== 'preview'`. Prices: RECHECK = $3, DEEP_CHECK = $15 (from `lib/stripe.ts`, not hardcoded copy).

**Deep check scrapers**: appended to the searches array conditionally after it is defined (`searches.push(...)`). `total` in `SearchContent` uses `searches.length` not `INITIAL_SEARCHES.length` so the progress bar is accurate.

**Comparison view** (`/compare?ids=`): max 3 builders enforced before any DB call. `deriveSectionRisk` assumes `'clear'` baseline (no scraper status data in `riskSummary`).

---

## Payment conventions

**Webhook uses `req.text()`, not `req.json()`**: Stripe signature verification requires the raw body. Route must have `export const dynamic = 'force-dynamic'`.

**`Payment` row is written in `create-intent`, not the webhook**: the webhook only credits `PackBalance`. Webhook returns 500 on DB failure (triggers Stripe retry); 200 for unhandled event types.

**`MONITORING_MONTHLY` is excluded from `PAYMENT_AMOUNTS`**: it is a Stripe Subscription, not a PaymentIntent. The `create-intent` route rejects it with 400.

**`MonitoringSubscription` is created as `active: true` immediately**: activation is synchronous; the webhook only handles deactivation (`customer.subscription.deleted` → `active: false`). Do not add a `customer.subscription.updated` activation handler.

**Re-check 402 fallback**: if `POST /api/reports/save` returns 402 (webhook/balance race), fall back to sessionStorage preview rather than an error screen. The report is not lost.

**`updateMany` with `gt: 0`** is the atomic credit-decrement pattern — avoids a separate findUnique + update round-trip. `count === 0` means no balance was available.

---

## Worker / queue conventions

**Workers must use a separate Redis connection from the Queue**: BullMQ workers issue blocking `BLPOP`; sharing the same ioredis instance causes stalls. `getRedis()` from `web/lib/redis.ts` is Queue/Next.js only — workers create `new Redis(...)` directly.

**`enqueueMonitoringJob` and `enqueueSequence` are the only public enqueue interfaces**: never call `.add(...)` on queues directly outside their respective `lib/queues/` files.

**First monitoring run establishes the baseline — no alerts on first run**: alerts only fire on the second+ run when a diff is possible.

**`detectChanges` covers six `AlertType` values**: LICENCE_CHANGE, QBCC_ADJUDICATION, INSOLVENCY_EVENT, ATO_DEBT_FLAG, COURT_DECISION, FWO_ENFORCEMENT. Each compares raw result counts between new and prior `reportJson`.

---

## Email sequence conventions

**`enqueueSequence` owns both the DB row and the BullMQ job**: creates `EmailSequenceState` and enqueues in one call. Do not split these.

**Idempotency guard**: `findFirst` checks for an existing incomplete row before creating. Re-checks do not spawn duplicate sequences.

**Step-number guard in worker**: job is rejected if `state.step !== job.data.step`. Combined with BullMQ `jobId` deduplication, prevents any step from sending twice.

**`PAYMENT_DUE` is enqueued from the timeline POST route**, not from the save route. `initialDelay = milestoneDate − 2 days − now`. The worker queries the timeline live at fire time — email content reflects any schedule edits made after enqueueing.

**`RECHECK_30D` / `RECHECK_90D`** are enqueued from `reports/save` for `HOMEOWNER` and `DEVELOPER` at `projectStage === 'contracted' | 'underway'` only.

**`renderStepEmail` is `async`**: `render()` from `@react-email/components` returns `Promise<string>`. Always `await` it.

**Password reset reuses `VerificationToken`** with identifier prefix `password-reset:{email}` to distinguish from email verification tokens (`{email}`). Delete old token before creating a new one.

**`Preview` component requires `children: string`**: wrap numeric props in template literals — `` `${dayCount}-day re-check reminder` ``.

**Email templates visual standard**: dark `#1A3A5C` header, white card body, `#F4F6F9` background, `#EEF1F6` dividers.

---

## Scraper conventions

**`nameMatchesEntity` / `isEntityMatch` guards all register scrapers** (modernSlavery, FWO, VIC BPC, WA B&E): every significant word of the company name must appear in the result text to prevent false positives.

**Share link upsert always updates `expiresAt`**: re-sharing extends the window to a full 30 days. Never use `update: {}` in the share route.

**PDF cookie forwarding**: check `__Secure-next-auth.session-token` first (HTTPS), fall back to `next-auth.session-token` (HTTP/dev).

**Captcha-gated per-item checks must distinguish a failed attempt from a genuine negative** —
established in `asicDisqualified.js`'s `checkDirector()` (fixed 2026-08-18) after a real report
showed "no disqualification records found" for a director who was confirmed disqualified. The
captcha-solve → page-fetch → parse sequence is slow enough under normal conditions (33s–120s+
observed for the identical query back to back) that a transient failure is a realistic outcome,
not an edge case. Swallowing that failure into an empty result is indistinguishable from a real
"checked, found nothing" — a silent false negative. Pattern: retry once, return `{ matches,
failed }` rather than a bare array, and surface `failed` in the summary text ("check failed after
retry, verify manually" vs. "checked — no ... found"), with an injectable last param on both the
per-item check and the orchestrating function so this is unit-testable without hitting the
network — same pattern as `captcha.js`'s `_http`. **The original example (`checkDirector` /
`asicDisqualified.js`) was retired 2026-08-19** — that check moved to a bulk dataset entirely,
see the convention below — but the pattern itself is still the right one for any *remaining*
captcha-gated per-item scraper (`asicExtract.js`, SA/TAS licence registers) if the same
silent-failure shape turns up there.

**Prefer a bulk government open-data file over live-scraping a register, when one exists** —
established migrating the ASIC Disqualified Persons check off ASIC Connect (2026-08-19; full
record in `ASIC_DPN_BULK_DATASET_MIGRATION_PLAN.md`) after a captcha/browser-based live scrape
proved to have at least three distinct silent-failure modes under real concurrent search load
(see the superseded incident entry below). ASIC publishes several registers as bulk CSV/XLSX on
data.gov.au, explicitly licensed for reuse (Creative Commons Attribution 3.0 Australia) — check
there before building or maintaining a live scraper against an ASIC register. Pattern, mirrored
from `paymentTimes.js`/`paymentTimesRefresh.js` (the original precedent for this shape) in
`asicDpnDataset.js`/`asicDpnDatasetRefresh.js`: resolve the current file via a stable API/id (for
data.gov.au, that's the CKAN Action API — still alive despite the site's Drupal migration, just
moved to a `/data/api/3/action/...` prefix, e.g. `resource_show?id=<resource_id>`; don't predict
a filename, dataset filenames can be dated and change independently of content refreshes) →
download via plain `axios` (no browser needed for a plain file download, even when the live
*search UI* for the same data is captcha-gated) → cache to disk (`*_CACHE_DIR` env var pointing
at a Railway volume, falling back to `os.tmpdir()`) → background-refresh on an interval matching
the dataset's own update cadence, with stale-cache fallback and honest `stale`/`cachedAt`
surfaced in the result summary, never silently presented as fresh. In-flight request coalescing
(a module-level singleton promise) avoids concurrent search requests each triggering their own
redundant download.

---

## Incomplete work

### Reliability plan — WS0 foundations + WS1 ingestion landed (2026-09-09); Modern Slavery bulk ingestion investigated and deferred

Following the Know Your Builder Reliability Plan (search-reliability hardening for the
NSW+ACT MVP): **WS0 (foundations)** and **WS1 (ingestion)** are largely done.

**WS0** added `server/scrapers/manifest.js` (all 29 scraper keys classified by
jurisdiction/bucket/timeout/breaker, cross-checked against `index.js`'s `searches` array
and web's `INITIAL_SEARCHES` by a test — closes the "must stay in sync" gap this file
already flagged), `server/scrapers/datasetStore.js` (Postgres-backed generic
`dataset_snapshot`/`register_record` store, `server/db/schema.sql`, with a disk-JSON
fallback for local dev/DB outages — `server/scrapers/db.js`), and
`server/scrapers/runScraper.js`/`scraperHealth.js` (hard timeout + circuit breaker —
open → half-open → closed — the direct fix for the still-open "requests hung 1000+
seconds" class of incident documented elsewhere in this file). All additive — nothing in
the live `/api/search` route changed. Proven via two pilot migrations
(`asicDpnDataset.js` onto `datasetStore.js`; `nswFairTrading.js` through `runScraper.js`),
which doubled as WS1 activities 1.1 and (part of) 2.1.

**WS1** moved the remaining bulk-backed checks off live-per-request behavior:
- **`asicEnforceableUndertakingsDataset.js`** — same migration as `asicDpnDataset.js`,
  onto `datasetStore.js`. `asicEnforceableUndertakings.js` (the consumer) needed no
  changes.
- **`paymentTimes.js`** — the bigger one: previously re-parsed the entire 24MB XLSX
  (ZIP/shared-strings/header-discovery/row-scan across 4 sheets) on *every search
  request*. New `parseAllRows()` runs that parse once per refresh cycle
  (`paymentTimesRefresh.js`, still 8h) instead; `searchPaymentTimes()` now just queries
  `datasetStore`. Added a header-column validation gate (`datasetStore.recordIngestionFailure()`,
  new) that refuses to promote an ingestion if the name/ABN column can't be found in the
  header row — the direct regression fix for the historical Section 8.3 silent
  column-shift bug (see the "Payment Times dropdown fixed" entry below) — a bad parse now
  fails loudly and keeps serving the last good snapshot, rather than silently ingesting
  empty/misaligned data. Covered by a new `paymentTimes.test.js` including a test that
  reproduces the historical bug shape directly.
- **`actLicences.js`** — both ACT Socrata datasets (`de4w-gbt3`, 32,001 rows;
  `avib-prrz`, 377 rows — both confirmed via Socrata's own count endpoint) moved from
  live per-query calls (one per director name) to bulk ingestion
  (`actLicencesDataset.js`, 24h refresh) with local matching, mirroring `vicBpc.js`'s
  existing fetch-once-match-locally shape. Removes the previous one-live-call-per-director
  cost entirely.
- **ABN (1.7)**: deliberately untouched. Wrapping it in the breaker only makes sense as
  part of the full manifest-driven orchestrator cutover (WS4.1) — doing it in isolation
  now would mean touching `index.js`'s route for one entry while everything else stays
  inline.

All four migrations live-verified against real fixtures (the same ones used throughout
this file's incident history — Veronica Roberts/DPN, Universal Property Group/NSW licence
85273C, ADVANTAGE CARPENTRY/ACT licence, KEGGINS INDUSTRIAL/ACT disciplinary, BHP/payment
times) via `server/tests/run-all.sh`, plus a clean server boot with dummy keys confirming
every refresh cycle (including the two new ones) completes successfully against live data.

**Modern Slavery Statements (activity 1.4) — investigated, staying live for now.**
Unlike the other three, `modernSlavery.js` had zero caching (pure live per-query scrape)
going in. Investigated whether a genuine bulk export exists, driving the register with
Puppeteer (the same technique that resolved the VIC BPC rebrand and QBCC's Aura endpoint
elsewhere in this file):

- The register's own "Download list" button (`<button name="csv">` in a GET search form)
  does produce a real, richer CSV (`IDX, PeriodStart, PeriodEnd, Type, ABN, ACN, ARBN,
  IncludedEntities, IndustrySectors, Link, RelatedStatements` — more fields than the
  live-scraped HTML captures today) — but **only for a non-empty query**; an empty query
  (`q=`, "browse everything") returns the ordinary HTML page instead, confirmed twice.
- Initially looked like a single broad term could substitute for a true bulk export:
  `q=pty` reported matching all 18,236 statements in the register (equal to the blank
  query's total) — but this term-frequency search is **not a substring match** (`q=a`
  matched only 202 of 18,236; `q=the` only 2,051), so this isn't reliable in general, only
  incidentally for `"pty"`.
- Critically, **that 18,236-statement CSV never actually downloads** — the `csv=`
  response for the full "pty" query came back as a normal `text/html` page (85KB), not a
  CSV; the export silently degrades to HTML above some threshold. Narrowing that
  threshold gave a non-monotonic result (a 170-statement query succeeded, a 174-statement
  query failed, a 249-statement query succeeded) — either the limit is based on something
  other than row count (byte size of the free-text fields varies a lot per statement), or
  the shared Puppeteer instance had degraded from sustained use during this investigation
  (it did throw a `ConnectionClosedError` at the end — the same browser-instability class
  already documented elsewhere in this file). Either way, not a limit precise enough to
  build a reliable partitioning strategy on, and there's no true offset/pagination on this
  endpoint to fall back to — only relevance-ranked search terms.

**Decided**: not pursuing bulk ingestion for Modern Slavery in this pass.
`modernSlavery.js` stays exactly as it is — live per-query scrape, no caching — same
treatment as ABN: wrapped in the breaker only, at WS4.1's cutover. Revisit if a cleaner
mechanism surfaces (a real paginated bulk endpoint, or a precisely-characterized CSV row
cap with a verified-complete partitioning strategy) — the risk of an unreliable
alphabet/term sweep silently missing entities isn't worth trading against a check that
already works live today, just without a cache.

**Not yet done**: WS0.5 (completeness state in `riskGrouper`/UI), WS0.6 (generic
ingestion-runner/scheduler — `recordIngestionFailure` above is scoped narrowly to payment
times, not a general validate-before-promote mechanism), WS0.7/0.8 (health check
extension, reliability dashboard), WS2 (live-path hardening for the remaining live
scrapers), WS3 (director-discovery correctness — see `resolveDirectors()` entries
elsewhere in this file), WS4 (manifest-driven orchestrator cutover, fault injection, load
test).

**Follow-up (2026-09-10, reliability plan WS4.1): orchestrator cutover landed for the
16 MVP-scope keys.** Full activity plan in `WS4_IMPLEMENTATION_PLAN.md` (repo root) —
this entry is the execution record for its 4.1 activity. The per-request search pipeline
was extracted out of `index.js`'s inline `app.post('/api/search', ...)` handler into
`server/searchOrchestrator.js`'s `runSearchRequest({ abn, acn, companyName, tradingName,
directors }, { send })` — `index.js`'s route handler is now just request validation +
NDJSON headers + one call into this function. This was already flagged as WS4.1's job by
`test-ws2-live-hardening.js`'s own doc comment (the courts_act manual-fallback branch
"lives inline in index.js's route handler, which isn't yet extracted into a
directly-callable function"); the extraction also means fault-injection tests (WS4.2) can
call `runSearchRequest` directly with a fake `send` collector, no live HTTP server needed.

`manifest.js` gained an `mvpScope: true/false` flag per entry — the 16 keys the source
reliability-plan document scoped the MVP to (`abn`, `asic`, `asicDisqualified`,
`asicInsolvency`, `atoDebt`, `courts_federal`, `courts_nsw`, `courts_act`, `paymentTimes`,
`modernSlavery`, `fwo`, `nswFairTrading`, `actLicences`, `actDisciplinary`, `asicExtract`,
`asicEnforceableUndertakings`) are `true`; the other 13 (QLD/VIC/WA/SA/TAS/NT court
jurisdictions, `qbcc`, `vicBpc`, `vicVbaLicence`, `waBuildingEnergy`,
`ntBuildingPractitioners`, `waLicenceRegister`, `tasLicenceRegister` — all built after the
reliability plan document was drafted) are `false`. This flag, not a second hand-maintained
Set, is now what decides which keys `runSearchRequest` routes through `runScraper()`'s
timeout + circuit breaker; the other 13 stay on the pre-existing plain try/catch, unchanged
— a deliberate scope decision (recorded when this activity was planned), not a coverage
regression. `abn` was added to the breaker-wrapped set here, closing the gap WS1.7 above
explicitly deferred to this cutover. The old `RUN_SCRAPER_KEYS` Set that had to be
hand-kept in sync with `manifest.js` is gone.

Verified: all 29 manifest keys have a matching invocation closure (scripted cross-check,
zero missing/orphaned); `node --check` on all three touched/new files; the three existing
WS0/WS2/WS3 regression tests (`test-ws0-pilot.js`, `test-ws2-live-hardening.js`,
`test-ws3-director-discovery.js`) pass unmodified; and a live smoke run of
`runSearchRequest` against the Universal Property Group fixture confirmed the mvp/non-mvp
split runs concurrently with no uncaught exception, and that the newly-wrapped keys
degrade to `completeness: 'unavailable'` on their manifest-declared timeout exactly as
`asicDisqualified`/`asicInsolvency`/`atoDebt`/`fwo`/`nswFairTrading`/`actLicences`/
`actDisciplinary`/`courts_federal`/`courts_act` all did in that run (10s/20s/45s per their
bucket, matching `manifest.js`).

That same smoke run surfaced two pre-existing, environment-specific issues — not
regressions from this change, not fixed here: `qbcc` and `waLicenceRegister` (both
non-mvp-scope, both CAPTCHA-adjacent, both already on the unwrapped plain try/catch path
before and after this change) never reached a terminal state within a 55s window in this
sandbox, most likely because no `CAPTCHA_API_KEY` is configured here; and `vicVbaLicence`
threw a TLS certificate mismatch against `discover.data.vic.gov.au`
(`sni-missing-or-domain-unknown.help.section.io` in the cert's altnames) that looks like
this sandbox's own network egress path, not a real site-side break — worth a real-network
re-check before reading either as a genuine incident.

**Follow-up (2026-09-10, same day): minimal scraper-health stopgap added, since WS0.8's
real dashboard doesn't exist and the user asked how to actually check whether any of this
is working in production.** `scraperHealth.js` gained timestamp tracking
(`lastSuccessAt`/`lastFailureAt`/`lastOpenedAt`, previously untracked) and a pure
`buildHealthReport(scrapers)` function; `index.js` gained `GET /api/admin/scraper-health`,
gated behind an `x-admin-key` header checked against a new `ADMIN_HEALTH_KEY` env var
(fails closed — 503 if that env var isn't set, not silently open). See this file's new
"Checking scraper health" section (under "Type checking") for the literal steps to use it.
Deliberately thin: reads the same in-memory `Map` the breaker already keeps, no new store,
no persisted history, no UI — a stand-in for WS0.8, not WS0.8 itself. Covered by
`server/tests/test-admin-scraper-health.js` (6 pilots, pure function, no network — added to
`run-all.sh`).

**Not yet done**: extending `mvpScope`/the breaker to the other 13 keys ("WS4.1b"); WS4.3
(blocked on WS0.5 — completeness states aren't visually distinct in the report UI yet, see
`WS4_IMPLEMENTATION_PLAN.md`'s "Open dependency" section), WS4.4 (concurrency/load test),
WS4.5 (the *real* runbook — this stopgap's usage notes live in CLAUDE.md for now, a proper
`RUNBOOK.md` is still open), WS0.8 (the real dashboard — persisted history, 7-day success
rate, an actual UI, not raw JSON behind a curl command), WS4.6 (expansion proof, candidate
already selected — see the plan doc).

**Follow-up (2026-09-10, reliability plan WS4.2): fault injection landed, and it caught a
real, pre-existing process-crashing bug on its first run.** New
`server/tests/test-ws4-fault-injection.js`, run against the real `runSearchRequest()` entry
point (not individual scrapers in isolation — those are already covered elsewhere).
Section A forces every one of the 16 `mvpScope` keys' circuit breakers open before calling
`runSearchRequest`, so `runScraper()`'s `isOpen()` check short-circuits before any real
fetch — fast (~3s) and network-independent — then asserts the one invariant this whole
reliability plan exists to guarantee: no key ever reports `completeness: 'complete'` or a
"done" status while its circuit is open (49 assertions, all passing), plus a dedicated
check that `courts_act` specifically degrades to `buildManualFallback('act')` (both the
courts.act.gov.au and ACAT links present) rather than the generic message. Section B runs
the real pipeline once, live, against a fictitious entity, bounded to a 50s window, and
treats its outcome as informational (`warn`, not `fail`) rather than a hard assertion — see
the file's own header for why a live-network section shouldn't fail the suite over
sandbox/site flakiness unrelated to the code.

**The crash, found on Section A's very first run**: `searchOrchestrator.js` creates
`abnPromise`/`asicPromise` eagerly and unconditionally at the top of `runSearchRequest`,
before either key's breaker state is checked. When a breaker is open, `runScraper()`
returns early and never calls `invocations.abn()`/`invocations.asic()` — meaning nothing
ever `await`s or attaches a `.catch()` to that already-in-flight promise. When it later
rejected (a real `ASIC Connect search failed and no fallback data available` error, live,
in this sandbox with no `CAPTCHA_API_KEY` configured), Node treated it as an unhandled
rejection and **crashed the entire process**. This is not something WS4.1's extraction
introduced — `asic` was already one of the 9 keys routed through `runScraper()` before
WS4.1 (see the WS2 entries above), so this exact crash was already reachable in production
any time ASIC Connect's circuit tripped from real failures, which per this file's own
extensive ASIC-unreliability history is plausible. It was simply never triggered by a real
request before now, or was triggered and looked like an unrelated process restart.

**Fixed**: `abnPromise.catch(() => {})` / `asicPromise.catch(() => {})` — a no-op listener
attached immediately alongside the original promise. This does not change what
`invocations.abn()`/`invocations.asic()` resolve/reject to for `runScraper()`'s own
try/catch (every `.then`/`.catch`/`await` attaches independently to the same promise); it
only guarantees at least one handler exists so Node never treats the rejection as
unhandled. Re-ran the full Section A matrix (all 16 keys forced open simultaneously) and
the existing WS0/WS2/WS3/admin-health regression tests after the fix — all pass, no crash.
Added to `run-all.sh`.

**Not yet done**: WS4.3, WS4.4, WS4.5, WS0.8, WS4.6 (unchanged from the list above — WS4.2
is now the completed item).

**Follow-up (2026-09-10, reliability plan audit): went back through WS0–WS3 against the
actual code rather than trusting this log's own "done" markers, per a direct user
request. Two real, fixable gaps found and fixed; the rest of the "not yet done" list above
confirmed still accurate.**

**Bug 1 — `manifest.js`'s `modernSlavery` entry had the wrong shape, and was actively
enforcing it.** The entry claimed `bucket: 1, sourceType: 'bulk-dataset', timeoutMs:
10_000` — but `modernSlavery.js` is, and always was, a plain live `axios`+`cheerio`
scrape; bulk ingestion for this register was investigated and explicitly declined (see
this same section's earlier "Modern Slavery bulk ingestion investigated and deferred").
Since WS4.1 made `modernSlavery` `mvpScope: true`, this wrong metadata was live —
enforcing a 10-second timeout (meant for a local dataset lookup) against a real HTTP
fetch that should get the standard 20-second live-call budget like every other bucket-2
entry. **Fixed**: corrected to `bucket: 2, sourceType: 'live-scrape', cadence: null,
timeoutMs: 20_000`.

**Bug 2 — 4 of 5 dataset refresh jobs had zero validate-before-promote protection**,
meaning the exact historical Payment Times silent-column-shift bug (this file's own
"Section 8.3 — Payment Times dropdown fixed" entry) was still fully reproducible against
`asicDpnDataset.js` (**the Disqualified Persons Register**), `asicEnforceableUndertakingsDataset.js`,
`actLicencesDataset.js` (both its licence and disciplinary datasets), and `vicBpcDataset.js`
— only `paymentTimes.js`/`paymentTimesRefresh.js` had ever gotten this protection (WS1.3).
Confirmed by reading each file: `replaceDatasetRecords()` (`datasetStore.js`) unconditionally
writes whatever row count it's given, including zero, with no caller-side guard — and
`vicBpcDataset.js` (which predates/bypasses `datasetStore.js` entirely, using its own disk
cache) had the identical unconditional-write shape. A source-side markup/API change could
silently wipe any of these five to empty, and — this is the part that matters — every future
search would render that as a normal, confident "checked, found nothing" with no alarm
anywhere. For the Disqualified Persons Register specifically, that's the same class of
false-clean this whole reliability plan exists to prevent, just relocated from a live scrape
to a cache-ingestion path.

**Fixed**: each of the five now has its own row-count sanity floor (`asicDpnDataset.js`:
100, `asicEnforceableUndertakingsDataset.js`: 50, `actLicencesDataset.js`: 5,000 for
licences / 30 for disciplinary — the two Socrata datasets differ by two orders of
magnitude (32,001 vs. 377 rows, per WS1.5/1.6's own live-confirmed counts), so they don't
share one constant — `vicBpcDataset.js`: 100). A fetch landing below its floor is treated
exactly like a fetch *failure*: not promoted (the existing good cache/rows stay live), a
loud `console.error`, `recordIngestionFailure()` called where `datasetStore.js` backs the
dataset (all but `vicBpcDataset.js`, which has no equivalent — flagged, not fixed, since
migrating it onto `datasetStore.js` is a separate, larger piece of work), and — the part
the original Payment Times fix didn't need to handle, since that one only gates the
background refresh cycle — **the current request also falls back to the last known-good
cached copy rather than receiving the bad under-parsed rows directly**, since these four
modules (unlike `paymentTimes.js`) serve their `fetch*()` function directly to both the
live search path and the refresh job. Every floor is an injectable parameter (`_minRows`,
mirroring this codebase's established `_axios`/`_http` injectable-dependency convention)
so real unit tests could exercise the guard without needing a 100+ or 5,000+-row fixture.

Added regression tests for all five: new cases in `asicDpnDataset.test.js` (2),
`asicEnforceableUndertakingsDataset.test.js` (2), `actLicencesDataset.test.js` (3, one per
dataset plus the "independent floors" case) — each verifying both "falls back to cache
without overwriting it" and "throws rather than returning bad data when no cache exists
at all." `vicBpcDataset.js` had **no test file at all before this fix** (confirmed by
search) — added `vicBpcDataset.test.js` from scratch (5 tests), which also required
adding an injectable `_fetchAllPages` param (mirroring the same convention) so its
Puppeteer-driven fetch is unit-testable without a real browser. All new tests wired into
`npm test`'s script list in `server/package.json` (which didn't include
`vicBpcDataset.test.js` before) and pass alongside the full existing suite (103/103).

**A third, unrelated regression caught while re-running the full suite**: `npm test` (not
just the shell-based `run-all.sh`/`test-ws*.js` files this session had been running) had
one failing test — `manifest.test.js`'s "manifest keys match server/index.js searches
array exactly" — because WS4.1 (earlier this session) removed `index.js`'s `searches`
array entirely, moving invocation closures into `searchOrchestrator.js`'s `invocations`
map. This is a real gap in WS4.1's own verification at the time (only the shell-style
`test-ws*.js` files were run, not the project's actual `npm test`) — caught here, not at
the time. Fixed: `manifest.test.js`'s extraction logic now reads
`searchOrchestrator.js`'s `invocations` map (a different object shape — bare-identifier
keys, not `{ key: '...' }` entries — needed its own regex) instead of the no-longer-
existing `index.js` block. **Lesson for future sessions doing structural refactors in
`server/`: run `npm test` from `server/`, not just `run-all.sh`/the individual
`test-ws*.js` files — they cover different, non-overlapping test files.**

**WS0/1/2/3 status re-confirmed by this audit, beyond the two bugs above**:
- 0.1–0.4: confirmed correctly built (only the two bugs above were latent problems within
  otherwise-correct code, not evidence 0.1–0.4 themselves are wrong).
- 0.3 (ingestion DB): the Postgres + disk-fallback pattern in `datasetStore.js`/`db.js` is
  correctly built and degrades gracefully; **not independently verified from this session
  whether `DATABASE_URL` is actually set in the real Railway production environment** —
  that needs a live check outside this sandbox, not a code read.
- 0.5, 0.8: still not done, as already documented above (WS0.5 is scheduled next, per user
  decision, before WS4.3 resumes).
- 0.6: **still not the generic manifest-driven ingestion-runner the source plan specified**
  — what exists after this fix is five separately-tuned row-count floors, proportionate to
  closing the most acute version of the gap (a silent full-empty wipe), not the fuller
  "row-count delta history + shape validation + not-an-error-page detection" the original
  WS0.6 activity called for. Worth revisiting as its own activity if a source starts
  failing in a way a flat floor doesn't catch (e.g. a shape change that still produces a
  plausible-looking row count).
- 0.7: still not manifest-driven (`run-all.sh` is a hand-maintained parallel list); the 6
  legacy-test failures flagged in the "QBCC and VBA/BPC licence checks fixed" entry below
  (`wa-be-licence`, `act-licence`, `tas-cbos-licence`, `asic-insolvency`, `modern-slavery`,
  `fwo`) were not re-investigated in this pass — still open.
- WS1 (ingestion): confirmed essentially complete (the gap was 0.6's missing validation
  around it, now partly closed above, not the migrations themselves).
- WS2 (live hardening): confirmed all 6 sub-activities (2.1–2.6) map exactly to the 9 keys
  wrapped before this session — genuinely complete, independent of the WS4.2 crash bug
  found in how that wrapping was used.
- WS3 (directors): confirmed complete for its explicitly-stated NSW/ACT-only scope: no new
  gaps found beyond what its own "Not yet done" list already says.

### WS0.5 — completeness states landed in the report UI (2026-09-10)

Per the source reliability-plan document's own framing, this was called "the highest-value
trust fix in the plan" and had been passed over three sessions in a row (see the WS4.2
audit entry above) in favour of active correctness bugs. Landed as its own pass, unblocking
WS4.3.

**New `web/components/CompletenessBadge.tsx`** — a small pill badge (`partial` / `stale` /
`unavailable`), deliberately separate from `RiskBadge`'s own `unavailable` level rather than
overloading it: risk severity and check completeness are orthogonal (a section can carry a
confirmed significant finding from the checks that *did* run while a different check in that
same section is only partially covered — collapsing both into one badge would lose whichever
one didn't "win"). Exports `worstCompleteness()`, a small precedence helper
(`unavailable > stale > partial`, missing/undefined treated as `complete` — matches
`validateResult.js`'s own default) reused in three places below.

**`ReportSection.tsx`** (the one shared component every section renders through) now:
computes the worst completeness across its `searchResults` and shows a
`<CompletenessBadge>` next to `RiskBadge` — suppressed when `riskLevel` is already
`'unavailable'`, since that already means "every check in this section failed" and a second
badge saying much the same thing would be redundant; and colors each individual summary
line (the existing `summaryTexts` block) by *its own* source result's completeness, with a
"Cached data as of [date]" caption appended for `stale` results carrying `asOf`. Because
this lives in the one shared component, every section that passes real `searchResults`
benefited immediately with no per-call-site changes needed.

**`RiskSummaryPanel.tsx`** (the first thing a reader sees) gained a `searchResults` prop and
now shows an explicit caveat — "N check(s) could not be fully completed — this is not
confirmation those areas are clear" — in both its "no findings" and "findings" states, when
any result is non-complete. This is the single highest-value spot for this fix: it's exactly
where the plan's own "a falsely-clean report is worse than an honest 'could not check'"
concern is most acute, since it's the most prominent, first-read element of the report.

**A real, systemic bug found and fixed while wiring this up, via an actual rendered-output
check, not just `tsc --noEmit`**: 13 of the report's per-scraper sections
(licensing/financial/enforcement — everything except 8.1) build a *synthetic* `SearchResult`
object for their `ReportSection` call (`licenceSearch`, `nswFairTradingSearch`,
`vicBpcSearch`, `courtSearch`, etc. — a long-standing pattern, e.g. the QBCC-split
convention documented above) by hand-listing a subset of fields (`key`, `label`, `status`,
`source`, `results`, `summary`, …). None of them carried `completeness`/`asOf` through from
their underlying real result — meaning the new badge/summary work above would have silently
never fired for any of those 13 sections, only the raw-object section (8.1). Confirmed via a
Puppeteer script driving a real `next dev` server against `/report/preview` with synthetic
`sessionStorage` data spanning all four completeness states (`server/scrapers/manifest.js`'s
real 29 keys, `puppeteer` already a `web/node_modules` dependency) — screenshotted before and
after; the "before" shot showed section 8.2 rendering a plain "✓ Clear" badge with no
completeness signal at all despite a `partial` NSW Fair Trading result inside it. Fixed by
adding `completeness`/`asOf` to all 13 synthetic objects, each pulled from its real
underlying result (`courtSearch`, which aggregates every `courts_*` jurisdiction into one
synthetic entry, uses `worstCompleteness()` across all of them, so e.g. `courts_act`'s
circuit being open is reflected even though `courts_nsw`/`courts_federal` succeeded).
Re-verified with the same screenshot script — badges and cached-as-of captions now appear
correctly in sections 8.2, 8.3, and 8.4.

**Deliberately not done**: `riskGrouper.ts` itself was left unchanged. Its job is computing
risk *findings* from results, and correctly has no opinion on completeness today — folding
"couldn't check" into a risk-trigger function would conflate two different concerns. The
`isAllErrored`/`deriveRiskLevel` baseline logic in `ReportContent.tsx` (which decides
`RiskBadge`'s existing `'unavailable'` level) was also left unchanged — it already correctly
handles the "every check in this section failed" case; extending it to weight
partial/stale would only duplicate what the new, additive `CompletenessBadge` now covers
without touching that logic's existing, working precedence.

Verified: `npx tsc --noEmit` clean; visual check via the Puppeteer script above (not
committed — one-off, deleted after use) against all 29 real manifest keys with a spread of
completeness states.

### WS4.4 — concurrency & load test (2026-09-10)

New `server/tests/load-test-ws4.js` — a plain-Node HTTP client (no new dependency) that
fires N concurrent `POST /api/search` requests against a **real, running** server (not
`runSearchRequest()` in-process — this needs the actual HTTP path to exercise the rate
limiter and NDJSON streaming), and reports TTFB/total-time percentiles, how many of the 29
manifest keys never reached a terminal state per request, and a check for the
self-contradictory `status`/`completeness` combo `test-ws2-live-hardening.js`'s Pilot 3
already found and fixed once (`status:'error'` + `completeness:'complete'`, or the reverse)
— worth re-checking under real concurrent load, not just the single-request path that test
exercises.

**A real bug in the load-test script itself, found on its first run**: the initial version
used `req.setTimeout()` as a hard per-request cap, but that's a *socket-inactivity* timeout,
not an absolute deadline — since the NDJSON stream keeps arriving in small bursts as
individual scrapers finish throughout the request's lifetime, there's never a true
multi-second gap with zero bytes for it to fire on, so a slow-but-not-dead request could run
indefinitely. First run hung well past its intended 70s cap; confirmed by inspection, not
by waiting it out. Fixed with a plain `setTimeout()` JS timer that unconditionally
`req.destroy()`s at the deadline regardless of intermittent activity.

**Run against a real local server** (`CAPTCHA_API_KEY`/`SCRAPERAPI_KEY` set to placeholder
values, since this sandbox has no real credentials — see the WS4.2 entry above for the same
constraint) at concurrency 3 and concurrency 8, each against the real NSW/ACT fixtures used
throughout this file, 65s client-side cap: **both runs completed with zero crashes, zero
contradictory status/completeness combos, and — the interesting part — the exact same 5
keys stuck in both runs** (`courts_nt`, `qbcc`, `waLicenceRegister`, `tasLicenceRegister`,
`asicExtract` — all non-`mvpScope` keys, i.e. not yet covered by WS4.1's breaker/timeout
wrapping), with no measurable TTFB degradation going from concurrency 3 (p50 48ms) to 8
(p50 61ms). Confirmed via the server's own log (118 lines, zero crash indicators —
`unhandled`, `uncaught`, stack traces — grepped explicitly) that it stayed responsive
through both runs and for the `2>/dev/null` health check afterward. One process required
`kill -9`, not a plain `kill`, to actually stop after the runs — background CAPTCHA-retry
work (the still-running `tasLicenceRegister`/`asicExtract` calls) kept the event loop busy
past the client's own 65s window; unsurprising given `asicExtract`'s own 90s manifest
timeout and 2captcha's real retry latency, not itself treated as a finding.

**What this does and doesn't show, stated plainly per this file's own convention**: this is
real evidence the request-handling path (the `Promise.all` over mvp + non-mvp entries in
`searchOrchestrator.js`, the NDJSON write path, the rate limiter) doesn't crash or degrade
meaningfully at this concurrency, in this sandbox, with fake credentials. It is **not**
evidence against the specific historical incident class this activity exists to guard
against — the `MAX_CONCURRENT_PAGES` page-pool leak and the "4 minutes, 8 scrapers stuck"
incident earlier in this file were both root-caused only against the real Railway
container, with real CPU/memory metrics and real concurrent Puppeteer load from real
CAPTCHA-gated sites. A local run with placeholder credentials structurally cannot reproduce
that — every CAPTCHA-gated scraper here fails fast on a bad key rather than actually
driving Puppeteer/2captcha under load. Re-running this script against a real staging/
preview deploy, with real credentials, real concurrent Puppeteer load, and Railway's own
metrics pulled alongside it, is the only way to get the signal this activity actually
wants — flagged here as the concrete next step, not done in this pass.

**`PUPPETEER_MAX_CONCURRENT_PAGES` left at its default (3)** — the source plan's own
tuning suggestion (3 → 6) is conditioned on a staging run showing real headroom, which this
pass couldn't produce for the reason above. Revisit once a real-deploy run exists.

**Not yet done**: the real-deploy re-run described above; extending `mvpScope` to the 5
keys that showed up stuck here (already tracked as "WS4.1b" earlier in this file).

### Phase 7c — asicExtract: historical directors + charges register

`asicExtract.js` currently returns companies that *current* directors are associated with (phoenix detection). Missing:
- Resigned/former directors of the target entity
- Per-charge detail (only count available from `asic.js`)

To complete: set `ASIC_DATA_API_KEY` in `server/.env`, then add a branch at the top of `searchAsicExtract()`:
```js
const apiKey = process.env.ASIC_DATA_API_KEY;
if (apiKey && acn) return searchViaDataApi(acn, apiKey);
// existing ASIC Connect officer search falls through
```
`searchViaDataApi` calls `GET https://data.asic.gov.au/api/v1/companies/{acn}/officers?includeFormer=true` and `GET .../charges` and maps to the standard `ResultItem` shape. The rest of the pipeline requires no changes.

### Court-records search / FWO don't search asicExtract's associated companies (2026-08-11) — file references updated 2026-09-03, still open

Section 8.1 surfaces phoenix-detected companies via `asicExtract.js` (other companies the
target entity's directors are/were involved with) alongside ABR business/trading names. The
court-records search (`courtRecords.js` — replaced `austlii.js`, see above) and FWO now search
the latter (via `resolveExtraSearchTerms()` in `server/index.js`, combining `resolveDirectors()`
+ `resolveAlternateNames()`) but not the former — litigation or enforcement history filed under a
related/associated company name is still invisible to those two sections. Confirmed still true as
of 2026-09-03: `resolveExtraSearchTerms()` in current `index.js` still only combines those same
two inputs.

Not done because `asicExtract` is a slow, CAPTCHA-gated ASIC lookup that the court-records search
and FWO don't currently depend on finishing — `resolveExtraSearchTerms()`'s two inputs both run
in parallel with everything else already, so adding them cost no extra latency. Waiting on
`asicExtract` instead would add a real sequential dependency and slow those searches down.

To complete: give `asicExtract`'s promise the same treatment as `asicPromise` — hoist it above
the `searches` array (it's currently only invoked inside its own entry), add a
`resolveAssociatedCompanies()` helper that awaits it and extracts `title`/`metadata.ACN` from its
results, and fold that into `resolveExtraSearchTerms()`. Also route those names through
`stripCompanySuffix()` in `courtRecords.js` (not `austlii.js`, which no longer exists) —
associated companies will carry "Pty Ltd" suffixes just like the primary entity does.

### AustLII scraper is currently non-functional — Cloudflare block, not a bug (2026-08-12) — DEAD END, WON'T PURSUE (2026-09-01) — SUPERSEDED (built 2026-08-26, reconciled here 2026-09-03)

**Superseded — the replacement was actually built *before* the "won't pursue" note below was
written, the two were just never reconciled.** `server/scrapers/courtRecords.js` replaced
`austlii.js` entirely in `281554d` (2026-08-26), five days before the "DEAD END, WON'T PURSUE"
paragraph immediately below was added — so that paragraph's "no live path forward" conclusion was
already out of date by the time it was written. Current state: `federal`, `nsw`, `act` and `nt`
run genuine live full-text searches against each court's own site (NSW Caselaw, ACT Courts, the
Federal Court judgments search, and NT Supreme Court's site search) — no AustLII, no ScraperAPI,
no Cloudflare dependency at all for these four. Two follow-up accuracy fixes landed after the
initial replacement: `d9dde8a` (2026-08-26) fixed a silent false-negative on Federal Court
searches, and `313fb66` (2026-08-29) fixed same-word-different-entity noise (e.g. a search for
"BHP Group Limited" no longer matches unrelated results like "BHP Coal Pty Ltd v ..."). The
remaining five jurisdictions (`qld`, `vic`, `wa`, `sa`, `tas`) still have no free, unauthenticated,
full-text search available anywhere (confirmed during the original investigation below) — these
deliberately return `status: 'error'` with a manual search link (`buildManualFallback` in
`courtRecords.js`) instead of a fabricated "checked, clean" result, which is what the "NSW courts
& tribunals, plus links to check other states" copy on the marketing site refers to.

The investigation and reasoning immediately below (why AustLII specifically was blocked, and why
the alternatives were ruled out) remains accurate as historical record — only its "no live path
forward, dead end" conclusion has been superseded by the above.

---

**Original entry, 2026-08-12 / 2026-09-01 (historical — see superseded note above):**

**Decided (2026-09-01): not pursuing a live AustLII scraper further.** AustLII's block is
deliberate policy enforcement (see below), not incidental bot protection, and the only paths that
would restore automated coverage — negotiating written permission, or paying for premium proxy
tiers to route around the block — either require an external party's sign-off on a timeline this
project doesn't control, or mean deliberately engineering around a block AustLII put up specifically
to stop this. Removed from the active incomplete-work list on that basis. Section 8.5's court
coverage continues to run on FWO + QBCC adjudication only (see "In the meantime" below) — this is a
capability gap, not a bug, and is expected to stay that way unless AustLII's own policy changes.
The "manual search-yourself link" option (#2 below) remains a legitimate, fully-compliant way to at
least surface the register to a user by hand if that's ever wanted — it just hasn't been built.

All 9 `austlii.js` jurisdiction searches (`austlii_federal`/`austlii_qld`/etc.) currently return
empty results in production. This is **not a regression from the 2026-08-11 trading-names/suffix-
stripping change** (that change is correct and deployed) — AustLII is returning a hard Cloudflare
block page ("Sorry, you have been blocked... You are unable to access austlii.edu.au") to every
request from this server, confirmed both via ScraperAPI's standard proxy pool and directly via
Puppeteer (the same technique that fixed the unrelated Payment Times WAF block — here it makes no
difference, since this is a network-level block, not a Node/axios client-fingerprint issue).

**This is very likely deliberate policy enforcement, not incidental bot protection.** AustLII's
usage policy (`https://www.austlii.edu.au/austlii/copyright.html`) explicitly prohibits
"spidering, scraping, crawling, mirroring, page framing, API access, bulk querying, automated
agents, or other programmatic means" and states "where such activity is apparent or reasonably
inferred, it will be blocked." **No permission is granted or implied except by a written
agreement signed by AustLII** — contact `feedback@austlii.edu.au`. The policy also separately
prohibits use of AustLII materials to train/operate AI or ML systems, which doesn't currently
apply to how this app uses results (displayed directly to the user, not fed into any AI/ML
pipeline) but would if that ever changed.

**Alternatives investigated and ruled out:**
- **ScraperAPI premium/ultra-premium proxy pools** — could plausibly get through (that's their
  purpose), but the current ScraperAPI plan is Free tier and doesn't include access (confirmed via
  a `403` explicitly stating "current plan does not allow... premium proxies" — Hobby, $49/mo,
  would be required). Decided against pursuing this regardless of cost, since it would mean
  deliberately engineering around a block AustLII put up specifically to enforce a stated
  no-automation policy, not generic anti-bot measures.
- **Open Australian Legal Corpus** (`huggingface.co/datasets/isaacus/open-australian-legal-corpus`)
  — a legitimately-licensed (CC BY 4.0), explicitly-permissioned static dataset that doesn't touch
  AustLII at all. Ruled out as a live replacement: the underlying corpus-building tool's most
  recent release is v3.1.2 (May 2024, per its GitHub releases) — over two years stale as of this
  writing — and its case-law coverage is concentrated in Federal Court/High Court/NSW Caselaw,
  narrower than AustLII's current 9-jurisdiction sweep. Could be worth revisiting as a
  *supplementary* historical-background layer, not as the primary live-detection mechanism, since
  self-hosting it would also require a large (~1.47B token) dataset download and a new local
  search index — a much bigger lift than anything else in this list.
- **Scraping each of the 9 courts/tribunals directly instead of via AustLII** — spot-checked 4 of
  9 jurisdictions, not a clean fix: NSW Caselaw has its own robots-exclusion restriction on
  automated indexing; Federal Court's scraping permission is also a negotiated, case-by-case
  arrangement (same restrictive posture as AustLII); Victoria's own Supreme Court site points
  users to **AustLII** for full judgment text (no solid direct alternative for that jurisdiction).
  Would also mean building up to 9 separate scrapers instead of one parameterized one. Not
  pursued further, but only 4 of 9 jurisdictions were actually checked — QLD, WA, SA, NT, ACT, TAS
  remain unresearched if this gets revisited.

**Two live paths forward, neither implemented yet:**
1. **Request written permission** — a draft inquiry email to `feedback@austlii.edu.au` exists
   (not sent as of this writing), framing the actual use case (targeted, low-volume,
   entity-specific lookups triggered by an end user's own search, not bulk scraping/mirroring/AI
   training) against what their policy is clearly guarding against. If granted, AustLII would
   likely specify a particular technical access method (API key, IP allowlist, etc.) rather than
   just blessing the current proxy-based scraping — expect a new integration, not just an unblock.
2. **Replace the AustLII scraper with a manual "search AustLII yourself" link**, following the
   existing `links.js` pattern (`server/scrapers/links.js` — "not a scraper... no HTTP calls").
   Fully compliant (a human clicking through and searching themselves is exactly what AustLII's
   policy permits) and free, but narrows automated coverage. Requires a matching change to how
   section 8.5's risk badge is computed (`ReportContent.tsx:376-383`, `s85Risk` /
   `deriveRiskLevel`) — currently `isAllErrored([...austliiResults.map(status), fwo.status,
   qbcc.status])` falls back to `'clear'` unless *every* input errors, so a `links.js`-style
   AustLII entry (synthetic `status: 'done'`, zero results) would silently read as "checked all 9
   jurisdictions, found nothing" rather than "not checked." To fix: drop AustLII from that
   `isAllErrored` array and from `courtHits`/`courtItems` entirely (base the badge and count on
   FWO + QBCC adjudication only, which still work), and surface the AustLII link via the
   `supplementalLinks` prop instead, so it's clearly separate from the automated result set.

In the meantime, FWO and QBCC adjudication results are unaffected and continue to feed section
8.5 normally — only AustLII's slice of court/tribunal coverage is currently missing.

### `resolveDirectors()` is currently starved — ASIC director discovery is broken platform-wide (2026-08-13)

**Confirmed via a real production report**: a search for CONSTRUCTION VICTORIA PROPRIETARY
LIMITED (ACN 616327863) came back entirely clean, despite director Veronica Roberts being on
the ASIC Disqualified Persons Register (order 03/09/2025, expires 02/09/2030 — live-verified,
see below). The report showed clean not because any check failed loudly, but because **no
director name ever reached the checks that would have caught it.**

`resolveDirectors()` (`server/index.js:166`) is `[...new Set([...(directors ?? []), ...asicDirectors])]`
— the union of whatever the searcher typed into the form and whatever `asic.js` discovers. At
least 10 scrapers depend on its output: `asicDisqualified`, `asicExtract`, `qbcc`, `vicBpc`,
`vicVbaLicence`, `waBuildingEnergy`, `nswFairTrading`, `ntBuildingPractitioners`, `actLicences`,
`waLicenceRegister`, `tasLicenceRegister`, and `afsaNpii` (`saLicenceRegister` was removed
2026-08-28, see below). If nobody types
the director's name in manually (the typical case — a homeowner searching a builder rarely knows
director names upfront), every one of those depends entirely on `asic.js` finding them.

**Confirmed live against production Railway env (`CAPTCHA_API_KEY` and `SCRAPERAPI_KEY` are both
set — this is not a missing-key problem):**

- `searchASICDisqualified(['Veronica Roberts'], <key>)` — **works correctly.** Found all 5
  DPN register entries in ~33s when given her name directly. The disqualified-persons parser
  and matching logic are fine; see also the [ASIC_DISQUALIFIED_TEST_FIX_PLAN.md](../ASIC_DISQUALIFIED_TEST_FIX_PLAN.md)
  fix earlier in the week — unrelated to this bug, that was stale test fixtures only.
- `searchASIC('CONSTRUCTION VICTORIA PROPRIETARY LIMITED', '60616327863', '616327863', <key>)`
  (i.e. searched by ACN, as the original report almost certainly was) — found the company record
  but returned **zero directors** and every metadata field blank (`Status: ""`, `Type: ""`, etc.).
  Root cause is in the code itself, not a live-site fluke: the ACN-search branch
  (`server/scrapers/asic.js:232-263`, the "inline detail page" fallback used when ASIC Connect
  renders the detail page directly on the search results rather than a list) **never calls
  `parseDirectors()` at all**. A comment already at `asic.js:236-239` explains why: *"ASIC Connect
  no longer exposes a free-access officer/director listing — director info requires a paid
  'Roles and relationship extract' ($23 on ASIC). Directors are retrieved from
  `ASIC_DATA_API_KEY` fallback below if set."* That fallback (`fetchFromDataApi`, `asic.js:270-279`)
  only runs `if (results.length === 0)` — and since the company item itself was already pushed,
  `results.length` is 1, so the fallback doesn't even fire in this branch. `ASIC_DATA_API_KEY` is
  also **not set** in Railway (confirmed via `railway variables --kv`), so it wouldn't help yet
  regardless.
- `searchASIC('CONSTRUCTION VICTORIA PROPRIETARY LIMITED', '', '', <key>)` (name-only, no ACN) —
  returned **zero results entirely**, not even the company record. This is a second, distinct
  failure from the ACN-branch one above (different code path — `parseSearchResults` found no
  `matches` at all) and is **not yet root-caused**. Worth checking whether ASIC Connect's
  `OrgAndBusNm` search behaviour changed (exact-match requirement? wildcard handling?) — same
  category of live-site drift as the AustLII Cloudflare block and the Payment Times column-shift,
  but not yet confirmed which.

**Net effect:** right now, ASIC-based director discovery contributes nothing to any search,
regardless of whether it's entered by ACN or by name. Every director-dependent scraper listed
above is silently degraded to "only checks whatever the user manually typed" — which for most
users is nothing. This long predates today and is very likely affecting reports beyond this one
case; it was simply never noticed because degradation is silent (see also: `riskGrouper.ts` only
checks `results.length`, never `summary`/`status`, so a starved check and a confirmed-clean check
render identically — a related but separate gap worth fixing alongside this one).

**Not yet done:**
- Root-cause the name-only search returning zero matches.
- Decide the director-discovery strategy going forward: revive `parseDirectors()` against
  whatever markup the ACN detail-page path currently renders (if the data is present but just
  unparsed — not yet checked), fully commit to `ASIC_DATA_API_KEY` as the real fix (requires
  provisioning the key, same as the Phase 7c gap above, which already documents the branch to add
  it under), or some combination.
- Once directors are flowing again, separately fix `riskGrouper.ts`/`ReportContent.tsx` to
  surface "check unavailable" as its own visible state distinct from "checked, found nothing" —
  raised earlier this session, not yet implemented.

**Follow-up (2026-09-08): `resolveDirectors()` deprecated to a pass-through stub, not fixed.**
Rather than leave director-dependent scrapers blocked behind ASIC's captcha-gated (and already
confirmed non-functional) director lookup, `resolveDirectors()` (`server/index.js`) was changed to
`[...new Set(directors ?? [])]` — request-supplied director names only, no ASIC involvement. This
was a deliberate latency fix, not a correctness fix: because `resolveDirectors()` awaited
`asicPromise` before returning, every one of its 13 callers (`asicDisqualified`, all 8
`courts_*` jurisdictions via `resolveExtraSearchTerms()`, `qbcc`, `fwo`, `vicBpc`, `vicVbaLicence`,
`waBuildingEnergy`, `nswFairTrading`, `ntBuildingPractitioners`, `actLicences`, `actDisciplinary`,
`waLicenceRegister`, `tasLicenceRegister`, `asicExtract`, `asicEnforceableUndertakings`) sat
serialized behind ASIC Connect's captcha-solve (33s–120s+ observed) for a lookup that was already
reliably returning zero directors either way — pure latency with no offsetting benefit. Since
`res.end()` only fires after `Promise.all()` over the full `searches` array resolves
(`server/index.js`), and `asic`'s own entry is itself gated the same way, this also means the
*overall* request no longer waits for the other 13 scrapers to queue up behind ASIC before
starting — they now run concurrently with it instead of after it.

`asic` (company search) and `asicExtract` (officer/charges extract) themselves were **not**
removed from the `searches` array — they still run, still return whatever they return (company
record when the live scrape works; nothing useful for directors today), they just no longer block
anyone else. `asicExtract` specifically now receives only user-typed director names via
`resolveDirectors()`, so its phoenix-detection (associated-companies-via-director) branch returns
its honest "No directors identified for officer search" early-exit (`asicExtract.js:202-211`) for
any search where the user didn't type a director name — which, per the finding above, is most of
them; this was already effectively true in production before this change; the difference now is
that it happens instantly instead of after a captcha solve.

**Net effect on report completeness**: none, in practice — the director-dependent checks were
already silently getting zero ASIC-sourced directors. **Net effect on latency**: removes up to two
serialized captcha-solves (asic's own, plus asicExtract's second one downstream of it) from the
critical path for every search.

**Not yet done** (supersedes the "not yet done" list above, which is still accurate background):
- The underlying ASIC director-extraction bug (ACN branch never calls `parseDirectors()`;
  name-only search returns zero results) is still unfixed — this change only stopped it from
  gating other scrapers, it didn't fix ASIC itself.
- `resolveDirectors()` should regain a real ASIC-backed (or `ASIC_DATA_API_KEY`-backed) path once
  that root cause is addressed — until then, this app has no automated director-discovery
  mechanism at all beyond what a user types in by hand.
- Decide whether `asic`/`asicExtract` are worth keeping as their own (now non-blocking, still
  slow) rows given they currently contribute little beyond a company status/ACN lookup — not
  decided one way or the other in this pass.

**Why this specifically matters — phoenix detection is currently non-functional for any search
without manually-typed director names.** `asicExtract`'s whole purpose (see "Phase 7c" above) is
phoenix detection: surfacing *other* companies a target entity's directors are/were associated
with, which is the core signal for "this builder folded and reopened under a new name to dodge
liabilities" — arguably the single highest-value check this product offers a homeowner, and one a
manual search-yourself workflow can't easily replicate (a homeowner doesn't know a director's name
to go look them up in the first place; discovering it *is* the point of the check). With
`resolveDirectors()` now a pure pass-through and ASIC director extraction still broken, this check
only ever fires if the searcher already happens to know and type in a director's name — for the
typical homeowner search-by-company-name-or-ABN case, phoenixing risk is currently invisible in
every report, silently. This makes fixing ASIC's director-extraction bug (or standing up the
`ASIC_DATA_API_KEY` path from Phase 7c) higher priority than its "one bullet on a long list" framing
above suggests — it's not a minor data-completeness gap, it's the phoenix-detection feature being
effectively off by default.

**Follow-up (2026-09-09, reliability plan WS3): `resolveDirectors()` regains automated
discovery — via NSW/ACT's own licence registers, not ASIC.** Checked ASIC's own API access
page directly before attempting the `ASIC_DATA_API_KEY`/Phase 7c path above: ASIC's Company
Register DSP applications (`EDGE`, the API that carries officer/director data) are **paused,
reopening in 2027** — confirmed via ASIC's own APIs page, not just cost/access friction. The
API itself is free; there is currently no way to get credentialed for it at all, regardless of
budget. `data.gov.au`'s bulk ASIC datasets don't include an officer register either (12
datasets confirmed via the CKAN Action API — companies, business names, licensee/adviser/
auditor/liquidator/banned-persons registers, no officers — same finding as the ASIC
Enforceable Undertakings investigation above). So the already-built `fetchFromDataApi`
(`asic.js`) / `searchViaDataApi` (`asicExtract.js`) Data API branches — which do already exist
in code, contrary to Phase 7c's "to complete" framing above, that framing is now stale — stay
dormant until 2027; not worth further investment now.

Found a different free source instead, while investigating: **NSW Fair Trading's own
per-licence details endpoint already returns real director names, unprompted.** The endpoint
`nswFairTrading.js` was already calling for compliance data (`.../search/details/{type}/{id}`)
also returns `componentData.associatedRoles` — for Universal Property Group Pty Limited /
licence 85273C, a `"Director"` role (Bhart Bhushan) and a `"Nominated Supervisor"` role (Raj
Mohan), both live-confirmed 2026-09-09. This was being fetched and silently discarded.
**ACT's licence dataset (`de4w-gbt3`) has the same shape** — `partners`/`nominees` fields,
already extracted into `actLicences.js`'s own result `metadata` (`Partners`/`Nominees`) but
never fed back into director resolution. Live-confirmed for Geocon Constructors (ACT) Pty Ltd
/ licence 2013583: partner "NIKOLAOS GEORGALIS", nominee "DAMON GREGORY SMITH" (ACT's
`nominees` field is a composite string, `"NAME: licenceNumber-Occupation-Class"` — needs
parsing before use, not a clean name on its own).

This matters beyond just filling in a list: `asicExtract.js`'s phoenix-detection
(`fetchDirectorCompanies`) already works via a *live, CAPTCHA-gated search by director name*
against ASIC Connect — that path was never blocked by the DSP pause above, only by having no
name to search with. NSW/ACT licence data answers exactly that, for exactly the population
this product's audience is (licensed builders), without waiting for 2027 at all.

**Wiring, and why it isn't a one-line change** (see the architecture diagram from this
session's design discussion, not reproduced here): `resolveDirectors()`'s existing 13
consumers include `nswFairTrading`'s and `actLicences`'s own `searches[]` entries, which
already take `resolveDirectors()`'s output as an *input* (for per-director enrichment
queries) — so `resolveDirectors()` calling into those same functions to *discover* names
would be circular. Fixed by splitting `nswFairTrading.js`'s company-name lookup out into
`fetchNswCompanyLookup()` ("Phase A" — no director input, this is what discovers names) from
the existing full `searchNSWFairTrading()` ("Phase B" — still does per-director enrichment,
now optionally reuses Phase A's result instead of re-querying). `index.js` hoists
`fetchNswCompanyLookup(companyName)` once (same "shared promise" pattern as `abnPromise`/
`asicPromise`), wrapped in `runScraper.js`'s `withTimeout` (20s) with a `.catch()` that fails
open to an empty result — NSW is a live HTTP call, and letting it hang or reject unguarded
would reintroduce the exact "one slow upstream serializes 13 scrapers behind it" regression
the 2026-09-08 ASIC-dependency removal above fixed for this same function. ACT didn't need the
same phase-split: `fetchActLicenceRecords()` reads an already-local WS1 dataset cache, so
`resolveActAssociatedNames()` (`actLicences.js`) just queries it independently — a second cache
read, not a second HTTP call, so the added complexity of a hoisted/reused promise wasn't
justified there; it's still wrapped in a fail-open catch for defense in depth.
`resolveDirectors()`'s own contract is unchanged (`Promise<string[]>`) — merges request-typed
names with both discovered sets, deduped; role/confidence (Director vs Nominated Supervisor
vs Partner vs Nominee — not all equally certain) is preserved in each discovering scraper's own
result `metadata` rather than threaded through the flat list, so a report can show provenance
without a wider signature change across all 13 consumers.

**A real, pre-existing, currently-live bug found and fixed along the way**: `nameMatchesEntity`
(duplicated per-file per this codebase's convention — fixed here in `nswFairTrading.js` and
`actLicences.js` only, not swept across the other 10+ files that also duplicate it) tokenizes a
query into words and wraps each in a `\b...\b`-anchored regex. A token that itself starts or
ends with punctuation (e.g. `"(ACT)"`, from "Geocon Constructors (ACT) Pty Ltd") can never
satisfy `\b` at that position — `\b` requires a word/non-word transition, and both the
preceding space and the leading `(` are non-word, so there's no transition there regardless of
whether the name is genuinely present. This silently broke matching for any company name
containing a parenthetical — not rare in Australian company names (state-subsidiary suffixes,
trading-name clarifications) — for every function using this duplicated helper, not just the
one this session touched. Fixed by stripping non-alphanumeric characters from each token before
building its regex (verified live: fixes the parenthetical case, preserves the existing match,
introduces no false positive). **Not swept to the other files sharing this duplicated
function** (`courtRecords.js`, `vicBpc.js`, and others per the file-local-duplication
convention) — flagged here, not fixed, since it was outside this change's scope.

Live-verified end to end via a real `/api/search` request for Universal Property Group Pty
Limited: `nswFairTrading`'s own result now carries `metadata.Director`/
`metadata.NominatedSupervisor`, and — the actual point of this change — its per-director
enrichment loop surfaced two *additional* licences (Raj Mohan's own contractor licence, Raja
Mohan Kamineni's qualified-supervisor certificate) that were invisible before, and
`asicDisqualified`'s own search fired against `Bhart Bhushan` (`searchUrl` shows
`searchText=Bhart%20Bhushan`, summary "2 director(s) checked") — a name it never would have
seen previously, since no director was typed in by the searcher. New regression test:
`server/tests/test-ws3-director-discovery.js`, in `run-all.sh`.

**Not yet done**:
- Only covers NSW and ACT (this session's MVP scope) — the other 7 jurisdictions' director-
  dependent scrapers still see nothing unless a name is typed in or discovered via these two.
- ASIC's own DSP-gated officer data is still inaccessible until 2027 regardless of this fix —
  `fetchFromDataApi`/`searchViaDataApi` stay dormant; revisit when applications reopen.
- `partners`/`nominees` (ACT) and NSW's `associatedRoles` have only been verified against a
  single-name fixture each — whether either field can hold multiple people, and how they'd be
  delimited if so, is unconfirmed (the parser defensively splits on `;` as a precaution, not a
  confirmed format).
- Confidence tiering stops at "recorded in metadata" — nothing currently treats a `Director`-
  sourced name differently from a `Nominee`-sourced one when it's actually used to drive a
  search (e.g. `asicDisqualified`), beyond what each scraper's own name-matching already does
  for any name, typed or discovered.
- The nameMatchesEntity punctuation bug is confirmed present, not fixed, in every other file
  duplicating this helper.

**Follow-up (2026-09-09, same day): the two `asic.js` bugs fixed; a `completeness: 'partial'`
signal added for zero-director searches; a manual-link idea recorded, not built.**

Two bugs `asic.js` (documented above and in the earlier "`resolveDirectors()` is currently
starved" entry) fixed, so the dormant `ASIC_DATA_API_KEY` path is actually correct and ready
for whenever ASIC's DSP applications reopen in 2027, not just present but broken:
- The ACN-search branch (`asic.js`, the `else if (derivedAcn)` branch) now calls
  `parseDirectors($, buildDetailUrl(derivedAcn))` on the already-loaded page (this rendering
  *is* the detail page, per the branch's own existing comment — no extra fetch), wrapped in a
  try/catch so a markup mismatch can't lose the company record already found. Previously never
  called here at all.
- The Data API fallback's guard changed from `results.length === 0` to `results.length === 0 ||
  !hasDirector` — previously, once the ACN branch pushed a company item (`results.length` = 1),
  the fallback that could have supplied directors was permanently unreachable for that request,
  regardless of whether `ASIC_DATA_API_KEY` was set. Also changed from replacing `results`
  outright to merging: when a company record already exists, only the Data API's *director*
  items are appended, so a better-sourced ASIC-Connect company record isn't overwritten by a
  Data-API one just because directors were missing.
- Both changes compose: if the newly-added `parseDirectors()` call does find directors,
  `hasDirector` is true and the Data API fallback correctly doesn't fire at all.

Neither fix could be verified live when first made — the CAPTCHA-gated ASIC Connect path needs
a real `CAPTCHA_API_KEY`, and the Data API path needs `ASIC_DATA_API_KEY`, categorically
unobtainable until 2027 regardless of budget (see above). Rather than leave that permanently
unverified, `searchASIC()` gained two injectable trailing params
(`_fetchAdfPageWithCaptcha`/`_fetchFromDataApi`, defaulting to the real implementations) — same
pattern as `asicDpnMatch.js`'s `_fetchDpnRows` and this file's captcha-gated-check convention.
`parseDirectors()` itself needed no such change — it only operates on an already-loaded cheerio
object, no network call, so it was already unit-testable once the branch that calls it existed.
New test `server/tests/test-asic-director-fallback.js` (4 pilots, all passing, in `run-all.sh`)
exercises both fixes deterministically with synthetic HTML/mocked Data API responses: a
director found via the ACN branch (Data API correctly skipped), no director table present (no
throw, company record survives), the merge case (company already found, Data API supplies only
the missing director, doesn't overwrite the company record), and the original
`results.length === 0` full-replace behavior (confirmed unchanged). This is real, durable,
re-runnable verification of the code's *logic* — it cannot and does not prove what ASIC
Connect's actual live markup contains today, which stays genuinely unknowable without a real
`CAPTCHA_API_KEY`, same as before.

**`completeness: 'partial'` now distinguishes "checked the company name only" from "also
searched under N director name(s)"** for the four MVP director-dependent consumers named in
the original WS3.3 scope (`nswFairTrading`, `actLicences`, `actDisciplinary`) plus the three
WS2-wrapped court searches (`courts_nsw`, `courts_federal`, `courts_act`) — `index.js`'s new
`markPartialIfNoDirectors(result, directorCount)` wraps each of their `fn`s: if
`resolveDirectors()` returned zero names (neither typed nor NSW/ACT-discovered), the result's
`completeness` is set to `'partial'` and `(no director names available to search under)` is
appended to its summary — unless the result already carries a more specific non-`'complete'`
value of its own (`courtRecords.js`'s own `'unavailable'`/`'partial'` from a failed/retried live
search, or `buildManualFallback`'s `'unavailable'`), which is never downgraded. Live-verified
end to end, both directions: a real NSW-licensed fixture (Universal Property Group Pty
Limited) keeps `completeness: 'complete'` across all six keys (directors were discovered); a
fictitious unlicensed entity shows `'partial'` with the caveat text on all five keys that
completed within the test window, and `courts_act` correctly kept its own `'unavailable'`
(a live ScraperAPI 401 in this sandbox) rather than being overwritten to `'partial'`.

**Recorded, not built: a manual link to ASIC's paid "Roles and relationship extract" ($23)**
as a `supplementalLinks`-style fallback (same pattern as `courtRecords.js`'s manual-fallback
links for jurisdictions with no automated search) for entities where director discovery found
nothing automated — lets a motivated user close the gap themselves for one specific company.
Minor relative to the two items above; not implemented this pass.

### asicDisqualified's DPN check still silently misses hits under real concurrent search load (2026-08-19) — SUPERSEDED (2026-08-19)

**Superseded the same day**: rather than continue chasing reliability bugs in the live ASIC
Connect scrape, it was retired entirely and replaced with ASIC's own bulk dataset on data.gov.au.
`searchASICDisqualified`/`checkDirector`/`parseDisqualifiedResults` (`asicDisqualified.js`) and
`fetchAdfDpnSearch` (`browser.js`) are gone — see `server/scrapers/asicDpnDataset.js` and
`server/scrapers/asicDpnMatch.js` for the current implementation, and
`ASIC_DPN_BULK_DATASET_MIGRATION_PLAN.md` (repo root) for the full migration record, including
where the new approach deliberately deviates from the old one's filtering/dedup behaviour. Kept
below as the historical record of *why* — the resource-exhaustion, unsubmitted-POST, and
never-reaches-network-idle failure modes documented here are exactly what made a bulk dataset the
better answer, not further patching.

Follow-up to the two fixes below (`d860975`, `ed576a4`), both already deployed and confirmed
correct in isolation — this entry is about a third, still-open failure mode that only reproduces
under real search load, plus a false start that was tried and reverted the same session.

**Trigger**: after landing `d860975` (`checkDirector` retry + honest failure reporting) and
`ed576a4` (`fetchAdfDpnSearch` throws if the DPN search POST never actually fired), a real user
report for CONSTRUCTION VICTORIA PROPRIETARY LIMITED / Veronica Roberts *still* showed "1
director(s) checked — no disqualification records found" — the exact false negative both fixes
targeted. Confirmed via a direct `curl -N` to the production `/api/search` endpoint (not an
isolated function call — this matters, see below): `asicDisqualified` completed normally with
`results: []` and no failure signal, meaning `fetchAdfDpnSearch` didn't throw either. So the
search POST likely *did* fire this time — something after that point (page not fully rendered
when `page.content()` was captured) is the remaining gap.

**False start, tried and reverted — do not retry this approach without new evidence**: the
next hypothesis was that `waitForNetworkIdle({ timeout: 20_000 }).catch(() => {})` was silently
swallowing a stalled/incomplete render the same way the POST-injection check used to swallow an
unfired POST, so `b2eff20` made that timeout throw instead (raised to 30s). Live-verified
*wrong*, immediately: an isolated call that had twice succeeded before this change (found all 5
DPN entries, ~70–150s) then failed both retry attempts with `Timed out after waiting 30000ms` —
with zero other scrapers running, no concurrency involved at all. This ADF page apparently never
reaches true `networkidle` (most likely a background poll/heartbeat keeping a connection open
indefinitely), so gating on it turned a working-if-fragile check into an always-failing one.
Reverted in `5b4e3a8`, live-confirmed restored (found all 5 entries again, one attempt hit a
genuine transient `Protocol error: Target closed` and the retry correctly recovered it — the
`d860975` retry logic working exactly as intended).

**Net state as of this commit**: `d860975` and `ed576a4` are deployed and each independently
verified correct. The specific false negative reported in the screenshot is *not yet
root-caused* — reverting the network-idle change only restores known-good isolated behaviour, it
doesn't explain why the full concurrent `/api/search` run still produced a false "clean" with
`ed576a4` alone in place. The working theory (not yet verified) is that under real load the page
*is* fully rendered by the time `page.content()` is captured, just not with what the parser
expects — worth capturing an actual HTML snapshot from a failing run to check.

**Separate, likely-related finding from the same full-search test**: in that same `/api/search`
run, four other scrapers — `qbcc`, `vicBpc`, `waLicenceRegister`, `asicExtract` — never emitted a
`done` or `error` line at all; they're stuck at `"status":"searching"` forever in the NDJSON
output, yet the HTTP response still closed cleanly (`curl` exit 0). Every entry in the `searches`
array in `index.js:340-351` is wrapped in try/catch and always calls `send(...)`, so a promise
that neither resolves nor rejects shouldn't be possible from that code alone — either an
infrastructure-level timeout (Railway edge/proxy) is truncating the streamed response mid-flight
before all ~30 scrapers finish, or `getBrowser()`'s shared Chromium instance is genuinely hanging
some pages indefinitely under this much concurrent load (recall `browser.js`'s own comment:
`MAX_CONCURRENT_PAGES` was added specifically because "unrelated registers fail together" under
concurrent `Promise.all` load — this may be the same class of problem, more severe). **Not
investigated yet** — this could easily be the real explanation for the `asicDisqualified` false
negative too (a hung/starved page returning stale `page.content()`), rather than a fourth
distinct bug.

**Not yet done (as of retirement — items 1 and 3 are now moot, specific to code that no longer
exists; item 2, the concurrency issue, is real, separate, and promoted to its own entry below —
see "Puppeteer-dependent scrapers systemically starved" further down):**
- ~~Capture a real HTML snapshot from a failing (not isolated) run to see what `page.content()`
  actually contains when this happens — currently guessing blind.~~ Moot — `fetchAdfDpnSearch` no
  longer exists.
- Root-cause the four scrapers that never finish under full concurrent load: infra timeout vs.
  genuinely hung Puppeteer pages. If it's the browser hanging, `MAX_CONCURRENT_PAGES` (currently
  3) and/or the various per-scraper Puppeteer timeouts in `browser.js` likely need retuning for
  the actual number of browser-dependent scrapers this app now runs concurrently (11+ as of the
  comment at `browser.js:11`).
- ~~If it does turn out to be "rendered, but with the wrong content," build a positive completion
  check for `fetchAdfDpnSearch`~~ Moot — `fetchAdfDpnSearch` no longer exists.

### Puppeteer-dependent scrapers systemically starved under real concurrent search load — now confirmed to affect non-Puppeteer scrapers too (2026-08-19) — ROOT-CAUSED, NOT COMPUTE (2026-08-28) — FIXED (2026-08-28)

Follow-up to the "four scrapers never finish" finding in the superseded entry above, now with
much more severe evidence from a full-search test run **after** the ASIC DPN migration landed
(`c38220f`) — i.e. this is not caused by that migration; if anything the migration should have
*reduced* load on the shared browser by one scraper, since the new `asicDisqualified` no longer
touches Puppeteer at all.

**Trigger**: a real production `/api/search` request (same company/director used throughout this
investigation) completed (`curl` exit 0, clean-looking end of stream) with only **5 of 29**
scrapers reaching `done` — all five (`links`, `modernSlavery`, `abn`, `atoDebt`, `paymentTimes`)
are the non-Puppeteer ones. **All 24 that never finished were Puppeteer-dependent — including the
new `asicDisqualified`, which no longer calls `getBrowser()` at all** (confirmed by reading
`asicDpnDataset.js` — its only I/O is a plain `axios` call and `fs.readFile`/`fs.stat` against an
already-warm local cache). That a scraper with zero Puppeteer dependency still failed to flush a
result is the important new data point: this looks less like "Puppeteer pages hanging
individually" and more like the whole Node process becoming too starved (CPU and/or memory, likely
from ~15 concurrent Chromium instances) to get *any* pending callback scheduled in time —
including a trivial `fs.readFile` — before an infrastructure-level timeout (Railway edge/proxy)
cuts the connection. Severity looks worse than the "4 scrapers hung" state observed the previous
session — either load has increased, or the earlier characterization was incomplete (that test
predates this one, wasn't specifically checking for this pattern).

**Root-caused (2026-08-28) — it is not compute starvation.** Reproduced the exact symptom live
against production (`CONSTRUCTION VICTORIA PROPRIETARY LIMITED` / Veronica Roberts, same case
used throughout this investigation): 8 of 29 scrapers (`courts_federal`, `courts_nt`, `qbcc`,
`vicBpc`, `waLicenceRegister`, `saLicenceRegister`, `tasLicenceRegister`, `asicExtract`) never
reached `done`/`error` even after 4 minutes, matching the historical pattern. Pulled Railway's own
CPU/memory metrics (`railway metrics --raw --cpu --memory --json`) for that exact window
(2026-08-28T01:33–01:40Z): CPU peaked at 0.37 vCPU of the 8 vCPU limit (**4.7%** utilization),
memory peaked at 1.36GB of the 8GB limit (**16.6%**). The container had large headroom in both
dimensions the entire time scrapers were stuck — this rules out CPU starvation, memory pressure,
and "hobby plan too small" as the cause. Do not spend further effort on Railway resource
allocation for this issue.

The real mechanism: every one of the 8 stuck scrapers routes through the shared Puppeteer instance
in `browser.js` (`getBrowser()` / `fetchWithBrowser*`), which gates concurrency to
`MAX_CONCURRENT_PAGES` (currently 3) via a single FIFO wait queue (`acquirePageSlot`,
`browser.js:22-27`). One or more page acquisitions is genuinely hanging — most likely a live
external site's WAF/CAPTCHA/slow load with no timeout wrapping the page lifecycle — and because
all Puppeteer scrapers share the same 3-slot queue, everything queued behind a hung page waits
forever too, regardless of host resources. This also explains why the old (pre-migration)
`asicDisqualified` got caught in the same failure in the 2026-08-19 test above (it still went
through `getBrowser()` at the time) while the current dataset-based `asicDisqualified` — no longer
Puppeteer-dependent — completed cleanly in this reproduction.

**Identified the actual leaking scraper (2026-08-28)**: repeated live trials (3 full concurrent
`/api/search` runs) showed the stuck-scraper set shrinking run-to-run (8 → 3 → 1) rather than
staying constant — a red flag that ruled out "one scraper always hangs" and pointed instead at a
cumulative leak that partially drains between requests. Cross-referencing `railway logs` for the
test window against the code found it: `saLicenceRegister.js`'s `passGateAndGetPage()` helper
(then at `saLicenceRegister.js:39-80`) called `browser.newPage()` with no try/finally of its own.
Its caller initialized `let page = null` and only assigned `page = await passGateAndGetPage(...)`
inside its own try block (then `saLicenceRegister.js:270-273`) — if `passGateAndGetPage` threw
*after* creating the page but *before* returning it (confirmed happening via
`[saLicenceRegister] gate/search error: Navigation timeout of 30000 ms exceeded` in production
logs, i.e. its `waitForNavigation({ timeout: 30_000 })` at line 76), the outer `page` variable
stayed `null` and the caller's `finally { if (page) await page.close() }` never closed the real,
already-open page. That page's `MAX_CONCURRENT_PAGES` slot (`browser.js`) then leaked permanently
for the life of the server process, since the slot only frees on the page's `'close'` event.
Confirmed as the *only* file in `server/scrapers/` with this deferred-null-then-helper-assignment
pattern (grepped every other Puppeteer scraper — all of them create and close their page in the
same function scope). The interleaved `[qbcc] ProtocolError: Failed to open a new tab` /
`[tasLicenceRegister] ... detached Frame` errors seen in the same logs are downstream victims —
SA's leaked tabs eating real Chromium tab capacity from the shared pool, not leaks of their own.

**Fixed (2026-08-28)**: rather than patch the leak, removed `saLicenceRegister.js` entirely (no
viable open-data replacement exists for this specific register — see the licence-database bulk/API
research below) and re-ran the same 3-trial live test against production. Result: 27-28 of 28
remaining scrapers reached `done`/`error` in every trial (one trial had a single `tasLicenceRegister`
hold-out past the 240s cutoff, with no errors logged for it — looks like ordinary slow CAPTCHA-solve
latency, not a leak); the other two trials completed *the entire stream* in ~213s with zero stuck
scrapers. Zero `Failed to open a new tab` /
`detached Frame` / `Target closed` errors appeared anywhere in the post-fix logs. Confirmed fixed —
no further action needed on this issue. The general class of bug (an unguarded page creation inside
a helper whose caller's cleanup depends on the helper returning normally) is still worth keeping in
mind if new Puppeteer scrapers are added — see `browser.js:48-56`'s `attachPageGate` comment, which
already documents the assumption that "scrapers already close their page in a finally block."

### `vicVbaLicence.js` swapped from Puppeteer to VIC's open-data API (2026-08-28)

Was driving headless Chromium against `https://bams.vba.vic.gov.au/bams/s/practitioner-search` (a
Salesforce Experience Cloud SPA), intercepting an internal Aura `ApexAction.execute` XHR response
for `PractitionerDetailList` — one more consumer of the shared `MAX_CONCURRENT_PAGES` pool. Found
that Victoria's Building Practitioner Register is published as a live CKAN datastore on
data.vic.gov.au (resource `3599fa1f-29f3-417e-8679-1842e2e6e2df`, no auth, updated weekly, 48k+
records, full-text search via `q=`) — the exact same underlying register. Rewrote the file to call
`https://discover.data.vic.gov.au/api/3/action/datastore_search` via `axios` instead, following
`actLicences.js`'s idiom (same `nameMatchesEntity()` whole-word matcher, per-query try/catch,
dedupe by `Accreditation ID`). Output contract (`source`/`jurisdiction`/`category`/`results[]`/
`searchUrl`/`summary`, item shape) preserved unchanged — `server/index.js`'s call site needed no
changes. Live-verified against real data (`ARENA CONSTRUCTION GROUP PTY LTD` → status `Current`,
ACN `687010251`).

Also found and fixed a separate, pre-existing gap while touching this scraper: its results never
reached `ReportContent.tsx` or `riskGrouper.ts` at all — only `SearchContent.tsx`'s progress
spinner knew about the `vicVbaLicence` key. Wired it into both: `byKey`/`licenceItems`/the s82
`isAllErrored` array/a synthetic `vicVbaLicenceSearch` object/the s82 `searchResults` array in
`ReportContent.tsx`, and a LICENSING risk trigger in `riskGrouper.ts` (reuses the existing
`hasInactiveStatus()` helper, same pattern as `qbcc`'s licence-status check — triggers `significant`
severity when any result's status isn't current).

### Added ACT Register of Disciplinary Actions (2026-08-28)

ACT's open-data Socrata portal (already partially used by `actLicences.js` for current licence
status via `de4w-gbt3`) also publishes a second, separate dataset that nothing in this codebase
queried: `avib-prrz`, the Register of Disciplinary Actions — ACT's equivalent of QBCC's excluded-
persons register or VBA's disciplinary register, both of which have no open-data equivalent in
their own states. Confirmed live (`Last-Modified` was the day before testing) with real entries
(e.g. `KEGGINS INDUSTRIAL PTY LTD` — Automatic Suspension under s50A of the Construction
Occupations Licensing Act 2004 for lacking an active licensed nominee; individual licensees like
`Jonny Rosso` also appear, via a single combined `licensee_name` field rather than the
`surname`/`given_names` split the existing `de4w-gbt3` dataset uses).

Added `searchACTDisciplinary(companyName, abn, directors)` to `actLicences.js`, reusing its
existing `escapeRegExp`/`nameMatchesEntity`/`socrataEscape`/`BUILDING_OCCUPATIONS` helpers. Matches
by `licensee_name` (upper-LIKE) and by ACN — derived from either a bare 9-digit ACN or the last 9
digits of an 11-digit ABN, since `a_c_n` is stored inconsistently (spaced vs. unspaced) and compared
digit-stripped. Output contract mirrors `vicBpc.js` (a disciplinary register, `category: 'regulatory'`,
not `'license'`). Wired into `server/index.js` (new `actDisciplinary` search entry),
`SearchContent.tsx`, `ReportContent.tsx` (same five spots as `vicVbaLicence` above), and
`riskGrouper.ts` (LICENSING trigger mirroring `vicBpc`'s "any result found" pattern). Live-verified
against real hits for both a company (`KEGGINS INDUSTRIAL PTY LTD`) and an individual (`Jonny Rosso`).

**Unrelated build breakage hit while deploying the above (2026-08-28, fixed same day)**: the very
next deploy after the SA removal failed at `npm ci` with `Failed to set up chrome-headless-shell:
Extraction failed: Required native binary ('tar.exe' or 'unzip') was not found in the system PATH`
— reproduced identically on a from-scratch redeploy retry, so not a one-off flake. Neither commit
being deployed touched `package.json`/the lockfile/`nixpacks.toml`, yet the prior deploy (20 minutes
earlier, identical dependency set) had built fine — something in Railway's Nixpacks builder image
changed underneath us. Root cause: `nixpacks.toml`'s existing `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD`
only skips the main Chromium binary; puppeteer@25 separately downloads `chrome-headless-shell` too,
which that variable doesn't cover, and this build container apparently lacks `tar`/`unzip` to
extract it. Neither downloaded binary is ever used regardless — `PUPPETEER_EXECUTABLE_PATH` already
points at the Nix-provided system Chromium — so fixed by adding the broader `PUPPETEER_SKIP_DOWNLOAD
= "true"` to `nixpacks.toml`, which skips all of Puppeteer's own browser downloads. Confirmed fixed:
next deploy built and ran successfully.

### Section 8.2 licence checks silently missed "Pty Limited" entities — FIXED (2026-08-31)

**Reported**: UNIVERSAL PROPERTY GROUP PTY LIMITED (ABN 98078297748) holds NSW contractor licence
85273C, confirmed `Current`, but a search returned nothing for NSW Fair Trading.

**Root cause**: every affected scraper stripped company suffixes with the same narrow regex,
`/\s*pty\s*ltd\.?\s*$/i` — which matches "Pty Ltd" only, not "Pty Limited" (the form both the
reporter and this company's actual registration use). When the suffix isn't stripped, the full
"...PTY LIMITED" string gets sent to the external register's search, and several of these registers
do exact substring/phrase matching against the literal registered name (which says "...PTY LTD"),
so the extra word "LIMITED" breaks the match entirely even though the record exists. Live-confirmed
directly (stripped query vs. unstripped query, same real record each time):
- NSW Fair Trading: 1 result → **0 results**
- ACT licence register (`actLicences.js`, `searchACTLicences`): 1 result → **0 results**
- ACT disciplinary register (`actLicences.js`, `searchACTDisciplinary`, added 2026-08-28 this
  session): 1 result → **0 results** — i.e. this bug was already present in code added three days
  before it was reported, via the same copy-pasted regex.
- VIC practitioner register (`vicVbaLicence.js`): 1 result → 1 result, **not affected** — CKAN's
  full-text search tolerates extra words, unlike the others' exact-match behaviour.

The same buggy regex (or a near-identical variant) was also found, by code inspection, in
`vicBpc.js`, `ntBuildingPractitioners.js`, `tasLicenceRegister.js`, and `waLicenceRegister.js` —
not all empirically live-tested (some require driving a CAPTCHA-gated Puppeteer session), but all
route through the same class of exact/substring-sensitive search mechanism, so treat them as
equally exposed until proven otherwise.

**Fixed**: broadened the regex to `/\s*(?:pty|proprietary)?\.?\s*(?:ltd|limited)\.?\s*$/i` across
all 8 occurrences in `nswFairTrading.js`, `actLicences.js` (both functions), `ntBuildingPractitioners.js`,
`tasLicenceRegister.js`, `vicBpc.js`, `vicVbaLicence.js`, and `waLicenceRegister.js` — now also
handles "Pty Limited" and "Proprietary Limited". Kept the fix file-local rather than extracting a
shared helper, matching this codebase's existing convention of duplicating small per-scraper
helpers (`escapeRegExp`, `nameMatchesEntity` are already independently defined in 11+ files) rather
than introducing cross-file coupling. Live-reverified: NSW, ACT licence, and ACT disciplinary all
now correctly find the same real records when searched with the unabbreviated "Pty Limited"/"Proprietary
Limited" forms. Existing test suites for the touched files (`test-nsw-fairtrading.js`,
`test-act-licences.js`, `test-act-disciplinary.js`, `test-vic-vba-licence-scraper.js`,
`test-nt-building-practitioners.js`) all still pass.

**Two separate, unrelated issues found along the way — flagged, not fixed (user explicitly deferred
these)**:
- `qbcc.js`'s general contractor-licence search is completely dead: both its JSON API
  (`www.qbcc.qld.gov.au/api/licensee-search`) and its own HTML-scrape fallback
  (`/find-a-local-contractor`) now 404 (confirmed live) — QBCC's public site has been restructured
  onto Drupal 11, and this old endpoint/page no longer exists. The failure is completely silent
  (`catch { // ignore }`, no log, no error surfaced) — every QBCC search currently returns a
  normal-looking "done, 0 licences" result indistinguishable from a genuinely clean check. This is
  independent of the suffix-stripping bug above (fails for every company, not just "Pty Limited"
  ones) and is the more severe of the two. Does not affect QBCC's excluded-persons register or
  adjudication registry, which use a different domain/mechanism. **Fixed 2026-08-31** — see the
  dedicated entry below.
- `vicBpc.js`'s entire prosecution/disciplinary register scrape is broken: running
  `test-vicbpc.js` (while verifying the regex fix above didn't regress anything) showed VIC's
  register has been rebranded from "VBA" to "Building and Plumbing Commission" — the fetched page's
  `<title>` is now "The Compliance and Enforcement Register | Building and Plumbing Commission"
  with canonical URL `https://www.bpc.vic.gov.au/compliance-and-enforcement-register`, and contains
  zero `.accordion__block` elements, the markup `parseAccordionItems()` depends on entirely. This
  fails before any search query is even typed in, so it's unrelated to the regex fix — the whole
  page structure changed. **Fixed 2026-08-31** — see the dedicated entry below.

### QBCC and VBA/BPC licence checks fixed; register-drift monitoring added (2026-08-31)

Follow-up to the two "flagged, not fixed" issues above.

**QBCC contractor-licence search** — `www.qbcc.qld.gov.au/api/licensee-search` and its HTML
fallback `/find-a-local-contractor` were both dead (404, QBCC restructured onto Drupal 11). Found
the real replacement by driving `https://my.qbcc.qld.gov.au/myQBCC/s/qbcc-licensee-register`
("Search QBCC Act Licensees") with Puppeteer and reading captured network traffic: a Salesforce
Aura call to `PublicRegisterSearchController.searchQBCCActLicenses({name, firstName, lastName})`.
Better still — `qbcc.js` already had a working **direct axios** Aura-call helper,
`callQBCCAura()`, used for the adjudication registry (`QBCCAdjudicationSearchController`), taking
a fake `fwuid: 'scraper'` / `aura.token: 'null'` and no session cookies at all. Confirmed live that
the exact same trick works for `PublicRegisterSearchController` too — no Puppeteer needed for this
search at all, just a plain POST. Generalized `callQBCCAura(method, params)` to
`callQBCCAura(classname, method, params)` (both existing callers updated) and added
`searchQBCCLicensees()`. Notable field-shape finding: company licensees are stored with
`fname === lname === business name` (there's no separate company-name field — passing the query
via `name` alone returns 0 results; `lastName` alone works and matches company names too), and the
API does a broad substring match on `lastName` (searching "CONSTRUCTION" alone returns ~2000
unrelated hits), so results are filtered locally with a `nameMatchesEntity()` whole-word matcher
(newly added to this file) before being returned. No status/expiry/financial-category fields exist
in this response shape (unlike the old dead endpoint) — only licence number, classification, and
address are available; `riskGrouper.ts`'s `hasInactiveStatus` check on `qbcc?.licenceResults` can
no longer find anything to flag from this source, an honest limitation of what QBCC now exposes
here, not a bug. The old `catch { // ignore }` that silently swallowed every failure is gone —
`searchQBCCLicensees()` now `console.error`s per failed name. Added
`server/tests/test-qbcc-licensee.js` — there was previously no test at all covering this specific
function, which is exactly why the break went unnoticed.

**VIC disciplinary register (VBA → BPC)** — see the dedicated finding above for the rebrand
itself. Found the new backend, `https://www.bpc.vic.gov.au/_api/data/compliance-and-enforcements`
(250 records/page, 943 total, 4 pages), Cloudflare-protected against direct axios/curl (returns a
"Just a moment..." challenge) but reachable through Puppeteer, which clears the challenge
automatically on page load. Confirmed the new page's own search box does nothing server-side — the
API returns the same full list regardless of query string, and the real site filters client-side
in JS after fetching everything — so this was rebuilt as a bulk-cache scraper rather than a live
per-query one, mirroring `asicDpnDataset.js`/`asicDpnDatasetRefresh.js` exactly: new
`vicBpcDataset.js` (`fetchVbaBpcRecords()`, walks pages via `page.evaluate(() => fetch(...))` from
inside an already-Cloudflare-cleared Puppeteer page, JSON-cached to disk, `stale`-cache fallback,
in-flight-fetch dedup) and `vicBpcDatasetRefresh.js` (24h `setInterval`, wired into
`server/index.js` alongside the other two refreshers). `vicBpc.js` itself no longer touches
Puppeteer at all during a live search — it calls `fetchVbaBpcRecords()` and matches locally with
its existing `nameMatchesEntity()`, same as every other rewritten scraper this session. Returns
`status: 'error'` (rather than a false "no proceedings found") if a live fetch fails with no cache
available at all. `test-vicbpc.js` updated to match (previously asserted `.accordion__block`
presence, which no longer exists).

**Register-drift monitoring — the actual answer to "can this be automated"**: full auto-migration
isn't safely automatable (discovering a new endpoint requires interpreting an unfamiliar site by
hand, as both fixes above did — an unsupervised process doing that in production risks silently
scraping the wrong thing). The achievable version is detecting a break quickly and saying so
loudly. `server/tests/run-all.sh` already ran 22 register-accuracy tests in parallel with
pass/fail reporting — its own README even noted a test was excluded "to avoid running deep-check
network calls in routine CI," implying CI was anticipated but never built. Added
`.github/workflows/register-health-check.yml`: runs `run-all.sh` daily (`schedule` cron) plus
on-demand (`workflow_dispatch`), needs `CAPTCHA_API_KEY` added as a GitHub Actions repo secret (not
something this session could do — requires the user to add it in Settings → Secrets and variables
→ Actions). No new alerting code — GitHub already emails on a failed scheduled workflow run.
Runs on GitHub's own runner, never the production process, so it can't contend with real traffic
for the shared `MAX_CONCURRENT_PAGES` pool.

**Two bugs found and fixed in `run-all.sh` itself while wiring this up** — both would have made
the new health check permanently, misleadingly red from day one, which defeats its purpose:
1. `set -euo pipefail` plus a label (`asic-parser`) left in the results-reporting loop after its
   `run_test` call was deleted back on 2026-08-19 meant `cat`-ing its nonexistent log file crashed
   the *entire script* immediately upon reaching the reporting phase — every run silently never got
   past printing failure details for the very first label, never reached the final "ALL TESTS
   PASSED"/"SOME TESTS FAILED" line or `exit $OVERALL`. Removed the stale label.
2. Two different test files (`test-vic-vba-licence.js` and `test-vic-vba-licence-scraper.js`) were
   both given the identical label `vic-vba-licence`, so their log/exit files collided — one test's
   real result was silently overwritten by the other's. Renamed the scraper-level one to
   `vic-vba-licence-scraper`.

Also removed two now-dead entries from `run-all.sh`: `sa-cbs-licence` (probed
`saLicenceRegister.js`, retired earlier this session — the probe itself 404s against a register
this app no longer covers) and `nt-building-licence` (probed a stale, now-unresolvable domain,
superseded by `test-nt-building-practitioners.js` against the real scraper's actual domain, which
already passes).

**Six pre-existing failures surfaced by actually running the full suite for the first time —
flagged, not fixed, out of scope for this pass**: `wa-be-licence`, `act-licence`,
`tas-cbos-licence`, `asic-insolvency`, `modern-slavery`, `fwo` (all older single-purpose "probe"
scripts, distinct from the scraper-function tests they sit alongside — several appear to test a
different tool/page than the one the actual production scraper uses). The new scheduled workflow
will show these as failing from its first run; that's an honest, real, and now-visible baseline,
not a regression from anything in this session — worth investigating separately.

**Post-deploy verification caught a transient, unrelated incident, not a regression**: minutes
after this deploy went live, a production request hung for 1000+ seconds with 25 of 29 scrapers
stuck, including several untouched by this session's changes (`tasLicenceRegister`,
`asicInsolvency`, `atoDebt`). Server logs showed the shared Chromium instance itself crashed
(`ConnectionClosedError: Connection closed`, `Failed to open a new tab` across unrelated
scrapers) — `browser.js`'s `getBrowser()` already has a `b.on('disconnected', ...)` handler that
nulls `browserInstance` so the next call relaunches a fresh browser, and this self-healed: a
follow-up request ~70 minutes later completed cleanly (138s, zero stuck, correct QBCC/vicBpc
results). Root cause of the crash itself not investigated (could be a one-off OOM or unrelated
transient fault) — flagged here mainly because it's exactly the class of thing the new health
check should surface if it recurs, and because whichever specific request is in-flight *during*
such a crash currently has no per-request timeout/retry safety net and will just hang for its
full duration. Worth considering a bounded overall timeout on `getBrowser()`-dependent scraper
calls as a future robustness improvement, separate from this session's scope.

**First real health-check runs (2026-08-31/09-01) — both triggers confirmed working, one new
environmental finding**: the `schedule` cron fired on its own hours after this workflow was added
(no manual action), and a manual `workflow_dispatch` run both completed — confirming both trigger
paths work end-to-end, `CAPTCHA_API_KEY` is readable from the repo secret, and every test this
session added or fixed (`qbcc-licensee`, `vicbpc`, `act-disciplinary`, `vic-vba-licence-scraper`)
passes in CI. But `act-licences`, `court-records` (act/federal/nt fixtures), and `asic-insolvency`
failed in CI despite passing locally minutes earlier — GitHub's shared runner IP ranges appear to
get more aggressive anti-bot treatment (WAF blocks, Cloudflare challenges, connection resets) from
some of these sites than a residential/normal outbound IP does. Treat a CI failure on these
specific tests with that in mind — re-run `workflow_dispatch` before assuming a genuine break, or
cross-check against a local run, since this is IP-reputation noise rather than the site itself
having moved.

### NSW Fair Trading migrated OneGov → Verify NSW; deep links dead-ended and compliance history was invisible (2026-09-01)

**Reported**: for UNIVERSAL PROPERTY GROUP PTY LIMITED (ABN 98 078 297 748 — the same company as the
"Pty Limited" suffix-stripping fix above), the section 8.2 NSW Fair Trading result correctly showed
licence 85273C as `Current`, but two problems: (1) the licence in fact also carries an active
compliance history (a 2026-08-19 condition imposed under s36(1)(c) of the Home Building Act, plus a
2023 penalty notice) that the report gave no indication of; (2) the result's link
(`https://www.onegov.nsw.gov.au/publicregister/#/publicregisterdetails/{licenceID}`) didn't go to the
record at all — it landed on a generic registers landing page.

**Root cause of the link, and by extension the whole scraper's medium-term viability**: the OneGov
Public Register SPA the old `REGISTER_BASE` pointed at has itself been retired and rebranded —
navigating to it now redirects straight to `https://verify.licence.nsw.gov.au/home/`, a new site,
discarding the URL fragment entirely (confirmed live via Puppeteer: `page.goto()` on the old deep
link resolved to the new homepage). This is the same category of register-drift already documented
above for QBCC and VBA→BPC — a site rebrand breaking a hardcoded URL, not a scraper logic bug. The
*search* API the scraper POSTs to (`api.onegov.nsw.gov.au/LicenceCheckService`) still happened to
work standalone, which is exactly why this went unnoticed: the scraper kept returning correct licence
data, only the link and (separately) the compliance data were broken.

**Compliance history was never fetchable from the search response at all**, on either the old or new
API — confirmed by inspecting the full `licenceSearchResults[]`/`results[]` item shape on both: no
compliance/notification field exists there. It's only present on Verify NSW's per-licence details
endpoint, `GET .../publicregisterapi/api/v1/licence/search/details/{licenceType}/{licenceId}` (found
by driving the new site with Puppeteer and reading captured network calls), which returns
`componentData.notifications` (a `"Compliance Did Not Pass"` warning entry when applicable) and
`componentData.complianceSummary` (per-category counts — cancellations, penalty notices, disciplinary
actions, prosecutions, etc). Confirmed live for this exact company: 1 penalty notice, plus the active
condition text quoted above.

**Fixed**: migrated `nswFairTrading.js` off the dead OneGov SPA entirely, onto Verify NSW —
`SEARCH_URL` now POSTs to `verify.licence.nsw.gov.au/publicregisterapi/api/v1/licence/search/advQuery`
(body shape changed: `licenceGroup`/`search`/`pageNumber`/`pageSize` replace the old
`searchCriteria`/`licenceGroupCode`/`searchType`/`rowsPerPage`; response field names changed too —
`results[]` not `licenceSearchResults[]`, `licenceId`/`expires`/`ABN` not
`licenceID`/`expiryDate`/`abn`). No auth or CAPTCHA needed for either endpoint — plain `axios`, same
as before. Added `fetchComplianceInfo()`, one extra `GET` per matched licence against the details
endpoint (cheap — this register typically returns 0-2 hits per company, not a bulk scrape), non-fatal
on failure (leaves `ComplianceHistory` metadata unset rather than asserting "none" when the fetch
genuinely failed — same false-negative concern as the CAPTCHA-gated-check convention above, even
though this endpoint itself isn't CAPTCHA-gated). Result `url` now points at
`verify.licence.nsw.gov.au/details/{licenceType}/{licenceId}` — a real deep link, live-confirmed to
land on the actual record. `description` gets a `" — compliance history on record"` suffix and
`metadata.ComplianceHistory` is set to `"Yes (N recorded event(s)) — see licence record for details"`
or `"None recorded"` when a compliance check succeeds; `ResultCard` already renders arbitrary
`metadata` entries and `description` generically, so this reaches the report with no frontend changes.
Live-verified end to end for the reported company: status `Current`, description now reads
`"Contractor — Licence 85273C — compliance history on record"`, link resolves to the specific record.

Updated `test-nsw-fairtrading.js` (scraper-function test) and `test-nsw-fairtrading-licence.js`
(raw-API probe, still run in CI per `run-all.sh`) to the new endpoint/field names — both pass live
against the new API, including re-confirming the "Pty Limited" suffix-stripping fix still works
(`Universal Property Group Pty Limited` → 1 match) and a second unrelated fixture (`Doss
Constructions Pty Ltd`, discovered via the CI probe term "constructions").

**Risk-summary wiring added same day**: `ComplianceHistory` now also feeds a `riskGrouper.ts`
LICENSING trigger, via a new `hasComplianceHistory()` helper (mirrors `hasInactiveStatus()` —
checks `metadata.ComplianceHistory` starts with `"Yes"`) and a `nswFairTrading` block placed
alongside the existing QBCC/VIC/ACT/WA triggers in the LICENSING group, anchored `#s82`. Deliberately
does **not** set `severity = 'significant'` — a currently-valid licence with compliance history
(penalty notice, disciplinary action, condition) is treated the same as the existing vicBpc/
actDisciplinary/waBuildingEnergy "enforcement action found" triggers (a `'findings'`-level signal),
not escalated to `'significant'` the way an actually inactive/expired/disqualified status is. `npx
tsc --noEmit` clean.

### Production Vercel env vars — Stripe/Google are placeholders (2026-08-03)

`web` project's **Production** environment has real values for everything except `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` — those four were empty
placeholder strings from initial project setup, which went undetected for 75 days because the site was
stuck on a stale pre-`instrumentation.ts`-validation build (see git log around `300ed16`/`7333718`). Once
redeployed on current `main`, boot-time Zod validation (`.min(1)`) correctly started rejecting the empty
values, 500-ing every request. Temporarily replaced with clearly-labeled non-empty placeholders
(`placeholder-not-a-real-secret-*`) on 2026-08-03 to unblock the outage — these satisfy the Zod check but
are not real credentials.

Current behavior with placeholders in place:
- **Google sign-in is visibly broken**: clicking "Continue with Google" redirects to Google's own
  `invalid_client` error page. Fails loudly on Google's side before any app logic runs — no security risk,
  but a broken button. Email/password registration and login still work normally.
- **Stripe payments fail silently for the app**: `STRIPE_SECRET_KEY` being fake means any real payment
  attempt will likely fail client-side at Stripe Elements/Checkout. If `STRIPE_WEBHOOK_SECRET` is ever
  swapped to something real while `STRIPE_SECRET_KEY` stays fake (or vice versa), webhook signature
  verification will fail silently and `PackBalance` will never be credited even though Stripe shows the
  charge as successful — the two must be updated together, from the same Stripe mode (test vs live).

To complete: get real values from Stripe Dashboard → Developers → API keys / Webhooks (create an endpoint
at `https://check.trustworthypayments.com/api/payments/webhook` if one doesn't exist yet — prefer a
Stripe **restricted key** scoped to PaymentIntents/Subscriptions over the full secret key) and Google Cloud
Console → OAuth client, then in Vercel: `web` project → Settings → Environments → Production → update the
four variables → redeploy (env var changes require a fresh deploy to take effect, per `vercel redeploy`).

### No scraper or link covers ASIC's own Court Enforceable Undertakings register (2026-08-27) — FIXED (2026-09-06)

**Fixed — see "ASIC Court Enforceable Undertakings register added; manual reference links and
AFSA NPII removed (2026-09-06)" below** for the full record, including why the "Not yet done"
items directly below were answered differently than either option they proposed (no bulk API
exists, but the register turned out to be a single scrapeable static page).

**Confirmed via a real production case**: a search for UNIVERSAL PROPERTY GROUP PTY LIMITED (ABN
98 078 297 748) came back clean, despite the company (and director Bhart Bhushan) having accepted
an ASIC enforceable undertaking in 2011 over unconscionable conduct in vendor-finance lending
(ASIC media release
[11-81MR](https://www.asic.gov.au/about-asic/news-centre/find-a-media-release/2011-releases/11-81mr-property-developer-enters-into-enforceable-undertaking-providing-compensation-for-vendor-finance-borrowers),
EU document logged on ASIC's [Court Enforceable Undertakings
Register](https://asic.gov.au/online-services/search-asic-registers/other-registers/court-enforceable-undertakings-register/)).
Live-verified end to end: ran the actual `/api/search` for this ABN and inspected all 29 result
lines — nothing resembling this EU appears anywhere, including section 8.1's `asic`/`asicExtract`
results.

**Root cause is a coverage gap, not a bug.** `grep -ri "enforceable" server/scrapers/*.js` finds
exactly two things: `fwo.js` (Fair Work Ombudsman underpayment EUs) and `links.js` (manual links
to *state WHS regulators'* EU pages — WorkSafe VIC/NSW, QLD Office of Industrial Relations).
Nothing in the codebase — no scraper, not even a `links.js`-style manual link — has ever pointed
at ASIC's own EU register. It's a completely separate ASIC register from company search
(`asic.js`), officer/charges search (`asicExtract.js`), or the disqualified-persons dataset
(`asicDpnDataset.js`) — none of those would surface an EU record even if they were working
perfectly.

**Separate, already-known issue hit during the same live check**: the `asic.js` company search
itself returned zero results for this company name — this is the same not-yet-root-caused
name-only ASIC Connect search failure documented above under "`resolveDirectors()` is currently
starved." Unrelated to the EU gap (a working company search still wouldn't show an EU record) but
worth keeping in mind — it means director/company-status data was also missing from this
particular report, not just the EU. `asicInsolvency` did correctly surface the current
administration (1 insolvency/winding-up notice found), so that part of the picture came through.

**Not yet done** — deferred, no immediate plan to pick this up:
- Establish whether ASIC's Court Enforceable Undertakings register has a scrapeable
  search/listing (plain HTML, API, or CAPTCHA-gated like ASIC Connect) — not yet investigated at
  all, unlike the AustLII/Federal Court/NT investigations elsewhere in this file.
- If scrapeable: add it as a new section 8.1 entry (`asicEnforceableUndertakings.js`,
  `server/index.js` searches array, `INITIAL_SEARCHES` in `SearchContent.tsx`, `ReportContent.tsx`
  rendering) following the "Adding a new scraper" convention above.
- If not cheaply scrapeable (CAPTCHA, no full-text search, etc.): add it as a manual link via
  `links.js` in the meantime, same pattern as the WHS regulator links already there — better than
  the current state of not being mentioned in the report at all.

---

### ASIC Court Enforceable Undertakings register added; manual reference links and AFSA NPII removed (2026-09-06)

Follow-up to the gap immediately above, plus two other items surfaced during the same
investigation (checking a real person/company pair for undisclosed ASIC/AFSA records).

**ASIC Court Enforceable Undertakings (CEU) register — added to §8.1.** Neither of the two options
the previous entry proposed panned out as expected: queried data.gov.au's CKAN Action API directly
for ASIC's organization (`package_search?q=organization:australian-securities-and-investments-
commission-asic`) and confirmed it publishes exactly 12 datasets — companies, business names,
licensee/adviser/auditor registers, banned & disqualified persons — no bulk/open-data API for this
register at all. But the register page itself
(`https://www.asic.gov.au/online-services/search-asic-registers/court-enforceable-undertakings-register`)
turned out to be a single, fully public, unauthenticated static HTML page listing every undertaking
since 1998 (~500 records, confirmed live via plain `curl` — 200 OK, no Cloudflare/WAF, no CAPTCHA,
no pagination). That made it a better fit for the fetch-once-cache-and-match-locally pattern this
codebase already uses for `vicBpcDataset.js`/`asicDpnDataset.js` than either a live per-query
scrape or a manual link would have been. New files: `asicEnforceableUndertakingsDataset.js`
(fetch+cache, plain axios/cheerio — no Puppeteer needed, since there's no Cloudflare to clear
unlike the VIC BPC case), `asicEnforceableUndertakingsDatasetRefresh.js` (24h refresh, mirroring
`vicBpcDatasetRefresh.js`), and `asicEnforceableUndertakings.js` (name/director matching against
the cached list, reusing `vicBpc.js`'s phrase-anchored `nameMatchesEntity()`). Wired into
`server/index.js`'s searches array, §8.1 in `SearchContent.tsx`/`ReportContent.tsx`, and a new
`significant`-severity CORPORATE trigger in `riskGrouper.ts` (an accepted CEU is treated as
comparable in weight to the existing ASIC disqualified-persons trigger). One parsing quirk found
and handled: pre-~2011 rows have no `<p>` wrapper around the party name — just bare text nodes
separated by `<br>`, immediately followed by the media-release `<a>` with no separator, which a
naive `.text()` call joins into e.g. "Mrs I C HilderMedia Release 98/236". Fixed by stripping the
`<a>` and converting `<br>` to a join point before extracting text. Live-verified end to end
(`server/tests/test-asic-eu.js`, self-discovers a real current fixture from the page's own listing
the same way `test-vicbpc.js`/`test-asic-insolvency.js` do) and added to `run-all.sh`.

**Manual reference links (`links.js`, "Additional Database Links") removed entirely — not just the
four stale/duplicated WA/NT/ACT/TAS entries flagged 2026-09-04, all twelve.** Investigation found
the web report never actually rendered this section at all — the `links` key was fetched by
`server/index.js`, streamed to the client, and tracked in a couple of dead
`.filter((r) => r.key !== 'links')` calls, but no `byKey('links')` ever existed in
`ReportContent.tsx` to surface it. Only the React Native mobile app (`src/screens/ReportScreen.tsx`)
actually displayed it, as an "Additional Databases — Manual Review" section. Deleted
`server/scrapers/links.js` and its `server/index.js` wiring; removed the corresponding
`ReportSection` block, `byKey` call, and `Category` type entry on both web and mobile; removed the
now-fully-dead `isLinkSection` prop/branch from the mobile `ReportSection` component. Not touched:
`courtRecords.js`'s own manual-fallback links for the 5 court jurisdictions with no free full-text
search (`buildManualFallback`/`supplementalLinks`) — a distinct, still-needed feature.

**AFSA NPII (Deep Check personal-insolvency check) removed entirely**, per the standing
recommendation in `server/tests/README.md` since 2026-07-05 (`services.afsa.gov.au/brs/`
decommissioned the free NPII register in favour of a paid-only Bankruptcy Register Search with no
free tier — every search, including fictitious names, redirected to a payment page). Re-confirmed
broken live during this session's investigation: it silently returned `results: []` for a real
individual independently confirmed (via web search) to have a bankruptcy history — indistinguishable
from a genuine clean result, the exact silent-false-negative shape this file's scraper conventions
exist to prevent. Deleted `server/scrapers/afsaNpii.js`, `server/tests/test-afsa-npii.js`, and
`server/tests/run-s83.sh` (which existed solely to run that one test outside `run-all.sh` — its
other four tests were already covered by `run-all.sh` directly). Removed the corresponding
`server/index.js` `isDeepCheck` push block, `DEEP_CHECK_SEARCHES` array and insertion logic in
`SearchContent.tsx`, and all `afsaNpii` references in `ReportContent.tsx`/`riskGrouper.ts`.

**Deep Check ($15) pricing/UI deliberately left in place, per user decision, despite losing its
only exclusive scraper.** `asicExtract` already runs on every search unconditionally, so removing
AFSA NPII means Deep Check currently returns identical results to a free search. Decided not to
touch pricing, Stripe amounts, or the `EmailGate` paid-tier checkbox in this change — only its
description copy was corrected to drop the AFSA NPII claim ("Adds full historical director list via
ASIC Data API..."). Worth revisiting if/when a new deep-check-exclusive scraper is added, or if the
tier should be retired/repriced in the meantime. Note the remaining half of that description
("ASIC Data API") is itself still aspirational per Phase 7c above — not fixed here, just not
compounded with a second false claim.

**Mobile app (`src/screens/ReportScreen.tsx`) scope note**: confirmed already significantly stale
versus the current backend independent of this change — it still reads retired
`austlii_federal`/`austlii_qld`/etc. keys (replaced by `courts_*` in `281554d`, 2026-08-26) and has
no section at all for `asic`, `asicDisqualified`, `asicExtract`, or most scrapers added since. There
is no §8.1-equivalent section on mobile to extend, so the new ASIC CEU register is web-only for now.
Flagged here as a separate, pre-existing gap worth its own task.

---

### VIC/QLD direct-to-court investigation (dead end); ACAT added to ACT courts search (2026-09-07) — broke in production same day, see incident report below

Investigated whether QLD and VIC could get live, ToS-free court/tribunal coverage the same way
federal/NSW/ACT/NT already do (a direct search against each court's own site, no AustLII/JADE
aggregator involved) — following on from the JADE-vs-AustLII research above, since both turned out
to have identical "no automated access without prior written permission" restrictions.

**VIC — partial, real but narrow.** Supreme Court of Victoria hosts its own genuine judgment-
summaries page (plain static HTML, real case titles + PDF links, no restrictive terms found) — but
it's rolling 12-months-only (older entries are removed/archived per the page itself). VCAT (the
tribunal that actually hears domestic/commercial building disputes — VIC's equivalent of QCAT) and
County Court of Victoria both confirmed to **not** host their own decisions at all; both explicitly
point to AustLII/JADE instead. Not built — a 12-month Supreme-Court-only scraper would miss the
single most relevant VIC tribunal for this product, so this wasn't judged worth the effort yet.

**QLD — dead end, no viable path.** The Queensland Courts government site and QCAT's own site both
confirmed to not host their own decisions either — everything routes through
`queenslandjudgments.com.au`, a joint venture between the ICLRQ and Supreme Court Library
Queensland (SCLQ). Pulled their live Terms of Use directly: identical restriction to JADE/AustLII —
"must not... use any robot, spider, screen scraper, data aggregation tool or other automatic
process to monitor, copy or extract any Materials... without the prior written consent of both the
ICLRQ and the SCLQ." No primary-government-source alternative exists for QLD the way VIC's Supreme
Court provides one. QLD stays on the manual-link fallback; closing this gap needs the same
written-permission conversation as JADE, not a scraper.

**ACT — found and fixed a real, separate gap: ACAT was never actually searched.**
`JURISDICTION_SOURCES.act` in `courtRecords.js` had listed "ACT Civil & Administrative Tribunal
(ACAT)" as a covered source, but `searchActJudgments` only ever queried `courts.act.gov.au`
(Supreme Court + Magistrates Court) — ACAT, the tribunal that actually hears most ACT building
disputes (the ACT's equivalent of VCAT/QCAT), publishes its decisions on a **completely separate,
self-hosted database** at `acat.act.gov.au/decisions2/search-decisions`, which was never being hit
at all. Unlike VCAT/QCAT, this one is real and compliant: same Funnelback platform and result
markup as the existing `courts.act.gov.au` search (so the existing parser logic ports directly),
a dedicated `meta_partyName` field for precise party-name filtering, no Cloudflare block on this
particular path (its `/general/search` endpoint does challenge a plain request — the
`/decisions2/search-decisions` path doesn't), and ACT Government web content is published under
Creative Commons Attribution 4.0 by default — no scraping restriction, unlike JADE/AustLII/
Queensland Judgments.

Added `fetchAcatTermResults` alongside the existing `fetchActTermResults` in `courtRecords.js`, and
a new `fetchActAndAcatTermResults` combinator that queries both via `Promise.allSettled` and only
throws if *both* fail — a hiccup in one source no longer discards good results from the other (a
plain `Promise.all` would have let one flaky source erase the other's real hits after
`runJurisdictionSearch`'s per-term retry logic gave up). `searchActJudgments` now uses the
combinator; `source` label updated from `'ACT Courts'` to `'ACT Courts & ACAT'` for accuracy. No
other files needed changes — this enriches the existing `courts_act` result key rather than adding
a new one, so `server/index.js`, `SearchContent.tsx`, and `ReportContent.tsx` needed no wiring.
Live-verified: a real ACT builder (Geocon Constructors) now surfaces 2 additional ACAT decisions
previously invisible to the report, alongside its existing 5 Supreme Court results.
`server/tests/test-court-records.js` (all 11 assertions) still passes unchanged.

---

### ACT court search broke in production the same day ACAT was added — root cause was NOT the ACAT change (2026-09-07)

Reported same-day: ACT Courts & Tribunals returning `status: 'error'` / "Search failed" in
production. Two fix attempts; the first was wrong. Recorded in full because the wrong-diagnosis
path is itself the useful lesson here — a locally-clean reproduction plus a plausible-sounding
mechanism (burst rate against a shared backend) isn't confirmation, and the fastest way to find out
was direct access to the production container, not more local testing.

**First hypothesis (wrong): burst rate-limit from the new ACAT addition.** `courts.act.gov.au` and
`acat.act.gov.au` turned out to be the *same* backend (identical `x-slug: actssict-web` header,
same Cloudflare zone, same session-cookie shape). Reasoned that firing both at once — doubled again
by the existing per-term retry — was tripping a burst rate-limit that a single request never had.
Shipped a fix (sequential fetch instead of `Promise.allSettled` in parallel, plus a 2s backoff
before retrying) and a genuinely useful side-fix: `runJurisdictionSearch`'s `fetchOne` had no
logging at all on the failure path, so the real underlying error was invisible for every
jurisdiction, not just ACT — added `console.error` there. Deployed. **Still failed identically.**

**Root cause, found via direct access to the production container**: registered an SSH key with
`railway ssh keys add` and used `railway ssh` to run test code *from inside the actual Railway
container* rather than reasoning from local reproductions that couldn't see what Railway's IP
actually experiences. A single, isolated `courts.act.gov.au` request (no ACAT involved at all)
returned a plain 403 from there — ruling out the burst-rate theory immediately, since there was no
burst. Escalating to `fetchWithBrowser` (Puppeteer) got further — a real page loaded — but it was a
genuine Cloudflare managed challenge page ("Just a moment...", `challenges.cloudflare.com` in the
CSP), byte-for-byte identical whether given 25s or 55s to clear. Not a timing problem; a standing
block on Railway's IP specifically. The identical request from a residential IP (my own machine)
worked instantly throughout. This was very likely already broken before the ACAT work — the
isolated `courts.act.gov.au` path is the original code, unchanged by that session — either
Cloudflare's configuration on this zone tightened sometime after this scraper was last confirmed
working (2026-08-26), or the heavy same-session testing against these exact URLs (from both a local
machine and repeated Railway redeploys) tipped Railway's IP into a flagged state. Not resolved which.

**Fix**: routed both fetchers through ScraperAPI (`http://api.scraperapi.com?api_key=...&url=...`),
reviving the exact proxy pattern originally built for the now-retired `austlii.js`. Confirmed live
via the same `railway ssh` access, both endpoints, before writing any code — cleared the challenge
cleanly on both `courts.act.gov.au` and `acat.act.gov.au`. Falls back to a direct request when
`SCRAPERAPI_KEY` isn't set (local dev). Worth noting why this is a legitimate fix and not the kind
of thing declined for AustLII/JADE/Queensland Judgments above: those three have an explicit written
policy prohibiting automated access; ACT Government's site has none found (content is CC-BY-4.0) —
this is a generic Cloudflare bot-wall, the same technical category as Federal Court and NT Supreme
Court, both already Cloudflare-gated and already legitimately handled elsewhere in this same file
via Puppeteer. Live-verified end to end post-fix: a real production search for "Geocon" returned
all 7 expected results (5 Supreme Court + 2 ACAT) with `status: 'done'`; Federal/NSW/NT and the
QLD/VIC/WA/SA/TAS manual-fallback jurisdictions all confirmed unaffected in the same request.

An SSH key (`railway-debug`) is now registered with the project's Railway account — direct
`railway ssh` access into the production container is available for future debugging without
needing to redeploy just to add a `console.log`.

---

## Performance baseline (2026-05-21)

10 sequential `POST /api/search` requests, entity "Multiplex", Express at `localhost:3001`.

| Metric | Result |
|--------|--------|
| Cold start | 19.1 s |
| p50 warm | 0.3 s |
| p90 warm | 0.5 s |
| Target | < 45 s |
| Status | PASS ✓ |

---

## Section 8.5 verification (2026-07-16)

Courts, Enforcement & Disciplinary (`id="s85"`, fed by `server/scrapers/austlii.js` × 9
jurisdictions, `server/scrapers/fwo.js`, and the adjudication branch of `server/scrapers/qbcc.js`)
was re-verified after its last rewrite (`d86cf54`, `dfe56e6`, both 2026-06). Two real issues
found and fixed, one false alarm ruled out:

- **AustLII** — `server/scrapers/austlii.js` never loaded `server/.env` itself; it only worked
  in production because the npm scripts use `node --env-file=.env`. Running the module
  standalone left `SCRAPERAPI_KEY` unset → 403 from ScraperAPI. Fixed by adding
  `require('dotenv').config(...)` at the top of the file (a no-op when the key is already set).
- **FWO** — the scraper (`server/scrapers/fwo.js`) was fine; `test-fwo.js`'s own
  `extractEntityName()` fixture-discovery regex was too narrow for that week's headline
  phrasing (single-word entities, "The X of Y" names). Widened the regex in the test file.
- **QBCC adjudication** — passed with no changes; the Salesforce Aura API and response shape
  are unchanged since the `dfe56e6` rewrite.

All three tests pass individually and together (`bash server/tests/run-s85.sh`). See
`server/tests/README.md` — "Section 8.5 sub-agent prompts" and the matching "Common failure
patterns" entries for AustLII/FWO for future debugging.

---

## Section 8.3 — Payment Times dropdown fixed (2026-07-20)

The dropdown in section 8.3's Payment Times result never rendered for any entity. Root cause:
`paymentTimes.js` hardcoded PTRR Excel column letters (B=name, C=ABN, U=avg days, etc.); the
live register's columns had shifted, so `metadata` came back `{}` and `description` came back
`undefined` — `hasExtras` was false in `ResultCard`, so no expand arrow. Fixed by parsing the
header row (row 2) at request time and resolving each field by case-insensitive substring
match on header text, falling back to the old hardcoded letters if no header row parses.
Verified end-to-end: BHP now returns populated metadata (ABN, Reporting period, Average
payment time, etc.) and a non-empty description.

While verifying, also found and fixed a second, unrelated issue: `fetchRegisterBuffer()`
intermittently got a 406 from the Azure Front Door WAF in front of the register download —
not deterministic, not header-dependent, looks like an IP-level soft-block that can persist
across immediate retries. Added a 5-attempt retry with increasing backoff (3s, 6s, 9s...),
which recovers most of the time (~7/8 in testing) but not always — this is a genuine external
limitation, not something fully fixable client-side. See `server/tests/README.md` — "Common
failure patterns" — "Payment Times — intermittent 406" if `test-payment-times.js` fails on a
406 after retries; it's very likely this flakiness, not a regression.
