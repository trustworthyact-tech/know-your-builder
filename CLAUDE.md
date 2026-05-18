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

- `web/app/page.tsx` — React Server Component (no `'use client'`); delegates all interactivity to `<SearchBar />`; includes a stub "upload contract" button (not yet wired)
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
