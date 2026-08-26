# Server Scrapers

Each scraper is an async module that returns a standard shape:

```js
{
  source: string,          // human-readable source name
  jurisdiction: string,    // e.g. 'Federal', 'QLD'
  category: string,        // e.g. 'identity', 'legal', 'compliance'
  results: ResultItem[],   // zero or more result items
  searchUrl: string,       // direct URL users can click to verify manually
  summary: string,         // one-line status description for the report
}
```

Scrapers are run in parallel by `server/index.js` via `Promise.all`. A failing
scraper never stops others — errors are caught per-scraper and surface as
`{ status: 'error' }` in the NDJSON stream.

---

## Section 8.1 — ASIC Disqualified Persons Register (`asicDisqualified.js`)

### Problem

ASIC Connect (`connectonline.asic.gov.au`) uses **reCAPTCHA v2 invisible** (site
key `6LdfxBoUAAAAAO7ItWGgMWT32_h5T_TtD4F1MflL`) to gate ALL search result XHRs.
The previous implementation used a plain `axios.get` which always received the
ADF loopback bootstrap page instead of results, silently returning empty results
even when directors were on the disqualified register.

### Solution

The fix integrates [2captcha](https://2captcha.com) (~$0.003/solve) to obtain a
valid reCAPTCHA token that is then injected into the page via Puppeteer.

**Flow:**

1. `server/index.js` passes `process.env.CAPTCHA_API_KEY` to `searchASICDisqualified`.
2. `searchASICDisqualified` calls `fetchAdfPageWithCaptcha(url, captchaApiKey)` from `browser.js`.
3. `fetchAdfPageWithCaptcha` navigates Puppeteer to the ASIC Connect search page,
   waits 3s for the ADF framework and reCAPTCHA widget to initialise, then calls
   `solveCaptcha(pageUrl, captchaApiKey)` from `captcha.js`.
4. `solveCaptcha` submits an invisible reCAPTCHA task to 2captcha's REST API,
   polls every 5s (max 120s), and returns the token string.
5. `fetchAdfPageWithCaptcha` injects the token:
   - Sets `document.getElementById('g-recaptcha-response').value = token`
   - Calls `window.isExtRecaptchaSuccessful?.(token)` — the ADF callback that
     re-queues the search POST with the valid `g-recaptcha-response` header.
6. Waits for `table tbody tr` selector (results table) with 25s timeout, then
   a network-idle settle, then returns `page.content()`.
7. Cheerio parses the HTML; matching rows (by director name) become `ResultItem`s.

**Graceful degradation:**

- If `CAPTCHA_API_KEY` is not set, the scraper returns an empty result with
  `summary: "N director(s) — automated check unavailable, verify manually via ASIC Connect"` and a working `searchUrl` link so users can check manually.
- Individual `checkDirector` errors are caught and return empty (non-fatal).
- Up to 6 directors are checked in parallel via `Promise.all` — reduces total
  latency from sequential minutes to ~20–30s (limited by slowest 2captcha solve).

### Configuration

Set in `server/.env` and Railway dashboard:

```
CAPTCHA_API_KEY=<your 2captcha key>
```

### Why tests matter here

`parseDisqualifiedResults` is a pure function (HTML string → results array) and
is fully unit-testable without any I/O. Tests cover:
- Positive match, case-insensitive match, name mismatch, empty table
- Missing expiry date (falls back to order date in the `date` field)
- Missing reason (falls back to default description)
- Graceful degradation path (no API key)

`captcha.js` uses dependency-injected `_http` (defaults to `axios`) so tests
control the full request/response cycle without network access. Tests cover:
- Token returned on first poll
- Multiple polls before ready
- Submission failure
- Poll error code
- Network error
- SITE_KEY constant correctness

### Running tests

```bash
cd server && npm test
```

Uses Node.js built-in `node:test` runner — no extra dependencies required.

---

## Other scrapers of note

| File | Section | Key constraint |
|---|---|---|
| `asic.js` | 8.3 | reCAPTCHA blocked; falls back to ASIC_DATA_API_KEY if set |
| `asicExtract.js` | deep-check | reCAPTCHA blocked; falls back to ASIC_DATA_API_KEY if set |
| `asicDisqualified.js` | 8.1 | reCAPTCHA blocked; uses 2captcha (CAPTCHA_API_KEY) |
| `asicInsolvency.js` | 8.5 | ASIC Published Notices — no reCAPTCHA |
| `courtRecords.js` | 8.5 | Called 9× (one per jurisdiction); `nsw`/`act`/`federal`/`nt` have real live searches, the other 5 (`qld`/`vic`/`wa`/`sa`/`tas`) return an honest manual-link fallback, see known limitation below |
| `fwo.js` | 8.5 | FWO newsroom only — enforcement outcomes, not FWC tribunal decisions |
| `links.js` | — | Not a scraper — returns pre-populated deep-link URLs |

`nameMatchesEntity` / `isEntityMatch` guards prevent false positives in
`modernSlavery.js`, `fwo.js`, `vicBpc.js`, and `waBuildingEnergy.js`.

---

## Known limitations and future upgrades

### Section 8.5 — 4 of 9 court-records jurisdictions are live (2026-08-26)

`austlii.js` was retired 2026-08-26 (AustLII enforces a hard Cloudflare IP block against
this server — deliberate policy enforcement, see CLAUDE.md). Its replacement,
`courtRecords.js`, now has a real full-text search for four jurisdictions:

- **NSW** (NSW Caselaw) and **ACT** (courts.act.gov.au's own judgment search,
  `?query=<term>`) — plain `axios`/`cheerio`, neither is behind a Cloudflare gate.
- **Federal** (a dedicated Funnelback search at
  `search.judgments.fedcourt.gov.au/s/search.html`, distinct from the site's general
  search) and **NT** (`supremecourt.nt.gov.au`'s sitewide search, which does index
  judgment documents) — both behind a Cloudflare **managed challenge** covering their
  whole domain, so both go through `fetchWithBrowser` (`browser.js`). Confirmed by direct
  test: a Cloudflare-cleared session's cookies do **not** work for a subsequent plain
  HTTP request (the gate is fingerprint-based, not cookie-based) — there is no cheaper
  path than a real Puppeteer round-trip per request for these two. Accepted as a known
  cost rather than mitigated (e.g. via deep-check gating or ScraperAPI's render mode) —
  this adds to the existing "Puppeteer-dependent scrapers systemically starved under
  load" issue in CLAUDE.md, a separate, already-tracked problem this doesn't try to fix.

The remaining 5 (`qld`, `vic`, `wa`, `sa`, `tas`) return an honest `status: 'error'`
result with a manual search link — surfaced in `ReportContent.tsx` via `ReportSection`'s
`supplementalLinks` prop — rather than a fabricated "checked, clean".

Federal Court coverage also closes the Commonwealth Corporations Act gap directly — its
judgments search returns Corporations Act / insolvency matters (deeds of company
arrangement, winding-up applications, etc.) alongside general litigation, confirmed via
a live test result: *Bunter v Hardy, in the matter of FT Sydney Pty Ltd (subject to a
deed of company arrangement)* [2026] FCA 742/701.

**Upgrade path for the remaining 5** (see CLAUDE.md for the per-jurisdiction
reachability notes from the investigation that produced `courtRecords.js`):
1. **WA, VIC** — WA's real archive is on eCourts Portal (looks like a JS app, needs live
   investigation); VIC's coverage is fragmented across separate Supreme Court/County
   Court/VCAT sites rather than one database.
2. **SA, QLD, TAS** — confirmed no viable free full-text search exists (SA's judgments
   page has no search, just a JS-rendered "recent" widget; QLD's real platforms are
   either ToS-restricted — Queensland Judgments explicitly bans automated access — or
   unreliable; TAS's own Supreme Court doesn't publish judgments on its website at all).
   These likely stay manual-link-only unless a paid source (e.g. vLex) is pursued.

Each new jurisdiction should follow the same shape as the existing live searches in
`courtRecords.js` — a `fetch<Jurisdiction>TermResults` built with `makeTermCache`, plus a
thin wrapper calling the shared `runJurisdictionSearch` — and replace one
`buildManualFallback(jurisdiction)` call in `searchCourtRecords`'s dispatch with the real
implementation. No other wiring changes needed (the `courts_<jurisdiction>` key, frontend
labels, and `supplementalLinks` fallback all already exist and just stop being used once
a jurisdiction goes live).

### NSW Caselaw has the same page-1-only limitation as Federal Court did (2026-08-26)

Found while fixing the BHP false-negative below: NSW Caselaw also only returns page 1 of
20 results per term, with no larger-page-size override found (unlike Federal's
`num_ranks` param) — its pagination is a `pagenumber` param, meaning genuinely separate
requests to get more coverage, not a one-line fix. Confirmed live: "BHP" returns 1,897
total NSW Caselaw hits, capped at 20 per request. Not yet fixed — a heavily-litigated
entity's real NSW cases can be pushed off the first page the same way BHP's Federal
Court cases were. If this needs fixing, it means paginating `fetchNswTermResults`
(multiple sequential requests per term, each cheap — plain axios, no Cloudflare gate —
but still N× the HTTP calls) rather than a single param change.

### BHP false negative on Federal Court — root cause and fix (2026-08-26)

A production search for "BHP GROUP LIMITED" returned "no cases found" for Federal Court
despite BHP having a large Federal Court history. Two compounding bugs, both in
`courtRecords.js`:

1. **`titleMatchesTerm`'s word-length threshold was too strict.** "BHP Group Limited"
   strips to "BHP Group" (`stripCompanySuffix`); "Group" is itself a `COMMON_WORDS`
   entry, and "BHP" (3 chars) failed the old `length > 3` threshold — leaving zero
   distinctive words, which falls through to "can't filter, let everything through."
   That's a *different* bug (unfiltered noise) than the reported one, but it's the same
   root cause: short/generic company names had no working entity filter at all. Fixed by
   lowering the threshold to `length > 2`.
2. **Federal Court's default page size (20) isn't remotely enough for a high-volume
   entity.** Confirmed live: "BHP" returns 1,514 total Federal Court hits, genuinely
   sorted by relevance (not a sort-order bug — verified the `sort` dropdown defaults to
   "Relevance" when omitted), but *none* of the top 20 have "BHP" in the case title —
   real matches (e.g. *Impiombato v BHP Group Limited (No 6)* [2025] FCA 1594) only
   surface once the window widens. Fixed by adding `num_ranks=100` to
   `fetchFederalTermResults`'s search URL (Funnelback's page-size param). 100 is a
   pragmatic ceiling, not a proven-sufficient one for every entity — BHP likely still has
   real cases beyond position 100 — but multi-page pagination would mean multiple
   Puppeteer round-trips per search term, adding real cost to the concurrency problem
   already documented above. A regression test (`test-court-records.js` Step 1b) guards
   against either fix silently reverting.

Also silently masking failures until this fix: `runJurisdictionSearch`'s per-term error
handling caught every fetch failure and returned an empty array with no signal — a
Cloudflare-challenge timeout or Puppeteer page-slot contention failure was
indistinguishable from an honest "no cases found." Now retries once per term, and if
every term still fails, returns `status: 'error'` (same shape as `buildManualFallback`)
instead of a fabricated clean result.
