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
| `austlii.js` | 8.5 | Called 9× (one per jurisdiction) |
| `links.js` | — | Not a scraper — returns pre-populated deep-link URLs |

`nameMatchesEntity` / `isEntityMatch` guards prevent false positives in
`modernSlavery.js`, `fwo.js`, `vicBpc.js`, and `waBuildingEnergy.js`.
