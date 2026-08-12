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
