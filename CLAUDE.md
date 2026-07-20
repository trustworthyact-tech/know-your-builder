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

**Contract extraction lives in the Next.js app**, not the Express server (`web/lib/contractExtractor.ts`). The Express server has no `@anthropic-ai/sdk` or AWS SDK.

**`DocumentBlockParam` cast via `any`** in `contractExtractor.ts` — the SDK types don't include it but the runtime supports it.

**R2 object is always deleted after extraction** — unconditionally, on success and error paths.

**DOCX extraction returns `confidence: 'low'` with empty fields** — prompt user to fill manually.

**Use `XMLHttpRequest` for file uploads** when upload progress is needed — `fetch` does not expose `upload.onprogress`.

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

---

### Phase — Payment Times dropdown missing (section 8.3)

**Root cause:** `paymentTimes.js` hardcodes column letters (B=name, C=ABN, F/G=dates,
M=terms, U=avg days, Y/Z/AA=percentages). If the PTRR Excel has shifted those columns,
only the row *match* survives — giving a `ResultCard` with a title — but all metadata
fields stay `{}` and `description` is `undefined`, so `hasExtras` is false and no
dropdown renders. Confirmed symptom: BHP Group ABN 49 004 028 077 shows a hit in
section 8.3 but has no expand arrow.

**Task 1A — Investigate column structure** (standalone agent, no dependencies)
```
Working directory: /Users/jameskwan/know-your-builder

Run the existing payment times test:
  node server/tests/test-payment-times.js

Then write and run a one-off diagnostic script at server/tests/debug-ptrr-columns.js
that downloads (or uses the cached /tmp/ptrr_register.xlsx), calls extractZipEntry for
xl/worksheets/sheet2.xml, reads ONLY row 2 (the header row), and prints each column
letter → header text. Use the existing extractZipEntry and parseSharedStrings helpers
already in server/scrapers/paymentTimes.js — copy or require them.

Report:
1. Full output of test-payment-times.js (PASS / FAIL and why)
2. The full column-letter-to-header-name map from the live register header row
3. Which column letters hold: Business Name, ABN, ACN/ARBN, Period Start, Period End,
   Standard Payment Terms, Average Days, Paid within 30 days, 31-60 days, Over 60 days

Do NOT make any changes to production files.
```

**Task 2 — Dynamic column detection** (depends on Task 1A findings)
```
Working directory: /Users/jameskwan/know-your-builder

You have been given the column-letter-to-header-name map from the PTRR Excel header row
(Task 1A findings). The file to change is server/scrapers/paymentTimes.js.

Rewrite searchWorkbook() to:
1. Parse row 2 (the header row) before the main row loop — build a colLetter → headerText
   map using the same cell regex already in the function.
2. Invert it to build a headerText → colLetter lookup. Use case-insensitive substring
   matching on the header texts to find the right column for each field:
   - Name column: header contains "business name" or "entity name" or "reporting entity"
   - ABN column: header contains "abn"
   - ACN column: header contains "acn"
   - Type column: header contains "type" or "report type"
   - Period start: header contains "start"
   - Period end: header contains "end"
   - Std terms: header contains "standard" and "term"
   - Avg days: header contains "average" (pick the first match, or the one also containing "all")
   - Within 30: header contains "30"
   - 31-60: header contains "31" or "60"
   - Over 60: header contains "over" or "after"
3. Replace all hardcoded cells['B'], cells['C'], cells['U'], etc. with the dynamically
   resolved column letters (e.g. cells[nameCol], cells[abnCol], etc.).
4. Update the per-row quick-check regexes for name and ABN columns from hardcoded
   /<c r="B\d+"...> and /<c r="C\d+"...> to use the discovered column letters
   (build the regex dynamically: new RegExp(`<c r="${nameCol}\\d+" t="s"><v>(\\d+)<\\/v><\\/c>`)).
5. If no header row can be parsed (edge case), fall back to the old hardcoded letters
   so the scraper degrades gracefully.

After editing, run:
  node server/tests/test-payment-times.js
Confirm PASS and that the returned result for BHP includes populated metadata fields
(ABN, Reporting period, Average payment time) and a description string.
```

**Task 3 — Verify** (depends on Task 2)
```
Working directory: /Users/jameskwan/know-your-builder

Delete the cached register to force a fresh download:
  rm -f /tmp/ptrr_register.xlsx /tmp/ptrr_register.etag

Run:
  node server/tests/test-payment-times.js

Confirm:
1. Test PASSES (BHP found, >= 1 result)
2. The returned result object has metadata with at least: ABN, Reporting period,
   Average payment time populated (non-empty strings)
3. description is a non-empty string ("Latest report period ending YYYY-MM-DD")
4. Object.keys(result.metadata).length > 0 is true — so hasExtras = true in ResultCard
   and the dropdown button will render

Report full test output.
```

**Execution order:**
- Task 1A runs first (standalone)
- Task 2 runs after Task 1A, using its column map findings
- Task 3 runs after Task 2

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
