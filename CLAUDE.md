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
