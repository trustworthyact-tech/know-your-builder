# Register Accuracy Tests

Tests that verify ASIC and licence register scrapers return accurate positive
results when a known disqualified or disciplined entity is searched.

Each test is **self-verifying**: it discovers a live fixture from the target
register before calling the scraper, so it never relies on stale hardcoded data.

---

## Test inventory

### Scraper integration tests (have automated scrapers)

| File | Register | Browser needed | API key needed | Typical run time |
|------|----------|----------------|----------------|------------------|
| `test-asic-disqualified-parser.js` | ASIC DPN | No | No | < 5s |
| `test-asic-disqualified-live.js` | ASIC DPN | Yes (Puppeteer) | CAPTCHA_API_KEY | ~60–90s |
| `test-qbcc-excluded.js` | QBCC Excluded | Yes (Puppeteer) | No | ~3–5 min |
| `test-vicbpc.js` | VBA Disciplinary | Yes (Puppeteer) | No | ~30–60s |
| `test-wa-building.js` | WA B&E Enforcement | No | No | ~20–30s |

### Licence register probe tests (link-only — no scraper yet)

These tests verify that the licence check register URL is accessible, that
searching by name returns results, and that a discovered entity can be found
again by re-searching. They also document the HTML selector needed to build
a scraper. Each test has 3 steps: reachability → parse → re-search.

| File | Register | Last run result (2026-06-11) |
|------|----------|------------------------------|
| `test-nsw-fairtrading-licence.js` | NSW Fair Trading | FAIL — old domain defunct (URL updated in links.js) |
| `test-vic-vba-licence.js` | VBA Licence Check | FAIL — `/check/licence` path removed (URL updated) |
| `test-wa-be-licence.js` | WA B&E Licence | FAIL — search result is JS-rendered antibot page |
| `test-sa-cbs-licence.js` | SA CBS Licence | FAIL — page requires JavaScript (CBS blocks bots) |
| `test-nt-building-licence.js` | NT Building Practitioners | FAIL — `buildinglicences.nt.gov.au` DNS gone |
| `test-act-licence.js` | ACT Access Canberra | FAIL — path removed, portal restructured |
| `test-tas-cbos-licence.js` | TAS CBOS Licence | FAIL — path removed, OLAS portal unavailable |

**Key finding (2026-06-11):** All 7 licence check URLs in `server/scrapers/links.js` were stale.
URLs have been updated to the best available landing pages; deep-link search parameters
are not yet functional for any of them. These registers likely require browser automation
(Puppeteer) or POST-based form interaction to return search results. They are currently
manual-lookup only in the app.

---

## Quick start

```bash
# From repo root — runs all tests except the CAPTCHA-dependent live ASIC test:
bash server/tests/run-all.sh

# With verbose output for all tests (including passing ones):
VERBOSE=1 bash server/tests/run-all.sh

# Run an individual test:
node server/tests/test-asic-disqualified-parser.js
node server/tests/test-wa-building.js

# Run ASIC live test (needs 2captcha key from server/.env):
CAPTCHA_API_KEY=xxx node server/tests/test-asic-disqualified-live.js

# Supply a known fixture name to skip auto-discovery:
node server/tests/test-vicbpc.js --name "Richard Jones"
node server/tests/test-wa-building.js --name "John Smith"
CAPTCHA_API_KEY=xxx node server/tests/test-asic-disqualified-live.js --name "John Smith"
```

All scripts must be run from **repo root** (or from `server/` — paths are resolved
relative to `__dirname`).

---

## Two-phase test structure

Every live test follows this pattern so failures are immediately localised:

**Phase 1 — fixture discovery**
Fetches the target register directly (axios or Puppeteer) and extracts the name
of the first matching entity. This proves the register is accessible and gives
us a known-good fixture.

**Phase 2 — scraper assertion**
Calls the production scraper function with the discovered fixture. Verifies the
same entity appears in the returned results.

If Phase 1 passes but Phase 2 fails, the scraper is broken — not the register.

---

## Handing tests to a sub-agent

Each test is designed to be run by an **independent sub-agent** with no
conversation history. Copy the relevant prompt below verbatim.

All sub-agent prompts share this structure:
1. Run the test and report full output
2. If it fails, read the relevant scraper file and identify the specific line
3. Propose a minimal fix
4. Re-run to confirm

The tests can be given to sub-agents concurrently — they have no shared state.

---

### Sub-agent prompt: ASIC DPN parser (no env vars needed)

```
Working directory: /Users/jameskwan/know-your-builder

Run this test (from repo root):
  node server/tests/test-asic-disqualified-parser.js

This tests the HTML parser in server/scrapers/asicDisqualified.js with
synthetic ASIC Connect DPN table HTML. No network or CAPTCHA required.

After running, report:
1. Full console output (verbatim)
2. Overall PASS / FAIL
3. If FAIL: read server/scrapers/asicDisqualified.js (specifically
   parseDisqualifiedResults and isNameMatch) and identify the exact line(s)
   causing the failure. Propose a targeted code fix. Re-run to confirm.
4. Do NOT modify other files or scrapers.
```

---

### Sub-agent prompt: VIC BPC disciplinary register (no env vars needed)

```
Working directory: /Users/jameskwan/know-your-builder

Run this test (from repo root):
  node server/tests/test-vicbpc.js

This test:
  Step 1 — fetches VBA prosecution register HTML with axios (no browser)
  Step 2 — extracts first accordion entry as fixture
  Step 3 — calls searchVicBpc(fixtureName, "", [fixtureName]) via Puppeteer
  Step 4 — verifies the fixture appears in results

After running, report:
1. Full console output (verbatim)
2. Overall PASS / FAIL
3. If any step fails, read server/scrapers/vicBpc.js and server/scrapers/browser.js
   and identify the specific line causing the failure.
   - Step 1 fail: page structure changed (accordion selector)
   - Step 3 fail: browser automation broken (#listjs-search selector or Cloudflare)
   - Step 4 fail: nameMatchesEntity filter too strict
   Propose a minimal targeted fix. Re-run to confirm.
4. Do NOT modify test files.
```

---

### Sub-agent prompt: WA Building and Energy enforcement (no env vars needed)

```
Working directory: /Users/jameskwan/know-your-builder

Run this test (from repo root):
  node server/tests/test-wa-building.js

This test:
  Step 1 — fetches WA B&E enforcement media releases with axios
  Step 2 — extracts entity name from first enforcement article
  Step 3 — calls searchWABuildingEnergy(entityName, "", [])
  Step 4 — verifies the entity appears in results

After running, report:
1. Full console output (verbatim)
2. Overall PASS / FAIL
3. If any step fails, read server/scrapers/waBuildingEnergy.js and identify the
   specific cause:
   - Step 1 fail: article selector changed in parseResults
   - Step 3 fail: selector mismatch between raw fetch and scraper fetch path
   - Step 4 fail: nameMatchesEntity significant-word filter is excluding the entity
   Propose a targeted fix. Re-run to confirm.
4. Do NOT modify test files.
```

---

### Sub-agent prompt: QBCC excluded individual register (Puppeteer, no API key)

```
Working directory: /Users/jameskwan/know-your-builder

Run this test (from repo root):
  node server/tests/test-qbcc-excluded.js

This test:
  Step 1 — loads the QBCC excluded individual register SPA via Puppeteer and
           searches for common surnames to discover a live fixture
  Step 2 — calls searchQBCC("__test__", "", [fixtureName])
  Step 3 — verifies the fixture appears in enforcementResults

This test takes 3–5 minutes (Salesforce SPA requires browser automation).

After running, report:
1. Full console output (verbatim)
2. Overall PASS / FAIL
3. If any step fails, read server/scrapers/qbcc.js (specifically searchQBCCExcluded
   and parseExcludedResults) and server/scrapers/browser.js and identify the cause:
   - Step 1 fail: SPA not loading or shadow DOM selectors changed
   - Step 2 fail: scraper's SPA interaction is failing silently
   - Step 3 fail: parseExcludedResults not detecting the "name\nIndividual Info" blocks
   Propose a targeted fix. Re-run to confirm.
4. Do NOT modify test files.
```

---

### Sub-agent prompt: ASIC DPN live test (needs CAPTCHA_API_KEY)

```
Working directory: /Users/jameskwan/know-your-builder

First, read CAPTCHA_API_KEY from server/.env and export it:
  export CAPTCHA_API_KEY=$(grep CAPTCHA_API_KEY server/.env | cut -d= -f2)

Run this test:
  node server/tests/test-asic-disqualified-live.js

This test:
  Step 1 — fetches ASIC media releases to discover a recently disqualified director
  Step 2 — calls searchASICDisqualified([directorName], captchaKey) via Puppeteer
  Step 3 — verifies the director appears in results

Allow 60–90 seconds for CAPTCHA solving and ADF form submission.

After running, report:
1. Full console output (verbatim)
2. Overall PASS / FAIL
3. If any step fails, read server/scrapers/asicDisqualified.js and
   server/scrapers/browser.js (fetchAdfDpnSearch) and identify the cause:
   - Step 1 fail: ASIC news page structure changed (fixture discovery regex)
   - Step 2 fail and "0 results": CAPTCHA solve failed, ADF POST not intercepted,
     or HTML parsing broke (also run test-asic-disqualified-parser.js to isolate)
   - Step 3 fail: name mismatch (isNameMatch / hidden span ordering)
   Propose a targeted fix. Re-run to confirm.
4. Do NOT modify test files.
```

---

### Sub-agent prompts: licence register probe tests

These 7 tests are **probe tests** — there are no scrapers to call yet.
Each test has 3 steps: reachability → parse results → re-search with fixture.

All 7 currently FAIL because the URLs in `links.js` were stale (verified
2026-06-11). The prompt below is the template for re-running any of them
after a URL is updated or a scraper is added.

```
Working directory: /Users/jameskwan/know-your-builder

Run this test (from repo root):
  node server/tests/<TEST_FILE>

Context: This is a probe test for a licence register that has no automated
scraper yet. The test verifies:
  Step 1 — the register URL is reachable
  Step 2 — a search by name returns parseable results
  Step 3 — re-searching with the discovered entity name returns it again

The test currently FAILS because the URL in server/scrapers/links.js was
stale. The URL has been updated to the best available landing page as of
2026-06-11, but the search endpoint or parameter may still be wrong.

After running, report:
1. Full console output (verbatim)
2. Step where it fails and why
3. If Step 1 fails: the URL is still wrong or the site blocks bots.
   Browse to the URL manually in a browser and find the correct URL or
   confirm it requires JavaScript. Update links.js accordingly.
4. If Step 2 fails: parse the raw HTML snippet in the error output and
   identify the correct CSS selector for the result rows. Update the
   extractNames function in the test file if needed, then re-run.
5. If Step 3 fails: document the search parameter name and URL pattern
   that works, for future scraper development.
6. Do NOT write a scraper — just probe and document.
```

**Test files for each jurisdiction:**

| File | Register | Status |
|------|----------|--------|
| `test-nsw-fairtrading-licence.js` | NSW Fair Trading | FAIL — domain defunct |
| `test-vic-vba-licence.js` | VIC VBA Licence | FAIL — path changed |
| `test-wa-be-licence.js` | WA B&E Licence | FAIL — JS antibot |
| `test-sa-cbs-licence.js` | SA CBS Licence | FAIL — requires JS |
| `test-nt-building-licence.js` | NT Building Practitioners | FAIL — DNS gone |
| `test-act-licence.js` | ACT Access Canberra | FAIL — path removed |
| `test-tas-cbos-licence.js` | TAS CBOS Licence | FAIL — path removed |

---

## Common failure patterns and fixes

### VIC BPC — `#listjs-search` not found
The VBA renamed or removed the List.js search input. Check the current selector
by fetching the page in a browser and inspecting the search input element, then
update `inputSelector` in the `searchVicBpc` call inside `vicBpc.js`.

### ASIC DPN — 0 results after successful CAPTCHA
Most likely the ADF POST interception in `fetchAdfDpnSearch` (browser.js) is not
injecting the form fields correctly. Check that `DPN_F_SURNAME` and
`DPN_F_FIRSTNAME` still match the ADF component IDs by opening the DPN page in a
browser with DevTools and observing the XHR POST body when the Go button is clicked.

### QBCC excluded — SPA search returns no results
The Salesforce LWC DOM structure changes with platform upgrades. The `data-value`
attribute on the Individual Name option and the placeholder text on the name
inputs are the most likely to shift. Inspect the current SPA DOM and update the
selectors in `searchQBCCExcluded` in `qbcc.js`.

### WA B&E — `nameMatchesEntity` filtering out valid results
The filter requires **every** significant word (> 3 chars, not a stopword) in the
entity name to appear in the article text. Entity names with uncommon words or
abbreviations (e.g. "SKB Tiling") will be filtered if those words don't appear
in the article body. Consider relaxing the threshold or using substring matching
in `nameMatchesEntity` in `waBuildingEnergy.js`.
