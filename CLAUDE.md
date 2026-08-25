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
     abn  austlii  qbcc  paymentTimes  modernSlavery  asic  fwo  …  links
```

`POST /api/search` streams NDJSON — each scraper writes one line when it finishes. The frontend merges results by `key` and updates the UI per-result.

**`links.js` is not a scraper** — it returns pre-populated deep-link URLs for databases that are too hard to scrape. No HTTP calls.

**AustLII is called nine times**, once per jurisdiction key (`federal`, `qld`, `nsw`, `vic`, `wa`, `sa`, `nt`, `act`, `tas`), scoped via `mask_path`.

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

### AustLII/FWO don't search asicExtract's associated companies (2026-08-11)

Section 8.1 surfaces phoenix-detected companies via `asicExtract.js` (other companies the
target entity's directors are/were involved with) alongside ABR business/trading names. AustLII
and FWO now search the latter (via `resolveExtraSearchTerms()` in `server/index.js`, combining
`resolveDirectors()` + `resolveAlternateNames()`) but not the former — litigation or enforcement
history filed under a related/associated company name is still invisible to those two sections.

Not done because `asicExtract` is a slow, CAPTCHA-gated ASIC lookup that AustLII/FWO don't
currently depend on finishing — `resolveExtraSearchTerms()`'s two inputs both run in parallel
with everything else already, so adding them cost no extra latency. Waiting on `asicExtract`
instead would add a real sequential dependency and slow those 10 searches down.

To complete: give `asicExtract`'s promise the same treatment as `asicPromise` — hoist it above
the `searches` array (it's currently only invoked inside its own entry, `index.js:~310`), add a
`resolveAssociatedCompanies()` helper that awaits it and extracts `title`/`metadata.ACN` from its
results, and fold that into `resolveExtraSearchTerms()`. Also route those names through
`stripCompanySuffix()` in `austlii.js` — associated companies will carry "Pty Ltd" suffixes just
like the primary entity does.

### AustLII scraper is currently non-functional — Cloudflare block, not a bug (2026-08-12)

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
`waLicenceRegister`, `saLicenceRegister`, `tasLicenceRegister`, and `afsaNpii`. If nobody types
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

### Puppeteer-dependent scrapers systemically starved under real concurrent search load — now confirmed to affect non-Puppeteer scrapers too (2026-08-19)

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

**Not yet done** (supersedes/expands the equivalent item in the entry above):
- Root-cause via Railway's own metrics (CPU/memory graphs for the `know-your-builder-server`
  service) during a load spike, not just NDJSON output — need to know if this is CPU starvation,
  memory pressure, or genuinely an infra-side proxy timeout independent of server load.
- If it's resource starvation: `MAX_CONCURRENT_PAGES` (`browser.js`, currently 3) and/or the
  Railway service's resource allocation (currently `hobby` plan, confirmed via `railway status
  --json`) likely both need attention — reducing concurrent Puppeteer pages further and/or
  upgrading the plan are the two levers, not mutually exclusive.
- Consider whether Railway's proxy has a fixed request timeout shorter than a worst-case full
  search currently takes, independent of server-side performance — would explain why the same
  symptom (partial NDJSON, clean-looking stream end) recurs even as the specific scrapers
  affected varies between runs.

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

---

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
