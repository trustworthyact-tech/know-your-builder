# Register Accuracy Tests

Tests that verify ASIC and licence register scrapers return accurate positive
results when a known disqualified or disciplined entity is searched.

Each test is **self-verifying**: it discovers a live fixture from the target
register before calling the scraper, so it never relies on stale hardcoded data.

---

## Test inventory

### Section 8.3 — Financial Risk Signals (all in run-all.sh except AFSA NPII)

| File | Register | Browser needed | API key needed | Typical run time |
|------|----------|----------------|----------------|------------------|
| `test-asic-insolvency.js` | ASIC Published Notices — Insolvency | Yes (Puppeteer) | No | ~60s |
| `test-ato-debt.js` | ASIC Published Notices — ATO Tax Debt | Yes (Puppeteer) | No | ~60s |
| `test-payment-times.js` | Payment Times Reporting Register | No | No | ~30–120s (Excel download) |
| `test-modern-slavery.js` | Modern Slavery Statements Register | No | No | ~15s |
| `test-afsa-npii.js` | AFSA NPII — Personal Insolvency | No | No | ~15s |

**Note on `test-afsa-npii.js`:** The AFSA NPII scraper is a deep-check-only feature (paid tier). Its test is not included in `run-all.sh` to avoid running deep-check network calls in routine CI. Run it separately: `node server/tests/test-afsa-npii.js`. Use `run-s83.sh` (in this directory) to run all 5 section 8.3 tests including AFSA NPII.

**KNOWN BROKEN (2026-07-05):** `npii.afsa.gov.au` is decommissioned. AFSA migrated NPII to the Bankruptcy Register Search (BRS) at `services.afsa.gov.au/brs/`. The BRS now requires a registered AFSA account and per-result payment. The scraper (`afsaNpii.js`) silently returns empty results and the test fails at Step 1 with a clear diagnosis. A full rebuild is needed — see the "Common failure patterns" section below.

**KNOWN FLAKY (2026-07-20):** `test-payment-times.js` occasionally fails with a 406 from an
Azure Front Door WAF false-positive on the register download — retried automatically now (see
"Common failure patterns" below), but not eliminated. A lone 406 failure isn't a regression.

**Note on ASIC Insolvency + ATO Debt:** Both scrape the same site (`publishednotices.asic.gov.au`) via Puppeteer. If both fail simultaneously, the site is likely down or its Cloudflare protection changed — check the site first before debugging individual scrapers.

---

### Section 8.1 / 8.5 — Disqualified persons and courts

### Scraper integration tests (have automated scrapers)

| File | Register | Browser needed | API key needed | Typical run time |
|------|----------|----------------|----------------|------------------|
| `test-asic-disqualified-parser.js` | ASIC DPN | No | No | < 5s |
| `test-asic-disqualified-live.js` | ASIC DPN | Yes (Puppeteer) | CAPTCHA_API_KEY | ~60–90s |
| `test-qbcc-excluded.js` | QBCC Excluded | Yes (Puppeteer) | No | ~3–5 min |
| `test-vicbpc.js` | VBA Disciplinary | Yes (Puppeteer) | No | ~30–60s |
| `test-wa-building.js` | WA B&E Enforcement | No | No | ~20–30s |

### Section 8.5 — Courts, Enforcement & Disciplinary (in run-all.sh; also `run-s85.sh`)

| File | Register | Browser needed | API key needed | Typical run time |
|------|----------|----------------|----------------|------------------|
| `test-austlii.js` | AustLII — Courts & Tribunals (9 jurisdictions) | No (via ScraperAPI) | SCRAPERAPI_KEY | ~20–40s |
| `test-fwo.js` | Fair Work Ombudsman — Enforcement Outcomes | No | No | ~15s |
| `test-qbcc-adjudication.js` | QBCC — Adjudication Decisions (Salesforce Aura API) | No | No | ~15–30s |

Last verified 2026-07-16: all three PASS. See "Section 8.5 sub-agent prompts" below for
per-test debugging prompts, and "Common failure patterns" for two issues found and fixed
during that verification (AustLII's standalone `SCRAPERAPI_KEY` loading, and `test-fwo.js`'s
narrow fixture-discovery regex).

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

---

## Section 8.3 sub-agent prompts

Each prompt below is self-contained — paste it verbatim into a fresh session or
sub-agent. No conversation history required. The tests have no shared state and
can be handed to agents concurrently.

---

### Sub-agent prompt: ASIC Insolvency (Puppeteer, no API key)

```
Working directory: /Users/jameskwan/know-your-builder

Run this test (from repo root):
  node server/tests/test-asic-insolvency.js

This test uses Puppeteer to bypass Cloudflare on publishednotices.asic.gov.au.
Allow ~60 seconds.

Steps:
  Step 1 — loads ASIC Published Notices via Puppeteer; confirms div.article-block elements exist
  Step 2 — extracts entity name from the first article block as the live fixture
  Step 3 — calls searchAsicInsolvency(fixtureName, "", "") which submits the search form via Puppeteer
  Step 4 — verifies the fixture entity name (significant words) appears in returned results

After running, report:
1. Full console output (verbatim)
2. Overall PASS / FAIL
3. If any step fails, read server/scrapers/asicInsolvency.js and identify the cause:
   - Step 1 FAIL: publishednotices.asic.gov.au is down, or Cloudflare blocked Puppeteer.
     Check server/scrapers/browser.js (fetchWithBrowser / stealth options).
   - Step 2 FAIL: the <p> entity name pattern inside div.article-block changed.
     Check parseResults in asicInsolvency.js — it reads the first non-empty <p> per block.
   - Step 3 FAIL (0 results): the __doPostBack target or the form field selector changed.
     Open publishednotices.asic.gov.au in a browser; inspect the search form field ID and
     the postback target. Update submitSearch in asicInsolvency.js.
   - Step 4 FAIL: nameMatchesEntity significant-word filter is too strict for the fixture name.
     Check sigWords logic in the test and the matching logic in asicInsolvency.js.
   Propose a targeted fix. Re-run to confirm.
4. Do NOT modify test files.
```

---

### Sub-agent prompt: ATO Tax Debt (Puppeteer, no API key)

```
Working directory: /Users/jameskwan/know-your-builder

Run this test (from repo root):
  node server/tests/test-ato-debt.js

This test uses Puppeteer to bypass Cloudflare on publishednotices.asic.gov.au.
Allow ~60 seconds. ATO debt notices are rare — the test exits PASS with a warning
if none appear on the initial page (this is normal) and you must re-run with
--name "Entity Name" to test the scraper against a known entry.

Steps:
  Step 1 — loads ASIC Published Notices via Puppeteer; filters blocks with ATO keywords
  Step 2 — extracts entity name from the first ATO-keyed block as fixture (or uses --name)
  Step 3 — calls searchAtoDebt(fixtureName, "", "") via Puppeteer form submit
  Step 4 — verifies the fixture entity appears in results

After running, report:
1. Full console output (verbatim)
2. Overall PASS / FAIL (or PASS-with-warning if no ATO notices currently on the page)
3. If any step fails, read server/scrapers/atoDebt.js and identify the cause:
   - Step 1 FAIL: site is down or Cloudflare blocked — check asicInsolvency test too.
     If both fail simultaneously, the site itself is the problem.
   - Step 3 FAIL (0 results): the form submit path or article-block selector changed.
     Check parseResults in atoDebt.js against the current page structure.
   - Step 4 FAIL: significant-word match failed. Check isAtoText() and sigWords() in
     both the test and the scraper.
   Propose a targeted fix. Re-run to confirm.
4. Do NOT modify test files.
```

---

### Sub-agent prompt: Payment Times Register (no browser, no API key)

```
Working directory: /Users/jameskwan/know-your-builder

Run this test (from repo root):
  node server/tests/test-payment-times.js

No Puppeteer or API key required. The test downloads an Excel workbook from
register.paymenttimes.gov.au — allow 30–120 seconds on first run; subsequent
runs use the cached file at /tmp/ptrr_register.xlsx.

Steps:
  Step 1 — fetches register.paymenttimes.gov.au/files/js/update.js to confirm the
           register is reachable and extracts the current Excel filename
  Step 2 — selects "BHP" as the fixture (or uses --name "Entity Name")
  Step 3 — calls searchPaymentTimes(fixtureName, "", ""); asserts >= 1 result
  Step 4 — verifies the fixture name appears in at least one result title

After running, report:
1. Full console output (verbatim)
2. Overall PASS / FAIL
3. If any step fails, read server/scrapers/paymentTimes.js and identify the cause:
   - Step 1 FAIL: register.paymenttimes.gov.au is down, or /files/js/update.js path changed.
     Check the URL in both the test and paymentTimes.js.
   - Step 3 FAIL (0 results): the Excel column mapping changed (sheet name, or column letters
     for entity name / ABN). Download the current Excel manually and inspect sheet2 columns.
     Update the column constants in paymentTimes.js.
   - Step 3 FAIL (cache stale): delete /tmp/ptrr_register.xlsx and re-run.
   - Step 4 FAIL: the entity name column maps to a different field. Check that r.title is
     populated from the correct column in paymentTimes.js.
   Propose a targeted fix. Re-run to confirm.
4. Do NOT modify test files.
```

---

### Sub-agent prompt: Modern Slavery Register (no browser, no API key)

```
Working directory: /Users/jameskwan/know-your-builder

Run this test (from repo root):
  node server/tests/test-modern-slavery.js

No Puppeteer or API key required — axios + cheerio only. Typical run time ~15s.

Steps:
  Step 1 — fetches modernslaveryregister.gov.au with a broad query ("limited");
           confirms a.search-results__item elements are present
  Step 2 — selects the first result with a "distinctive" entity name as fixture
  Step 3 — calls searchModernSlavery(fixtureName, ""); asserts >= 1 result
  Step 4 — verifies at least one significant word from the fixture name appears in
           a result title (the scraper's isEntityMatch already enforced this; this
           step confirms data flows through to r.title correctly)

After running, report:
1. Full console output (verbatim)
2. Overall PASS / FAIL
3. If any step fails, read server/scrapers/modernSlavery.js and identify the cause:
   - Step 1 FAIL: register is down or a.search-results__item selector changed.
     Browse https://modernslaveryregister.gov.au/statements/?q=limited and inspect
     the result anchor element. Update the selector in modernSlavery.js.
   - Step 3 FAIL (0 results): isEntityMatch in modernSlavery.js may be filtering all
     results. Check that isEntityMatch allows the fixture name words to match the
     .search-results__item-entity text. The fixture name from Step 2 may contain words
     the entity block doesn't; re-run with --name using the exact register spelling.
   - Step 4 FAIL: r.title is sourced from the wrong DOM element. Check that
     .search-results__item-entity div (first child) text contains the entity name words.
   Propose a targeted fix. Re-run to confirm.
4. Do NOT modify test files.
```

---

### Sub-agent prompt: AFSA NPII — personal insolvency (no browser, no API key)

**STATUS: HARD BLOCKED as of 2026-07-07 (investigated).**
`npii.afsa.gov.au` is decommissioned. AFSA migrated NPII to the Bankruptcy Register
Search (BRS) at `https://services.afsa.gov.au/brs/`. The BRS 3-step POST flow was
fully reverse-engineered but every search (including fake names) redirects to a payment
page — there is no free tier. The feature cannot be rebuilt without an AFSA BRS account
and per-search payment budget. Recommendation: remove or replace this data source.

The test fails at Step 1 with a clear diagnosis message.

```
Working directory: /Users/jameskwan/know-your-builder

Run this test (from repo root):
  node server/tests/test-afsa-npii.js

No Puppeteer or API key required — axios only. Typical run time ~15s.
This scraper is DEEP-CHECK ONLY (paid tier) and is NOT included in run-all.sh.

KNOWN BROKEN: npii.afsa.gov.au is decommissioned. The test will fail at Step 1
with a diagnosis explaining the BRS migration. This is expected.

Steps (as designed — currently Step 1 fails intentionally):
  Step 1 — GETs https://services.afsa.gov.au/brs/search (new BRS URL)
           Fails because the BRS uses CSRF tokens, not JSF ViewState.
           The failure message documents what is needed for a full rebuild.
  Step 2 — (not reached) would POST a broad surname search
  Step 3 — (not reached) would call searchAfsaNpii([fixtureName])
  Step 4 — (not reached) would verify fixture surname in results

After running, report:
1. Full console output (verbatim)
2. Confirm Step 1 FAIL with the BRS migration message — this is EXPECTED
3. To rebuild the scraper, read server/scrapers/afsaNpii.js (the MIGRATION NOTE
   at the top) and the "AFSA NPII — domain decommissioned" section in this README.
   The BRS rebuild requires:
   a. Replace JSF ViewState with CSRF token from <meta name="_csrf"> on /brs/search
   b. 3-step POST flow:
      1. GET /brs/search → CSRF + cookies
      2. POST /brs/search-add-email → surname, givenName, searchDobMethod=ANY,
         _matchNoDateOfBirth=on, searchByName=true → "Your email address" page
      3. POST /brs/searchbyname → customerEmailOpted=false, emailEntered=true → results
   c. Verify whether a paid AFSA BRS account is needed for any results
      (free account may return "no records found"; paid needed for actual records)
4. Do NOT modify test files unless specifically updating for the BRS rebuild.
```

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

## Section 8.5 sub-agent prompts

Courts, Enforcement & Disciplinary (`id="s85"` in `ReportContent.tsx`) is fed by exactly
three sources: AustLII (9 jurisdictions), FWO, and the QBCC adjudication branch (shared file
with the QBCC licence/excluded-individual scrapers, which are out of scope here). All three
were rewritten in `d86cf54` and `dfe56e6` — verified passing again as of 2026-07-16.

### Sub-agent prompt: AustLII courts & tribunals (no API key beyond SCRAPERAPI_KEY)

```
Working directory: /Users/jameskwan/know-your-builder

Run this test (from repo root):
  node server/tests/test-austlii.js

This test calls searchAustLII directly for the federal, qld, and nsw jurisdictions (no
Puppeteer — AustLII is reached via ScraperAPI to bypass a Cloudflare Managed Challenge).
SCRAPERAPI_KEY must be set in server/.env; the scraper itself calls dotenv.config() to pick
it up even when the test is run standalone (see server/scrapers/austlii.js top of file), so
you should not need to export anything manually.

Steps:
  Step 1 — fetches the AustLII search page directly via ScraperAPI to discover a live
           fixture case name
  Step 2 — calls searchAustLII(fixtureName, [], 'federal'); asserts >= 1 result with the
           correct jurisdiction label
  Step 3 — spot-checks 'qld' and 'nsw' concurrently via Promise.all, confirming the
           pending-promise dedup cache and URL-substring jurisdiction post-filter both work
           under concurrent calls, and that result URLs have the correct /au/cases/<jur> prefix

After running, report:
1. Full console output (verbatim)
2. Overall PASS / FAIL
3. If Step 1 fails with a 403: check SCRAPERAPI_KEY is present and valid in server/.env
   (`grep SCRAPERAPI_KEY server/.env`) — this is far more likely than AustLII itself being down.
4. If any step fails otherwise, read server/scrapers/austlii.js and identify the cause:
   - Cloudflare/ScraperAPI response no longer contains real search HTML (site or ScraperAPI
     account issue)
   - The dedup cache in fetchTermResults is serving a stale/failed promise to all 9 callers
   - The URL-substring post-filter mis-buckets a jurisdiction (check the /au/cases/<jur>
     prefix mapping)
   Propose a targeted fix. Re-run to confirm.
5. Do NOT modify test files.
```

### Sub-agent prompt: Fair Work Ombudsman enforcement outcomes (no env vars needed)

```
Working directory: /Users/jameskwan/know-your-builder

Run this test (from repo root):
  node server/tests/test-fwo.js

No Puppeteer or API key required — axios + cheerio only.

Steps:
  Step 1 — fetches the FWO newsroom search page; confirms ol.searchResultsInfo li.media
           elements exist
  Step 2 — scans articles for enforcement language and extracts an employer name from the
           heading via extractEntityName() (handles several title patterns: "X Pty Ltd",
           "against X", "X ordered/penalised/fined...", quoted names, and "X signs/faces/
           agrees..." — the last pattern was added 2026-07-16 to cover single-word and
           "The University of NSW"-style entity names FWO headlines commonly use)
  Step 3 — calls searchFWO(fixtureName, "", []); asserts >= 1 result
  Step 4 — verifies the fixture's significant words appear in a result

After running, report:
1. Full console output (verbatim)
2. Overall PASS / FAIL
3. If Step 1 fails: the newsroom URL or selectors changed. Check FWO_NEWS_URL and the
   ARTICLE_SELECTORS list against the live page structure.
4. If Step 2 fails with "no extractable employer name": this week's headlines may use a
   phrasing extractEntityName() doesn't cover yet — this is a test-fixture-discovery
   limitation, not necessarily a scraper bug. Add a new pattern to extractEntityName() in
   test-fwo.js, or run with --name "Entity Name" (copy a name straight from a current FWO
   headline) to bypass discovery and isolate whether the production scraper
   (searchFWO in server/scrapers/fwo.js) itself still works.
5. If Step 3/4 fail even with --name supplied: the actual scraper is broken — check
   server/scrapers/fwo.js's selectors and nameMatchesEntity logic.
6. Do NOT modify server/scrapers/fwo.js unless Step 3/4 fail with a manually-supplied name.
```

### Sub-agent prompt: QBCC adjudication decisions (no env vars needed)

```
Working directory: /Users/jameskwan/know-your-builder

Run this test (from repo root):
  node server/tests/test-qbcc-adjudication.js

No Puppeteer or API key required — the adjudication register is queried directly via QBCC's
Salesforce Aura API at my.qbcc.qld.gov.au. This file is shared with the QBCC licence-register
and excluded-individual scrapers (sections 8.2 and 8.1) — only touch the adjudication branch.

Steps:
  Step 1 — calls the Aura API with a broad (empty respondentName) query; confirms decisions
           are returned
  Step 2 — extracts a party name (claimant or respondent) from the first raw result as fixture
  Step 3 — calls searchQBCC(fixtureName, null, []); asserts adjudicationResults.length >= 1
  Step 4 — verifies the fixture's significant words appear in a result

After running, report:
1. Full console output (verbatim)
2. Overall PASS / FAIL
3. If any step fails, read ONLY the adjudication-related code in server/scrapers/qbcc.js
   (search for "adjudication") and check:
   - The Aura API endpoint/URL is still reachable and returning JSON (not an error page)
   - The Aura request payload format (message/aura.context/aura.token params) hasn't changed
   - The response JSON field names (applicationNumber, claimant, respondent, decisionDate,
     siteSuburb, url, urlLabel) haven't changed
   Propose a targeted fix scoped to the adjudication branch only. Re-run to confirm.
4. Do NOT modify the licence-register or excluded-individual branches of qbcc.js, and do NOT
   modify test files.
```

---

## Common failure patterns and fixes

### AFSA NPII — domain decommissioned, now a fully paid service (hard blocker)

`npii.afsa.gov.au` is gone (DNS ENOTFOUND as of 2026-07-05). AFSA migrated the NPII
to the Bankruptcy Register Search (BRS) at `https://services.afsa.gov.au/brs/`.

**Investigated 2026-07-07 — confirmed fully paid, no free tier:**

The 3-step BRS POST flow was successfully implemented and tested:
1. GET `/brs/search` → extracts CSRF token + session cookies
2. POST `/brs/search-add-email` → submits name criteria (surname, givenName,
   surnameMatchMethod, givenNameMatchMethod, searchDobMethod=ANY,
   _matchNoDateOfBirth=on, searchByName=true) → returns "Your email address" page
3. POST `/brs/searchbyname` → submits customerEmailOpted=false, emailEntered=true

Step 3 redirects to:
`https://services.afsa.gov.au/payment-service/pay/transaction/paymentoptions?reference=NS...`

**Every search, including searches for completely fictitious names, requires payment.**
There is no "no results found" response without completing a payment transaction.
The BRS charges per search, not per result found.

This makes automated scraping of the AFSA NPII register impossible without:
- A registered AFSA BRS account
- A connected payment method  
- Budget for per-search fees (pricing not published; requires account to view)

**Recommendation:** Remove the AFSA NPII deep-check feature from the product, or
replace it with a different director personal insolvency data source. The old free
NPII public register no longer exists. Contact AFSA directly if a bulk/API pricing
arrangement is needed.

Until resolved, `searchAfsaNpii()` silently returns empty results for all queries.

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

### AustLII — `SCRAPERAPI_KEY` not loaded when run standalone
`server/scrapers/austlii.js` reads `process.env.SCRAPERAPI_KEY` but the production server
only gets it via `node --env-file=.env` in the npm start/dev scripts. Running the module
directly (e.g. `node server/tests/test-austlii.js`) previously left the key unset, causing
a 403 from ScraperAPI. Fixed 2026-07-16 by adding `require('dotenv').config(...)` at the top
of `austlii.js` itself — `dotenv` never overrides an already-set env var, so it's a no-op in
the real server process and only fills the gap for standalone/test invocations. `dotenv`
resolves from the shared repo-root `node_modules` (not declared in `server/package.json`,
same as several `server/tests/debug-*.js` and `test-*-licence-register.js` files already
relying on it) — if a future `npm install` ever drops it, this require would throw at module
load and take down the whole server, not just this scraper. Worth adding `dotenv` as an
explicit `server/package.json` dependency if that's ever a concern.

### FWO — `test-fwo.js` fixture discovery too narrow, scraper itself fine
If Step 2 of `test-fwo.js` fails to find an extractable employer name, check whether
`server/scrapers/fwo.js` is actually broken (test with `--name "Entity Name"` copied from a
live headline) before touching the scraper — `extractEntityName()` in the test file only
recognises a handful of title phrasings and FWO's headline style varies week to week. Widened
2026-07-16 to also cover "X signs/faces/agrees..." headlines (single-word entities like
"Yooralla", and "of/for/and"-joined names like "The University of NSW"), but new phrasings
will keep appearing — extend the regex in `extractEntityName()`, not the scraper.

### Payment Times — intermittent 406 downloading the register (known flaky, not fully fixable)
`register.paymenttimes.gov.au` sits behind Azure Front Door, which occasionally 406s a
well-formed download request for `fetchRegisterBuffer()` in `server/scrapers/paymentTimes.js`
with the body "The resource cannot be displayed because the file extension is not being
accepted by your browser." Investigated 2026-07-20: it's not header-dependent (identical
requests succeed and fail back-to-back) and looks like a WAF false-positive/soft-block tied
to the client IP rather than the request itself — once triggered, it can persist across
several immediate retries from the same process. `fetchRegisterBuffer()` now retries up to 5
times with increasing backoff (3s, 6s, 9s...), which recovers most of the time (~7/8 in
testing) but not always. If `test-payment-times.js` fails with a 406 after all retries, it's
very likely this WAF flakiness, not a real scraper regression — just re-run the test after a
short pause. This is a genuine external-service limitation, not something fixable purely
client-side; don't spend time adding more retries or trying alternate headers unless the
failure rate gets meaningfully worse.
