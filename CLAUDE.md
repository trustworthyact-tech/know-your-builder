# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Two processes must both be running

This project has two separate Node processes that must run simultaneously:

```bash
# Terminal 1 — API server (port 3001)
cd server && node index.js

# Terminal 2 — Expo dev server (tunnel mode for phone support)
cd know-your-builder && npx expo start --tunnel
```

Open the app in the browser by pressing `w` in the Expo terminal. Tunnel mode (`--tunnel`) uses ngrok so a physical phone can reach the dev server regardless of LAN routing; without it the QR code may advertise an unreachable IP on some networks.

**Physical device setup:** set `EXPO_PUBLIC_API_URL` in `.env.local` to the Mac's LAN IP so the phone can reach the API server:
```
EXPO_PUBLIC_API_URL=http://192.168.x.x:3001
```
This env var is baked into the Expo bundle at Metro start time, so restart the Expo server after changing it.

## Type checking

```bash
npx tsc --noEmit
```

There is no test suite and no linter configured.

## Architecture

### Request flow

```
HomeScreen → SearchingScreen → ReportScreen
                  │
                  ▼
         src/services/api.ts          (fetch + NDJSON stream reader)
                  │
                  ▼
         server/index.js :3001        (Express, runs all scrapers in parallel)
                  │
        ┌─────────┼──────────────────────────────┐
        ▼         ▼         ▼          ▼          ▼
     abn.js  austlii.js  qbcc.js  paymentTimes  modernSlavery  links.js
```

The server endpoint `POST /api/search` streams results back as **newline-delimited JSON (NDJSON)**. Each scraper fires independently via `Promise.all`; as each finishes it writes one JSON line to the response. The frontend reads the stream incrementally and updates the UI per-result — no waiting for all searches to complete before showing progress.

### Key design decisions

**`links.js` is not a scraper.** It generates pre-populated deep-link URLs for every database that is too hard to scrape (ASIC, state building licence registers, SafeWork agencies, etc.). The report renders these as a tappable list in the "Additional Databases — Manual Review" section.

**AustLII covers most courts.** `server/scrapers/austlii.js` is called nine times (once per jurisdiction key: `federal`, `qld`, `nsw`, `vic`, `wa`, `sa`, `nt`, `act`, `tas`). Each call scopes the search to that jurisdiction's AustLII path prefix via the `mask_path` parameter. The same scraper covers all courts and tribunals within each jurisdiction, including Fair Work Commission, VCAT, NCAT, QCAT, etc.

**SearchResult keys are stable contracts.** `SearchingScreen` initialises a hard-coded list of 14 keys (matching exactly the keys emitted by the server) and merges incoming stream updates by `key`. Adding a new scraper requires adding the key to both `server/index.js` and the `INITIAL_SEARCHES` array in `SearchingScreen.tsx`.

### Frontend structure

- `src/types/index.ts` — all shared TypeScript types (`BuilderInput`, `SearchResult`, `ResultItem`, `RootStackParamList`)
- `src/theme.ts` — single source of truth for all colours, typography scales, and shadows; import `colors`, `typography`, `shadows` from here in every component
- `src/services/api.ts` — `runDueDiligence()` streams NDJSON and calls `onProgress` per result; `checkServer()` health-checks before starting. `SERVER_URL` resolves from `EXPO_PUBLIC_API_URL` env var (set in `.env.local`), falling back to `http://localhost:3001` for browser use.
- Navigation is a simple three-screen stack (`Home → Searching → Report`); `Searching` uses `navigation.replace` (not `navigate`) so the back button is suppressed

### Server structure

- `server/scrapers/abn.js` — scrapes `abr.business.gov.au` by ABN or name
- `server/scrapers/austlii.js` — scrapes AustLII full-text search, parameterised by jurisdiction
- `server/scrapers/qbcc.js` — tries QBCC JSON API then falls back to HTML scrape; also scrapes adjudication decisions separately
- `server/scrapers/paymentTimes.js` — tries Payment Times Register JSON API then falls back to HTML
- `server/scrapers/modernSlavery.js` — scrapes the HTML search page directly (the register has no usable public API). After parsing `a.search-results__item` elements, results are filtered by `isEntityMatch()` which requires every significant word of the company name (or the ABN) to appear in the *reporting entity* field — this prevents false positives from statements where the search term only appears in a subsidiary's name inside the statement body
- `server/scrapers/links.js` — pure function, no HTTP calls; returns pre-populated URLs for ~35 databases

All scrapers follow the same return shape: `{ source, jurisdiction, category, results[], searchUrl, summary }`. Errors are caught per-scraper in `server/index.js`; a failing scraper never brings down other searches.

### Adding a new data source

1. Create `server/scrapers/mySource.js` exporting an async function that returns the standard shape above
2. Import and add it to the `searches` array in `server/index.js` with a unique `key`
3. Add a matching entry to `INITIAL_SEARCHES` in `src/screens/SearchingScreen.tsx`
4. Consume it in `ReportScreen.tsx` via `byKey(results, 'mySource')` and pass to a `<ReportSection>`

---

## Phase 1a — Next.js scaffold (complete)

The `web/` directory contains the Next.js 14 app (App Router). Key conventions set in this phase:

### Running the web app

```bash
# Terminal 3 — Next.js dev server (port 3000)
cd web && npm run dev
```

All three processes (Express :3001, Expo, Next.js :3000) are independent. The Next.js app talks to Express at `SCRAPING_SERVICE_URL` (env var, defaults to `http://localhost:3001` server-side).

### Type checking (web)

```bash
cd web && npx tsc --noEmit
```

### Key files

- `web/prisma/schema.prisma` — PostgreSQL schema (Prisma 5). Run `npx prisma generate` after any schema change; run `npx prisma db push` to sync a dev database.
- `web/lib/db.ts` — Prisma client singleton (safe for Next.js hot-reload via `globalThis` cache)
- `web/app/layout.tsx` + `web/app/providers.tsx` — root layout with Inter font; `Providers` is a client component wrapping NextAuth `SessionProvider`
- `web/app/globals.css` — Tailwind directives + CSS custom properties for brand colours
- `web/tailwind.config.ts` — Tailwind extended with all brand colours from `src/theme.ts`
- `web/.env.local.example` — copy to `.env.local` and fill in all values before running

### Package versions

- `next`: 14.2.35 (patched 14.x; do not upgrade to 15/16 without updating App Router conventions)
- `prisma` / `@prisma/client`: 5.x
- `next-auth`: 4.x with `@auth/prisma-adapter`
- `@react-email/components`: 1.x + `react-email`: 6.x

---

## Phase 1b — Shared types, theme, and API client (complete)

### Key files

- `web/src/theme.ts` — web port of `src/theme.ts`; `lineHeight` values are CSS strings (e.g. `'36px'`) not React Native numbers; `shadows` are CSS `box-shadow` strings not RN shadow objects
- `web/src/types/index.ts` — port of mobile types plus `Persona` enum (`HOMEOWNER | SUBCONTRACTOR | DEVELOPER | LENDER`) and `RiskGroupResult` / `RiskGroupTrigger` / `RiskGroupId` types (consumed by Phase 2 risk engine)
- `web/lib/api.ts` — browser-safe port of `runDueDiligence()` and `checkServer()`; resolves `SERVER_URL` from `NEXT_PUBLIC_SCRAPING_SERVICE_URL` first (required for browser-side streaming), then `SCRAPING_SERVICE_URL` (server-side), then `http://localhost:3001`

### Conventions

Both env vars must be set for full functionality: `NEXT_PUBLIC_SCRAPING_SERVICE_URL` for client components that stream NDJSON directly from the browser, and `SCRAPING_SERVICE_URL` for server-side Route Handlers that proxy to Express.

---

## Phase 1c — Home screen (complete)

### Key files

- `web/app/page.tsx` — React Server Component (no `'use client'`); delegates all interactivity to `<HomeSearch />`
- `web/components/SearchBar.tsx` — `'use client'` form component; `formatABN()` auto-formats input as `XX XXX XXX XXX` on every keystroke; validates that at least one of company name or ABN is provided; on submit, strips ABN formatting to raw digits before pushing to `/search?companyName=...&abn=...&licenceNumber=...`

### Conventions

Keep `page.tsx` as a Server Component and extract any interactive UI into dedicated `'use client'` components in `web/components/`. Search params are passed as URL query params to `/search` — the Searching screen reads them from `useSearchParams()`.

---

## Phase 1d — Searching screen (complete)

### Key files

- `web/app/search/page.tsx` — Server Component wrapper; exists solely to wrap `SearchContent` in `<Suspense>` (required by Next.js 14 for any client component using `useSearchParams()`)
- `web/app/search/SearchContent.tsx` — `'use client'` component with all stream logic; checks server health, marks all rows `searching`, then calls `runDueDiligence()` from `web/lib/api.ts` and merges each NDJSON result into the row list by `key`
- `web/components/SearchProgressItem.tsx` — single source row; four visual states: idle (gray ring), searching (CSS `animate-spin` spinner), done-with-results (green filled ring + checkmark + count badge), done-empty (gray ring), error (red ✕)

### Conventions

- `INITIAL_SEARCHES` in `SearchContent.tsx` must stay in sync with the 14 keys emitted by `server/index.js`; the list is the source of display order
- When all searches complete, results are stored in `sessionStorage` under `kyb_preview_results` and `kyb_preview_input` (JSON), then the router pushes to `/report/preview` — Phase 1e reads these keys when `searchId === 'preview'`; Phase 1f replaces this with the database-backed flow
- `BuilderInput.acn`, `.tradingName`, and `.directors` are not captured in the Phase 1c search form; they default to `''` / `[]` in `SearchContent` and may be added to the form later without breaking this screen

---

## Phase 1e — Report screen (complete)

### Key files

- `web/app/report/[searchId]/page.tsx` — Server Component shell; wraps `ReportContent` in `<Suspense>`; `params.searchId` is passed as a prop (Next.js 14 — not async)
- `web/app/report/[searchId]/ReportContent.tsx` — `'use client'` component; reads `sessionStorage` for `searchId === 'preview'`; computes per-section risk levels; renders six-section report with sticky ToC
- `web/components/ReportSection.tsx` — `'use client'` section wrapper; collapsible on mobile (open by default); `resultsOverride` prop bypasses deriving results from `searchResults[].results`; `showJurisdiction` prop passes through to `ResultCard`
- `web/components/ResultCard.tsx` — `'use client'` expandable card; shows metadata table and source link when expanded; `showJurisdiction` badge rendered above title
- `web/components/RiskBadge.tsx` — pure presentational badge; `RiskLevel` type exported for use by other components; icon + label always shown together (never colour alone)

### Conventions

- **QBCC split**: The `qbcc` SearchResult carries both `licenceResults` (section 8.2) and `adjudicationResults` (section 8.4). `ReportContent` creates synthetic SearchResult descriptors for each sub-section and passes `resultsOverride` to `ReportSection` — do not use `qbcc.results` directly in sections 8.2 or 8.4.
- **Courts (8.5)**: A single synthetic `courtSearch` SearchResult provides the summary and one "Verify at AustLII" link; `resultsOverride={courtItems}` combines all 9 jurisdiction results; `showJurisdiction` shows the per-result jurisdiction badge.
- **Risk levels in Phase 1e**: Computed with a simple heuristic (`findings` if any results, `clear` if none, `unavailable` if all scrapers errored, `significant` if court hits ≥ 6). Superseded by the deterministic `riskGrouper` in Phase 2.
- **`/report/preview` route**: The empty `web/app/report/preview/` placeholder directory was removed; the `[searchId]` dynamic route now handles it cleanly.

---

## Phase 1f — Persona selection + email gate + report persistence + email delivery (complete)

### Key files

- `web/components/PersonaSelector.tsx` — four persona icon cards (2×2 grid); `onSelect: (persona: Persona) => void`; no async work — purely UI
- `web/components/EmailGate.tsx` — email input (required), AU state dropdown, project type dropdown, deep check checkbox; `onSubmit: (data: EmailGateData) => void`
- `web/lib/resend.ts` — Resend client singleton (same `globalThis` pattern as Prisma)
- `web/emails/ReportEmail.tsx` — React Email template; takes `entityName`, hit counts, `reportUrl`; rendered to HTML server-side in the save route
- `web/app/api/reports/save/route.ts` — `POST /api/reports/save`: persists `Search` row with `reportJson`, calls `riskGrouper()` synchronously and stores result in `Search.riskSummary`, sends report email via Resend
- `web/app/api/reports/[searchId]/route.ts` — `GET /api/reports/:searchId`: returns search + reportJson for `ReportContent` to consume

### Conventions

- **Pre-search wizard in `SearchContent`**: The component is a three-step wizard — `persona` → `email-gate` → search running. Persona is persisted to `localStorage` under `kyb_persona` so the selector is skipped on return visits. Steps are controlled by a `step: Step` state string.
- **Saving after stream**: When the NDJSON stream completes, `SearchContent` calls `POST /api/reports/save` and navigates to `/report/[searchId]`. If the save fails, it falls back to the existing `sessionStorage` + `/report/preview` path so the user still sees their report.
- **Email is best-effort**: The save route never fails the response due to an email send error — Resend failures are logged and swallowed.
- **`ReportContent` DB load**: For `searchId !== 'preview'`, `ReportContent` fetches `GET /api/reports/:searchId`, converts `reportJson` (`Record<string, SearchResult>`) to a `SearchResult[]`, and re-hydrates `BuilderInput` from `entityName` / `entityAbn`.
- **Anonymous searches**: `Search.userId` is `null` for all Phase 1f searches (no auth yet). Phase 3a wires the session userId in after NextAuth is added.
- **`RESEND_API_KEY` and `FROM_EMAIL`**: Must be set in `web/.env.local` for email delivery to work. The save route degrades gracefully if these are unset (email is skipped, report still saved).

---

## Phase 2 — Risk grouping engine + Risk Summary panel (complete)

### Key files

- `web/lib/riskGrouper.ts` — pure deterministic function `riskGrouper(findings: Record<string, SearchResult>): RiskGroupResult[]`; maps scraper output to five named risk groups (`INSOLVENCY`, `PAYMENT`, `LICENSING`, `LEGAL`, `CORPORATE`); no I/O, no randomness — same input always produces the same output
- `web/components/RiskSummaryPanel.tsx` — renders triggered risk groups with prescribed descriptions and source-linked trigger bullets; shows "No significant findings" fallback when no groups are triggered

### Conventions

- **Risk groups are the source of truth for risk level**: `riskGrouper` replaces the Phase 1e heuristic. Each `<ReportSection>` receives a `riskLevel` prop derived from whether any triggered group maps to that section.
- **`riskSummary` is frozen at save time**: The save route calls `riskGrouper()` synchronously on the raw `findings` map and stores the JSON in `Search.riskSummary`. `ReportContent` reads back this stored value for DB-backed reports — it never recomputes from the stored `reportJson`. This guarantees identical output across page loads for the same search.
- **Preview fallback**: For `searchId === 'preview'` (sessionStorage path), `riskGrouper` is called live in `ReportContent` since there is no DB row to read from.
- **`riskGrouper` input shape**: Accepts `Record<string, SearchResult>` keyed by the same 14 scraper keys used throughout the app. Missing keys are treated as no results (not errors).
- **Five risk group IDs**: `INSOLVENCY | PAYMENT | LICENSING | LEGAL | CORPORATE` — defined in `web/src/types/index.ts` as `RiskGroupId`. Each `RiskGroupResult` carries `id`, `label`, `description`, `triggered: boolean`, and `triggers: RiskGroupTrigger[]`.

---

## Phase 3a — Auth (NextAuth + registration) (complete)

### Key files

- `web/lib/auth.ts` — NextAuth config; exports `authOptions`; type-augments `Session` and `JWT` to expose `user.id` (string cuid matching `User.id` in Prisma). Session strategy is **JWT** — required because `CredentialsProvider` is incompatible with the database session strategy in next-auth v4.
- `web/app/api/auth/[...nextauth]/route.ts` — NextAuth catch-all; re-exports `GET` and `POST` from `NextAuth(authOptions)`
- `web/app/api/auth/register/route.ts` — `POST /api/auth/register`: hashes password with `bcrypt` (cost 12), creates `User` + `VerificationToken` (24 h expiry), sends `VerifyEmail` via Resend (best-effort)
- `web/app/auth/verify-email/page.tsx` — Server Component; validates token + email params, calls `prisma.$transaction` to set `emailVerified` and delete the token, then redirects to `/auth/login?verified=1`
- `web/app/auth/login/page.tsx` — `'use client'`; credentials form (`signIn('credentials', { redirect: false })`) + Google button (`signIn('google', ...)`); reads `?verified=1` and `?error=invalid-token` from search params (wrapped in `<Suspense>` for `useSearchParams`)
- `web/app/auth/register/page.tsx` — `'use client'`; posts to `/api/auth/register`; on success renders "check your inbox" confirmation in place
- `web/emails/VerifyEmail.tsx` — React Email template; same visual style as `ReportEmail`
- `web/components/NavBar.tsx` — `'use client'`; global nav rendered in root layout; uses `useSession()` to show email + **Sign out** (`signOut({ callbackUrl: '/' })`) when authenticated, or **Sign in** / **Register** links when not

### Conventions

- **Always import `authOptions` from `@/lib/auth`** when calling `getServerSession` in Route Handlers. Do not re-declare NextAuth config inline.
- **`getServerSession(authOptions)`** is the correct pattern for server-side session access in Next.js 14 App Router Route Handlers and Server Components. Do not use `getSession()` (client-only) on the server.
- **`Search.userId` is now set from the session** in `POST /api/reports/save`. Anonymous searches (unauthenticated) still produce `userId: null` — this is intentional and valid per the schema.
- **Email verification is required for credentials users** but not enforced at sign-in time in Phase 3a. Enforcement (blocking unverified logins) can be added in a later phase if needed.
- **Google sign-in auto-creates a `User` row** via the Prisma adapter (no `passwordHash`). These users have `emailVerified` set automatically by the adapter.

---

## Phase 3b — Account dashboard shell + Saved Reports tab (complete)

### Key files

- `web/app/account/layout.tsx` — Server Component; calls `getServerSession(authOptions)` and redirects unauthenticated users to `/auth/login?callbackUrl=/account/reports`; renders account header + `<AccountTabNav>` + `{children}`
- `web/app/account/page.tsx` — `redirect('/account/reports')`
- `web/app/account/reports/page.tsx` — Server Component; queries Prisma directly (no HTTP hop); accepts `?page=` search param; serialises `Date` → ISO string before passing to client components
- `web/app/api/user/searches/route.ts` — `GET /api/user/searches?page=&limit=`; 401 if unauthenticated; returns `{ searches, total, page, pageSize }`
- `web/components/AccountTabNav.tsx` — `'use client'`; uses `usePathname()` for active-tab highlighting; tabs: Reports | Watchlist | Monitoring | Alerts | Billing
- `web/components/ReportCard.tsx` — `'use client'`; derives overall risk level from stored `riskSummary` JSON (`significant` → `findings` → `clear` → `unavailable`); staleness badge appears when report age exceeds 30 days; Re-check / Share / PDF buttons are disabled stubs

### Conventions

- **Split Server/Client at the layout boundary**: `account/layout.tsx` is a Server Component for auth; `AccountTabNav` is extracted as a separate `'use client'` file because `usePathname()` is a hook and cannot be used in a Server Component.
- **Query Prisma directly in Server Component pages** rather than calling the internal API route — avoids an unnecessary HTTP round-trip on the server. The API route exists for future client-side use.
- **Serialise `Date` before passing to client components**: Prisma returns `Date` objects, which are not serialisable across the Server/Client boundary. Call `.toISOString()` in the Server Component before passing `createdAt` as a prop.
- **`riskSummary` is a JSON string of `RiskGroupResult[]`**: `riskGrouper` only pushes groups that have triggers, so any item in the parsed array is already triggered. Risk level is `significant` if any group has `severity === 'significant'`, `findings` if any groups exist, otherwise `clear`.
- **Staleness threshold is 30 days**: defined as a constant `STALE_DAYS = 30` in `ReportCard.tsx`. Re-check / Share / PDF buttons are stubs to be wired in Phases 3c and 7b.

---

## Phase 3c — PDF export + shareable links (complete)

### Key files

- `web/app/api/share/route.ts` — `POST /api/share`: requires session; verifies `Search.userId === session.user.id`; upserts `ShareableLink` with 30-day expiry (always sets `expiresAt` on update so re-sharing extends the window); returns `{ token, shareUrl, expiresAt }`
- `web/app/api/share/[token]/route.ts` — `GET /api/share/[token]`: no auth required; returns same shape as `GET /api/reports/:searchId` or 404 if token not found / expired
- `web/app/api/report/[searchId]/pdf/route.ts` — `GET /api/report/:id/pdf`: two auth paths — (1) session + ownership: extracts `next-auth.session-token` cookie and forwards it to Puppeteer, navigates to `/report/:id`; (2) `?shareToken=`: validates token, navigates to `/report/share/:token`; streams back `application/pdf`
- `web/app/report/share/[token]/page.tsx` — read-only report page; passes `shareToken` and `readOnly` props to `ReportContent`; no session required
- `web/components/ReportCard.tsx` — Share button calls `POST /api/share`, copies URL to clipboard, cycles through `idle → loading → copied → idle` states; PDF button is `<a download>` pointing to `/api/report/:id/pdf`

### Conventions

- **`POST /api/share` is the only writer of `ShareableLink` records**: the PDF route must never create share links as a side effect. For own-report PDFs, Puppeteer receives the caller's session cookie and navigates to `/report/:id` directly.
- **`ReportContent` accepts `shareToken?` and `readOnly?` props**: when `shareToken` is present the component fetches from `/api/share/:token` instead of `/api/reports/:id`; `readOnly=true` replaces the "← New search" nav link with a "Shared report" pill.
- **Share upsert always updates `expiresAt`**: `update: { expiresAt }` ensures a previously-created link is refreshed to a full 30-day window on every Share button click. Do not use `update: {}` in the share route.
- **PDF cookie forwarding**: check for `__Secure-next-auth.session-token` first (HTTPS/production), fall back to `next-auth.session-token` (HTTP/dev). Pass `domain` from `new URL(NEXTAUTH_URL).hostname`.
- **`puppeteer` is in `dependencies`** (not devDependencies) — it is used at runtime in the PDF API route.

---

## Phase 4a — File upload + R2 storage (complete)

### Key files

- `web/lib/r2.ts` — S3-compatible R2 client; exports `uploadToR2`, `deleteFromR2`, `getPresignedUrl`; uses `globalThis` singleton pattern (same as `db.ts` and `resend.ts`); reads `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_CONTRACTS` from env
- `web/app/api/upload/route.ts` — `POST /api/upload`: accepts `multipart/form-data` with a `file` field; validates MIME type (PDF/DOCX/JPG/PNG) and size (≤ 10 MB) server-side; stores object under `contracts/<uuid>.<ext>`; returns `{ r2Key, fileType, warning? }` where `warning` is set for image uploads
- `web/components/ContractUpload.tsx` — `'use client'` drag-and-drop zone; validates file type/size client-side before any network call; uses `XMLHttpRequest` (not `fetch`) for real upload progress via `xhr.upload.onprogress`; props: `onComplete(result: UploadResult)` and `onCancel()`
- `web/components/HomeSearch.tsx` — `'use client'` wrapper that owns the `'search' | 'upload'` view toggle; keeps `page.tsx` a pure Server Component

### Conventions

- **`page.tsx` stays a Server Component**: the `HomeSearch` wrapper owns all client-side state for the search/upload toggle; extracted following the same pattern as `SearchContent`, `ReportContent`, etc.
- **Client-side validation mirrors server-side**: `ContractUpload` rejects disallowed MIME types and files > 10 MB before sending — the API route enforces the same rules as a second line of defence.
- **Use `XMLHttpRequest` for file uploads** when upload progress is needed — `fetch` does not expose `upload.onprogress`.
- **`onComplete` is a Phase 4b hook**: `HomeSearch` currently receives the `UploadResult` but does nothing with it; Phase 4b wires it to `POST /api/extract` and the `ExtractionConfirmCard`.
- **R2 lifecycle**: Cloudflare R2 does not support per-object TTL via the S3 API. A bucket-level lifecycle rule (prefix `contracts/`, expire after 1 day) is the safety net; Phase 4b's extractor calls `deleteFromR2` immediately after extraction so objects rarely survive longer than seconds.
- **`R2_BUCKET_CONTRACTS` env var** (not `R2_BUCKET_NAME`) — matches the key already in `.env.local.example` and `.env.local`.

---

## Phase 4b — Claude extraction + confirmation card + clause opt-in (complete)

### Key files

- `web/lib/contractExtractor.ts` — `extractFromContract(r2Key, fileType): Promise<ContractExtraction>`; fetches file from R2 via presigned URL, sends PDF as a `document` block or image as a `vision` block to `claude-opus-4-7`, parses the JSON response; DOCX returns empty fields with `confidence: 'low'` (no native parse support)
- `web/app/api/extract/route.ts` — `POST /api/extract`: accepts `{ r2Key, fileType }`; calls `extractFromContract`; always calls `deleteFromR2` after extraction (both success and error paths); returns `ContractExtraction` JSON
- `web/components/ExtractionConfirmCard.tsx` — `'use client'`; editable controlled inputs for `builderName`, `abn`, `licenceNumber`; shows low-confidence warning banner when `confidence === 'low'`; clause opt-in checkbox (wired, marked "coming soon"); exports `ConfirmData` interface
- `web/components/HomeSearch.tsx` — extended from 2-state to 4-state view machine: `'search' | 'upload' | 'extracting' | 'confirm'`; on confirm navigates to `/search?companyName=...&abn=...&licenceNumber=...`
- `web/src/types/index.ts` — added `ContractExtraction` interface (`builderName`, `abn`, `licenceNumber`, `contractValue?`, `projectAddress?`, `confidence: 'high' | 'medium' | 'low'`)

### Conventions

- **Extraction lives in the Next.js app, not the Express server**: the spec placed this in `server/scrapers/contractExtractor.js` but the Express server has no `@anthropic-ai/sdk` or AWS SDK. Since the upload route is already a Next.js route and the web app has both packages, extraction follows the same pattern. Do not move it to the Express server without installing those dependencies there.
- **`DocumentBlockParam` is not in `@anthropic-ai/sdk` v0.29.0's union type**: the PDF `document` block is cast via `any` in `contractExtractor.ts`. This is intentional — the runtime supports it; the types do not. Do not attempt to type it as `Anthropic.MessageParam['content'][number]` directly.
- **R2 object is always deleted after extraction**: `deleteFromR2` is called unconditionally in `route.ts` — on success, and in the error path before returning 500. A `.catch(() => {})` on the success-path call ensures a delete failure never breaks the response.
- **DOCX is not supported for extraction**: `fileType === 'docx'` short-circuits and returns `{ confidence: 'low', builderName: '', abn: '', licenceNumber: '' }`. The low-confidence warning in `ExtractionConfirmCard` prompts the user to fill in fields manually.
- **`ANTHROPIC_API_KEY` is required in `web/.env.local`**: without it `new Anthropic()` has no credentials and extraction returns 500. The route degrades gracefully — the UI drops back to the manual search view with an error message.
- **Clause opt-in is wired but inert**: `wantClauseAnalysis` is captured in `ConfirmData` but not acted on in Phase 4b. It is available for Phase 4c to persist to `Search.contractExtracted` or trigger clause analysis.

---

## Phase 5 — Disambiguation (complete)

### Key files

- `web/components/DisambiguationCard.tsx` — `'use client'` list of ABR entity matches; each row shows name, formatted ABN, state, type, and active/inactive badge; "This one" button per row; "None of these — search anyway" escape hatch at the bottom; exports `EntityMatch` interface
- `server/scrapers/abn.js` — added `searchByName(companyName)` export; scrapes the ABR name-search table and returns up to 10 matches as `{ name, abn, type, state, status }`
- `web/components/SearchBar.tsx` — added `SearchFormData` export and optional `onSearch?: (data: SearchFormData) => void` prop; when provided, calls it instead of navigating directly so `HomeSearch` can intercept the submission

### Conventions

- **Disambiguation only runs on name-only searches**: `HomeSearch.handleSearch` checks `if (data.abn)` first and navigates immediately — no ABR round-trip. Only name-only submissions hit `POST /api/search/disambiguate`.
- **Disambiguation failure is non-fatal**: any network error in `handleSearch` falls through to a plain name search so the user is never stranded on the disambiguation spinner.
- **`HomeSearch` owns the disambiguation state, not `page.tsx`**: the spec listed `page.tsx` as the edit target, but `page.tsx` is a Server Component. The interactive logic lives in `HomeSearch.tsx` (the `'use client'` wrapper) — consistent with every prior phase.
- **`SearchBar` falls back to direct navigation when `onSearch` is not provided**: the prop is optional, preserving standalone usage of `SearchBar` without `HomeSearch`.
- **`SERVER_URL` is now exported from `web/lib/api.ts`**: client components that need to reach the Express server directly (e.g. `HomeSearch` calling `/api/search/disambiguate`) should import it from there rather than re-declaring the env-var chain.

---

## Phase 6a — ASIC scrapers: company search + disqualified directors (complete)

### Key files

- `server/scrapers/asic.js` — scrapes ASIC Connect (`SearchRegisters.jspx` + `orgDetails.jspx`); returns company status, ACN, type, registration date, registered office, charge count, and current directors; directors are returned as `ResultItem` entries alongside the company entry in `results[]`, marked with `metadata.Role = 'Director'`
- `server/scrapers/asicDisqualified.js` — for each director name, searches the ASIC Disqualified Persons Register (`searchType=DPNm`); returns matches as `ResultItem` entries with `status: 'Disqualified'`
- `web/components/ReportSection.tsx` — added optional `criticalBanner?: string` prop; renders a `bg-danger-bg text-danger` alert block at the top of the section body when set

### Conventions

- **`asicDisqualified` depends on `asic` via a shared promise**: in `server/index.js`, `asicPromise = searchASIC(...)` is created once before the searches array. The `asicDisqualified` entry's `fn` awaits that promise and extracts directors from it before checking the disqualified register. Both keys still stream independently via `Promise.all`.
- **Directors are `ResultItem` entries in `asic.results`, not a separate field**: each director row has `metadata.Role = 'Director'` and no `status` field. `ReportContent` splits on this marker (`filter(r => r.metadata?.Role !== 'Director')`) to separate the company item from director items before rendering. The `riskGrouper` CORPORATE check (`status.length > 0`) naturally skips director items.
- **`riskGrouper.ts` required no changes for Phase 6a**: CORPORATE and LICENSING triggers for `asic` and `asicDisqualified` were already written ahead of time.
- **Spec lists `page.tsx` as edited but change lives in `ReportContent.tsx`**: consistent with every prior phase — `page.tsx` is a Server Component shell; all report rendering is in `ReportContent.tsx`. Do not add scraper rendering directly to `page.tsx`.
- **ASIC Connect is a JSF application**: `asic.js` and `asicDisqualified.js` use GET requests with query parameters. If ASIC Connect returns an empty table (e.g. due to a ViewState requirement), both scrapers degrade gracefully to empty results — search still completes, report still renders, users can verify manually via the ASIC link in section 8.6.

---

## Phase 6b — ASIC insolvency notices + ATO tax debt (complete)

### Key files

- `server/scrapers/asicInsolvency.js` — scrapes `insolvencynotices.asic.gov.au` for external administration, winding-up, receiver, and liquidation notices; keyword-filters notice type text; tries table-row layout then card/article layout as a fallback; returns `category: 'financial'`
- `server/scrapers/atoDebt.js` — hits the same ASIC Published Notices register with `noticeType=ATP` query param and keyword-matches against ATO/tax-debt terminology; captures disclosed amounts where present
- `web/app/report/[searchId]/ReportContent.tsx` — extended section 8.3 to include `asicInsolvency` and `atoDebt`; `insolvencyItems` and `atoDebtItems` are prepended to `financialItems`; `criticalBanner` fires red for insolvency notices (priority) or ATO debt notices; `s83Risk` baseline now includes all four financial scrapers

### Conventions

- **Both scrapers are independent — no shared promise needed**: unlike `asicDisqualified` (which depends on `asic` via a shared promise), `asicInsolvency` and `atoDebt` run fully independently in `Promise.all`. They do not depend on ASIC Connect data.
- **`riskGrouper.ts` required no changes for Phase 6b**: INSOLVENCY group triggers for `asicInsolvency` and `atoDebt` were already written ahead of time (lines 69–87).
- **`criticalBanner` priority order in section 8.3**: insolvency notices take priority over ATO debt for the banner (insolvency implies immediate financial distress); ATO debt banner only shows when there are no insolvency notices. Both sets of results still appear in `financialItems`.
- **ASIC Published Notices HTML structure is uncertain**: `insolvencynotices.asic.gov.au` may render as a table or card/article layout depending on the page version. Both scrapers try table rows first, then fall back through a list of card selectors. If neither matches, results are empty and the report degrades gracefully — users can verify via the ASIC Published Notices link in section 8.6.
- **`s83Risk` baseline includes all four financial scrapers**: `isAllErrored` now checks `asicInsolvency`, `atoDebt`, `paymentTimes`, and `modernSlavery` together — the section is only `unavailable` if every one of them errors.

---

## Phase 6c — FWO + VIC BPC + WA Building & Energy scrapers (complete)

### Key files

- `server/scrapers/fwo.js` — searches FWO media releases for enforcement outcomes (wage underpayment, litigation, compliance notices); keyword-filters for enforcement content then name-matches to avoid false positives; returns `category: 'payment'`, `jurisdiction: 'Federal'`
- `server/scrapers/vicBpc.js` — fetches the VBA disciplinary proceedings register page and filters rows/cards matching the entity name; tries table layout first then card/paragraph fallback; returns `category: 'regulatory'`, `jurisdiction: 'VIC'`
- `server/scrapers/waBuildingEnergy.js` — searches WA Building and Energy media releases for enforcement actions; same defensive multi-selector pattern as other scrapers; returns `category: 'regulatory'`, `jurisdiction: 'WA'`
- `web/app/report/[searchId]/ReportContent.tsx` — section 8.5 renamed to "8.5 Courts, Enforcement & Disciplinary"; `fwoItems`, `vicBpcItems`, and `waBuildingEnergyItems` appended to `courtItems`; synthetic SearchResult objects for each new scraper passed in `searchResults` prop; `s85Risk` baseline extended to include all three new scraper statuses

### Conventions

- **`riskGrouper.ts` required no changes for Phase 6c**: PAYMENT trigger for `fwo` and LICENSING triggers for `vicBpc` and `waBuildingEnergy` were already written ahead of time (lines 173–247).
- **`page.tsx` was not edited**: consistent with all prior phases — all rendering changes go in `ReportContent.tsx`, not the Server Component shell.
- **All three scrapers are independent**: no shared promises needed; they run fully independently in `Promise.all`.
- **Each new `ResultItem` carries `jurisdiction`**: `fwo` items set `jurisdiction: 'Federal'`, `vicBpc` items set `'VIC'`, `waBuildingEnergy` items set `'WA'`. The existing `showJurisdiction` prop on section 8.5 renders jurisdiction badges without any component changes.
- **`nameMatchesEntity` guards all three scrapers**: FWO and WA B&E fetch name-search pages, VIC BPC fetches the full register. All three filter results client-side by requiring every significant word of the company name to appear in the result text — same approach as `modernSlavery.js` `isEntityMatch()`.
- **`s85Risk` baseline includes all three new scrapers**: `isAllErrored` now checks all `austliiResults` statuses plus `fwo`, `vicBpc`, and `waBuildingEnergy` — the section is only `unavailable` if every one of them errors.
- **`courtHits` in the entity card remains AustLII-only**: the stat label is "Court/tribunal"; FWO/VIC BPC/WA are enforcement actions, not court proceedings, so they are not folded into this count.

---

## Phase 7a — Stripe setup + PaymentIntent flow (complete)

### Key files

- `web/lib/stripe.ts` — Stripe server singleton (same `globalThis` pattern as `db.ts` / `resend.ts`); exports `getStripe()`, `PAYMENT_AMOUNTS` (AUD cents keyed by `PaymentType`), and `PAYMENT_LABELS`
- `web/app/api/payments/create-intent/route.ts` — `POST /api/payments/create-intent`: requires session; validates `paymentType` against `PAYMENT_AMOUNTS`; creates Stripe `PaymentIntent` in AUD with `userId` and `paymentType` in metadata; records `Payment` row immediately; returns `{ clientSecret }`
- `web/app/api/payments/webhook/route.ts` — `POST /api/payments/webhook`: reads raw body via `req.text()` for Stripe signature verification; on `payment_intent.succeeded` upserts `PackBalance` — RECHECK types increment `freeChecks`, DEEP_CHECK types increment `deepChecks`; returns 500 on DB failure so Stripe retries
- `web/components/PaymentModal.tsx` — `'use client'` overlay; fetches `clientSecret` from `create-intent` on mount; renders Stripe `<Elements>` + `<PaymentElement>`; calls `stripe.confirmPayment({ redirect: 'if_required' })` (no redirect for card payments); calls `onSuccess()` on completion

### Conventions

- **`MONITORING_MONTHLY` is excluded from `PAYMENT_AMOUNTS`**: it is a Stripe Subscription, not a one-time PaymentIntent. The `create-intent` route rejects it with a 400.
- **Webhook uses `req.text()`, not `req.json()`**: Stripe signature verification requires the raw request body. `export const dynamic = 'force-dynamic'` prevents Next.js from caching the route.
- **Webhook returns 500 on DB failure**: this signals Stripe to retry delivery. Non-DB errors (e.g. unhandled event types) return 200 `{ received: true }` so Stripe does not retry unnecessarily.
- **`Payment` row is written in `create-intent`, not the webhook**: the row is created immediately when the PaymentIntent is created (the Stripe PI id is the stable key). The webhook only credits `PackBalance` — it does not create or update the `Payment` row.
- **`PackBalance` is upserted, never inserted**: a user may not have a `PackBalance` row yet; `upsert` with `create` handles the first purchase. Subsequent purchases use `{ increment: N }` to avoid race conditions.
- **Stripe CLI keys**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are now populated in `web/.env.local` with test-mode keys for account `acct_1TZ8MxDYgwiOmgz5`. Keys expire 2026-08-18. Run `~/bin/stripe listen --forward-to localhost:3000/api/payments/webhook` to relay test webhooks.

---

## Phase 7b — Re-check gate + pack balance display (complete)

### Key files

- `web/app/api/payments/pack-balance/route.ts` — `GET ?entityAbn=&entityName=` returns `{ freeChecks, deepChecks, isRecheck }`; unauthenticated callers receive zeros with no gating; ABN is the primary match key, entity name is the fallback
- `web/app/api/reports/save/route.ts` — extended with a re-check entitlement block: for authenticated users with a prior search on the same entity, atomically decrements one `freeCheck` via `updateMany` with `freeChecks: { gt: 0 }` condition; returns `402 { error: 'recheck_required', recheckPrice: 300 }` if balance is zero
- `web/components/EmailGate.tsx` — accepts `isRecheck?: boolean` and `freeChecks?: number` props; shows credit count banner when credits available; shows "$3.00 per re-check" notice and changes CTA to "Pay $3.00 and re-check →" when no credits; renders `PaymentModal(RECHECK_SINGLE)` inline, calls `onSubmit` only after payment success
- `web/app/search/SearchContent.tsx` — fetches `/api/payments/pack-balance` in a `useEffect` keyed on `step === 'email-gate'`; passes `isRecheck` and `freeChecks` to `EmailGate`; if `save` returns 402 (webhook race condition), falls back to sessionStorage preview rather than crashing
- `web/components/ReportCard.tsx` — Re-check button is now active; with `freeChecks > 0` navigates directly to `/search?...`; with `freeChecks === 0` opens `PaymentModal(RECHECK_SINGLE)` inline and navigates after payment success; displays credit count in button label
- `web/app/account/reports/page.tsx` — fetches `PackBalance` in the same `Promise.all` as the search list; renders a green credit count line in the page header; passes `freeChecks` to each `ReportCard`

### Conventions

- **`isRecheck` is derived server-side, not client-side**: the `pack-balance` route queries `Search` for a prior row with the same `userId` + `entityAbn` (or `entityName` as fallback). The client never computes this itself — it only reads the flag from the API response.
- **ABN takes priority over name for re-check matching**: using name alone risks false positives (two unrelated companies with similar names). If `entityAbn` is present in the query params, only ABN is used for the prior-search lookup in both `pack-balance` and `save` routes.
- **`updateMany` with `gt: 0` is the atomic decrement pattern**: using `updateMany` instead of a transaction avoids a separate `findUnique` + `update` round-trip. The returned `count` tells whether any row was actually decremented — `count === 0` means no balance was available.
- **402 from `save` falls back to preview, not an error screen**: a 402 means the Stripe webhook hasn't fired yet (race condition). The user still sees their report via the sessionStorage preview path — the report is not lost, just not DB-persisted.
- **`PaymentModal` is imported into both `EmailGate` and `ReportCard`**: both are `'use client'` components. Import `type { PaymentType }` is not needed — Prisma 5 generates string literal union types, so passing `'RECHECK_SINGLE'` as `paymentType` is directly assignable without a cast.
- **Pack balance display is read-only in the reports page header**: `freeChecks` is fetched server-side in the Server Component and rendered as a static green line. The `ReportCard` receives it as a prop — no client-side fetching in the card itself.

---

## Phase 7c — Deep check scrapers (partially complete)

### Key files

- `server/scrapers/asicExtract.js` — searches ASIC Connect's officer-by-name register (`searchType=OfficerPersonNm`) for each director; returns companies they are/were associated with (name, ACN, role, status); up to 4 directors, 15 companies per director, deduplicated by ACN; only runs when `isDeepCheck: true`
- `server/scrapers/afsaNpii.js` — fetches the AFSA NPII search page to capture the JSF `ViewState`, then POSTs a debtor-name search for each director (surname + given names split from full name); parses two known table layouts defensively; up to 5 directors; only runs when `isDeepCheck: true`
- `server/index.js` — reads `isDeepCheck` from the POST body; conditionally appends `asicExtract` and `afsaNpii` to the searches array after all base scrapers; both reuse `asicPromise` for director names (same pattern as `asicDisqualified`)
- `web/lib/api.ts` — `runDueDiligence` accepts optional third argument `options?: { isDeepCheck?: boolean }`; merges `isDeepCheck` into the POST body alongside `BuilderInput`
- `web/app/search/SearchContent.tsx` — defines `DEEP_CHECK_SEARCHES` (two entries); when `gate.isDeepCheck`, inserts them before `links` and marks all rows `searching`; `total` now uses `searches.length` (not the constant `INITIAL_SEARCHES.length`) so the progress bar is accurate for deep check runs
- `web/app/report/[searchId]/ReportContent.tsx` — `asicExtract` results appended to `identityItems` in section 8.1; `afsaNpii` results prepended to `financialItems` in section 8.3; both rendered via nullable synthetic `SearchResult` objects (`asicExtractSearch`, `afsaNpiiSearch`) that are only added to `searchResults` props when the key exists in results (i.e. was a deep check run); section risk baselines include the new scraper statuses

### Conventions

- **Deep check scrapers are appended after the base searches array is defined**: `isDeepCheck` is read from the request body, then `searches.push(...)` is called conditionally. This keeps the base searches array clean and avoids conditional entries mid-array.
- **Both deep check scrapers share `asicPromise`**: they await the existing ASIC Connect result to extract director names, avoiding a second HTTP round-trip to ASIC. Same pattern as `asicDisqualified`.
- **Nullable synthetic SearchResult pattern for optional scrapers**: `asicExtractSearch` and `afsaNpiiSearch` are typed `SearchResult | null`. The `searchResults` prop uses `.filter(Boolean) as SearchResult[]` to exclude them on non-deep reports — no ghost rows or undefined handling needed downstream.
- **`total` must use `searches.length`, not `INITIAL_SEARCHES.length`**: the progress bar denominator is the live state array, not the constant, so deep check runs (which have 2 extra rows) show accurate progress.

### ⚠️ Incomplete — requires paid ASIC Data API key

The spec calls for `asicExtract` to return the **full historical director list** (including resigned/former directors of the target company) and the **charges register** for the target company. These are not implemented:

- **What is implemented**: companies that current directors are associated with (for phoenix-risk detection). This correctly feeds the riskGrouper CORPORATE/INSOLVENCY triggers and the `ReportContent` section 8.1 display.
- **What is missing**: resigned/former directors of the target entity itself; per-charge detail from the charges register (only the count is available from the regular `asic.js` scrape).
- **Why**: ASIC Connect's public website does not expose historical officer records without session/ViewState complexity. The paid ASIC Data API at `data.asic.gov.au` provides clean endpoints for both.
- **To complete**: set `ASIC_DATA_API_KEY` in `server/.env`, then in `asicExtract.js` add a branch at the top of `searchAsicExtract()`:
  ```js
  const apiKey = process.env.ASIC_DATA_API_KEY;
  if (apiKey && acn) return searchViaDataApi(acn, apiKey);
  // existing ASIC Connect officer search falls through as the fallback
  ```
  The `searchViaDataApi` function should call `GET https://data.asic.gov.au/api/v1/companies/{acn}/officers?includeFormer=true` and `GET .../charges` and map the responses to the same `ResultItem` shape. The rest of the pipeline (riskGrouper, ReportContent) requires no changes.
