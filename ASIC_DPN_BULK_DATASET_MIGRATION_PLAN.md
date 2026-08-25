# ASIC Disqualified Persons — Bulk Dataset Migration Plan

Source: end of a multi-session investigation (2026-08-18/19) into `asicDisqualified.js`
silently missing real disqualifications under concurrent search load (Puppeteer resource
exhaustion, an ADF page that never reaches true `networkidle`, a reverted false-fix — full
history in `CLAUDE.md`'s "Incomplete work" section, entries dated 2026-08-18/19). Rather than
keep chasing reliability bugs in the live ASIC Connect scrape, this plan replaces it with ASIC's
own bulk-published dataset on data.gov.au — verified live tonight, see "What's already confirmed"
below.

**How to use this file in a future session**: read this whole file first, then check the
**Execution status** section for what's done. Each phase lists its own resume checklist. Phases
are mostly sequential (each depends on the last one's output) — see the parallelisation note in
each phase for the (limited) exceptions. This plan only covers `asicDisqualified.js` — see
**Out of scope** below.

---

## What's already confirmed (verified live tonight, not re-derived)

- Dataset: **"ASIC - Banned and Disqualified Persons Dataset"**, published by ASIC to
  data.gov.au. Landing page: `https://www.data.gov.au/data/dataset/asic-banned-disqualified-per`.
- Direct CSV download (this month's): `https://data.gov.au/data/dataset/e08a07dc-e1e7-4ab9-95c0-a7930d2f6a39/resource/741da9e3-7e0c-458e-830c-c518698e1788/download/bd_per_202608.csv`
  — **the filename is dated and will change**; the landing page always links the current one.
  No auth, no API key needed for the file download itself.
- Format: **comma-delimited with a UTF-8 BOM**, one row per name/address variant. This
  contradicts an older claim (tab-delimited) found during initial research — trust the live
  file, not that claim, if they ever seem to disagree again.
- Columns: `REGISTER_NAME, BD_PER_NAME, BD_PER_TYPE, BD_PER_DOC_NUM, BD_PER_START_DT,
  BD_PER_END_DT, BD_PER_ADD_LOCAL, BD_PER_ADD_STATE, BD_PER_ADD_PCODE, BD_PER_ADD_COUNTRY,
  BD_PER_COMMENTS`.
- License: Creative Commons Attribution 3.0 Australia — reuse is explicitly permitted (unlike
  AustLII's situation, which is the opposite: explicitly prohibited).
- **Update cadence, fully resolved (Phase 1, Track A)**: filename changes **monthly only**
  (`bd_per_YYYYMM.csv` — no day component, structurally can't encode weekly). Content at that
  same URL is silently overwritten in place every **Tuesday (AEST)** — confirmed via the CKAN
  `package_activity_list` API showing "changed package" events landing ~22:00-23:50 UTC Monday
  (= Tuesday AEST) on a clean weekly cadence for the last 7+ weeks, and a live `HEAD` request on
  today's URL showing `Last-Modified` from this week's Tuesday despite the filename being 24 days
  old. **Practical consequence: never reconstruct `bd_per_{YYYYMM}.csv` yourself** — see the API
  finding below, which sidesteps needing to predict the filename at all.
- **Stable API access, fully resolved (Phase 1, Track A)**: the CKAN Action API is still fully
  alive — it just moved under a `/data/` prefix. The bare path tried tonight
  (`data.gov.au/api/3/action/...`) genuinely 404s against the new Drupal frontend, but
  **`https://data.gov.au/data/api/3/action/resource_show?id=741da9e3-7e0c-458e-830c-c518698e1788`
  works today** (verified live, HTTP 200 JSON, no auth) and returns the resource's current `url`
  field directly. That resource id has been stable since the resource was created (`2016-06-16`
  per the API response) — this is the correct long-term anchor to poll each refresh cycle, not
  the dataset landing page HTML and not a predicted filename. (`package_show?id=asic-banned-disqualified-per`
  also works, returning all 4 resources for the dataset — PDF help file, CSV, TSV, XLSX — if the
  resource id ever needs re-discovering.) Drupal's JSON:API (`/jsonapi`) was checked and does NOT
  exist for this — a red herring, don't chase it further.
- ~7,200 rows total — trivially small to download and hold in memory.
- **Live-verified against the exact case this whole investigation started from**: Veronica
  Roberts appears as 4 rows, all `BD_PER_DOC_NUM = #031925499`, type `Disq. Director`, start
  `03/09/2025`, end `02/09/2030` — matching what the live ASIC Connect scrape found in isolation
  (5 rows there, one of which looked like a duplicate — see the dedup note below).

---

## Where this deviates from the current search/filter logic — read before building

Flagging these because preserving current filtering behaviour was an explicit requirement. All
three are now **resolved** (see decisions below) — kept here as the record of *why*, since the
reasoning matters more than the current code once this ships.

1. **RESOLVED — no type-based filtering at all.** The type-text filter (`/disqualif/i`) cannot be
   reused unmodified against this dataset's `BD_PER_TYPE` values in the first place: live ASIC
   Connect renders the type as the full words "Disqualified Person" (confirmed from a real
   capture this session) — matches `/disqualif/i`. The CSV uses abbreviated codes instead:
   `Disq. Director`, `Banned Securities`, `Credit Banned & Disqualified`, `AFS Banned &
   Disqualified` (all four seen live in the file). **`"Disq. Director"` does NOT contain the
   substring `"disqualif"`** — porting the current regex unmodified would have silently excluded
   genuine disqualified-director rows, including Veronica Roberts's. Decided: don't port a
   regex at all — every row in this file already belongs to the Banned and Disqualified Persons
   register (that's the whole file's scope, confirmed by `REGISTER_NAME` being constant across
   every row), so there's no noise left to filter by type the way the live HTML scrape needed to.
   `BD_PER_TYPE` becomes pass-through metadata (the `Type` field, as today), not a filter gate.
   This is the "minimum functionality that matches what we currently have" version: it cannot
   silently drop a hit the live scrape would have caught, because nothing gets dropped on type at
   all.
2. **RESOLVED — surface all ban types.** Direct consequence of #1: `Banned Securities`,
   `Credit Banned & Disqualified`, and `AFS Banned & Disqualified` all surface alongside
   `Disq. Director`, not just the latter. These are all genuine ASIC enforcement outcomes against
   a named individual and are relevant risk signals for a builder's director — and the live
   scrape's actual current scope (`DPN_F_TYPE=4`) was never independently verified to be narrower
   than this on purpose, only inherited.
3. **RESOLVED — dedupe by `BD_PER_DOC_NUM`.** Current live-scrape dedup (`asicDisqualified.js`)
   keys on a DPN number scraped from a hidden HTML span, falling back to
   `name::startDate::endDate` when that's empty. The CSV's `BD_PER_DOC_NUM` is always present and
   reliable — using it collapses Veronica Roberts's 4 name/address variant rows into a single
   result (with all name variants and addresses rolled into metadata), versus the live scrape's
   current behaviour of returning each variant as a separate result (which, incidentally, is very
   likely why two of her five live-scraped results came back byte-for-byte identical — flagged as
   a loose end earlier this session, never chased further; this migration fixes it as a side
   effect).

**Unaffected — reused as-is, no risk identified:**
- `isNameMatch()` / `normalise()` (order-independent word-set matching) — format-agnostic, works
  identically against `BD_PER_NAME` regardless of whether it's HTML-scraped or CSV-sourced. This
  is the actual "is this the right person" logic and nothing here requires changing it.
- `splitName()` — currently exists only to build the surname/given-name POST fields for the live
  ASIC Connect form. Not needed for a CSV lookup at all (we can `isNameMatch()` against the full
  name string directly) — this becomes dead code for this path, not a filtering-behaviour change.

---

## Open decisions

1. ~~Ban-type scope~~ — **DECIDED**: surface all `BD_PER_TYPE` values (2026-08-19).
2. ~~Dedup granularity~~ — **DECIDED**: one result per `BD_PER_DOC_NUM`, variants rolled into
   metadata (2026-08-19).
3. **Still open — retire or keep the live scrape as a fallback?** Not yet answered. Recommended:
   retire it fully — the whole point is escaping its reliability problems — and repoint the
   result's `url` field at ASIC Connect's DPN search UI as a "verify manually" link, same pattern
   already used for AustLII and `links.js`. Alternative: keep `checkDirector`/`fetchAdfDpnSearch`
   as an automatic fallback if the cache is ever completely empty (adds real maintenance burden
   for a path this investigation spent all of last session discovering is unreliable anyway).
   Phase 1/2 can start either way — this only needs an answer before Phase 4.

---

## Out of scope

This plan only replaces `asicDisqualified.js`'s live scrape. It does **not** address:
- `asic.js` (company status/ACN lookup) or `resolveDirectors()` starvation — the separate,
  still-open platform-wide issue documented in `CLAUDE.md` (2026-08-13 entry). Different data
  need (general company register, not a ban list) and not researched as part of this plan.
- `asicExtract.js` (phoenix/associated-companies detection) — the "Banned and Disqualified
  **Organisations**" dataset (a sibling dataset to the one this plan uses) might be relevant to a
  *future*, separate piece of work, but organisations-that-are-banned is a different concept from
  companies-a-director-was-previously-involved-with-that-are-now-deregistered, which is what
  `asicExtract` actually does. Not researched here — don't assume this plan covers it.

---

## Phases

### Phase 1 — Resolve the remaining unknowns (research only, no code) — ✅ DONE (2026-08-19)

Both tracks completed via parallel subagents; findings folded into "What's already confirmed"
above.

- **Track A** (data.gov.au API/filename stability): resolved. Use
  `https://data.gov.au/data/api/3/action/resource_show?id=741da9e3-7e0c-458e-830c-c518698e1788`
  each refresh cycle and read its `url` field — do not predict/reconstruct the filename. Content
  updates in place weekly (Tuesday AEST); filename only changes monthly.
- **Track B** (paymentTimes.js/paymentTimesRefresh.js conventions): resolved, in detail — see
  Phase 2 below, which now specifies the concrete functions/shapes to mirror rather than pointing
  at the source files generically.

### Phase 2 — Build the fetch/cache/parse module — ✅ DONE (2026-08-19)

Built `server/scrapers/asicDpnDataset.js` and `server/scrapers/asicDpnDatasetRefresh.js`, plus
`server/scrapers/asicDpnDataset.test.js` (10 tests, added to `package.json`'s `test` script).
`npm test`: 46/46 pass. Live-verified end-to-end with real (non-mocked) `fetchDpnRows()`: resolved
the CKAN URL, downloaded and parsed 7,213 real rows, found Veronica Roberts's 4 rows correctly —
matches the manual `curl`/`grep` verification from the research session. One deviation from the
original plan text below: the CKAN `resource_show` JSON API replaced the originally-planned
`update.js`-style regex-scrape for URL resolution (a Phase 1 finding, cleaner than what was
anticipated when this phase was first drafted).

Depends on Phase 1 (done). Not parallelisable — one cohesive module. Mirror
`paymentTimes.js`/`paymentTimesRefresh.js` concretely, per Track B's findings:

- New `server/scrapers/asicDpnDataset.js`:
  - `CACHE_DIR` resolution: same pattern as `paymentTimes.js:15-22` — `process.env.ASIC_DPN_CACHE_DIR`,
    falling back to `os.tmpdir()` when unset *or* when `fs.existsSync(dir)` is false (don't just
    check the env var is set). `CACHE_PATH = path.join(CACHE_DIR, 'asic_dpn_register.csv')`.
  - Resolve current CSV URL via the CKAN `resource_show` endpoint above (plain `axios`, this
    replaces the `update.js`-regex-scrape approach `paymentTimes.js` needed — the CKAN API is a
    cleaner mechanism, already returns the real URL as structured JSON, no regex required).
  - Download the CSV via plain `axios` (confirmed in this investigation — and again live via
    Track A's `HEAD` check — this file needs no Puppeteer/WAF workaround, unlike Payment Times;
    don't reach for `getBrowser()` here at all).
  - Parse with a real CSV parser (comma-delimited + UTF-8 BOM + quoted fields containing commas,
    e.g. `"ROBERTS, VERONICA MARY"` — confirmed live; do not hand-split on `,`).
  - `readCachedBuffer()`-equivalent: mirror `paymentTimes.js:124-136` exactly — reads disk
    regardless of age, returns `{ rows, stale: true, cachedAt: stat.mtime }` or `null` if nothing
    cached (use `stat.mtime`, don't store a separate timestamp).
  - Main fetch function returns `{ rows, stale, cachedAt }` — `stale: false` + `cachedAt: new
    Date()` on a fresh download (best-effort cache write after, non-fatal on failure, mirroring
    `paymentTimes.js:207-218`); `stale: true` + the cached file's `mtime` when falling back;
    throws only when the live fetch fails *and* no cached copy exists at all (mirrors the
    contract documented at `paymentTimes.js:177-184`).
  - In-flight request coalescing: mirror the `inFlightFetch` singleton-promise pattern exactly
    (`paymentTimes.js:222-237`) — a live search request arriving mid-refresh should piggyback on
    the scheduler's in-progress download, not start a second one.
  - Three-tier summary text at the call site that consumes this (Phase 3, not here) should mirror
    `paymentTimes.js:464-478`'s three distinct shapes — success / stale-fallback (say so, with
    `cachedAt.toDateString()`) / hard-failure (`Could not download register: ${err.message}`) —
    rather than collapsing to a boolean.
- New `server/scrapers/asicDpnDatasetRefresh.js`, mirroring `paymentTimesRefresh.js` (33 lines,
  copy the shape closely — it's small): `DEFAULT_INTERVAL_MS` (this file refreshes weekly per
  Phase 1, so a sensible default is longer than Payment Times' 8h — e.g. 12h is still frequent
  enough to catch a Tuesday refresh promptly without hammering the API — pick something and note
  it's a judgement call, not a researched number), overridable via a new `ASIC_DPN_REFRESH_INTERVAL_MS`
  env var (same default-parameter pattern as `paymentTimesRefresh.js:26`). `refreshOnce()` wraps
  everything in try/catch that only logs (`console.error`) and never rethrows — explicit comment
  like the original's "must not crash the long-lived server process." `start...()` calls
  `refreshOnce()` once immediately without awaiting (fire-and-forget, must not block
  `app.listen`), then `setInterval`. Log prefix `[asicDpnDatasetRefresh]`, matching three-level
  style: `console.log` cache warm, `console.warn` stale-fallback-but-succeeded, `console.error`
  total failure — same distinction as the original, `.toISOString()` in logs (vs.
  `.toDateString()` in the user-facing summary — that asymmetry in the original is deliberate,
  keep it).
- Unit tests: a small fixture CSV (few rows, following the same fixture-file convention as
  `server/tests/fixtures/adfDpnRow.js`), covering parse correctness, stale-fallback behaviour, and
  the BOM/delimiter handling specifically (this is the one part of "what's already confirmed"
  above that's most likely to have an edge case, e.g. a genuinely comma-containing field wrapped
  in quotes — the real file uses quoted fields, e.g. `"ROBERTS, VERONICA MARY"` — confirm the
  parser handles quoted-comma correctly, not just naive `.split(',')`).

**Resume checklist**: `npm test` green for the new test file; a manual one-off run of the new
module against the live URL confirmed non-empty rows (cheap, no captcha/browser cost — safe to
just run it, unlike the live ASIC Connect checks from previous sessions).

### Phase 3 — Rewire the matching logic — ✅ DONE (2026-08-19)

Built `server/scrapers/asicDpnMatch.js` (`searchASICDisqualifiedFromDataset`,
`buildResultsForDirector`) and `server/scrapers/asicDpnMatch.test.js` (14 tests). Exported
`isNameMatch`/`normalise`/`buildSearchUrl` from `asicDisqualified.js` (were previously internal
only) so the new module imports them unchanged rather than reimplementing — zero changes to
those functions' behaviour. `npm test`: 60/60 pass. Live-verified end-to-end against the real
dataset: Veronica Roberts's 4 CSV rows correctly collapse to 1 result with `Also Known As:
"ROBERTS, VERONICA MARY; ROBERTS, VERONICA"` and `Known Addresses: "TULLAMARINE VIC; TAYLORS
LAKES VIC"` — and it's near-instant (cached data, no captcha/browser wait).

**One more deviation found during implementation, not anticipated when this phase was drafted**:
the live scrape capped director checks at 6 (`directors.filter(Boolean).slice(0, 6)` in
`asicDisqualified.js`) purely as a cost/time control, since each check cost a real captcha solve.
A dataset lookup is effectively free, so `searchASICDisqualifiedFromDataset` checks **every**
supplied director with no cap. Covered by a dedicated test (8 directors, match only on the 8th,
which the old cap would have silently missed).

The old live-scrape path in `asicDisqualified.js` (`searchASICDisqualified`, `checkDirector`,
`parseDisqualifiedResults`, `fetchAdfDpnSearch`) is untouched and still fully functional — this
phase only added new files alongside it. Nothing wired into `index.js` yet (Phase 4).

Depends on Phase 2. Decisions 1 and 2 above are resolved, so this can proceed without further
sign-off; decision 3 (retire-or-keep the live scrape) only needs answering before Phase 4, not
before starting this phase. Not parallelisable — this is the core logic-preservation work and
should stay in one coherent unit/session given how much prior investigation already turned up
subtle behavioural gaps when logic got split across files.

- New matching function (reusing `isNameMatch`/`normalise` from `asicDisqualified.js`
  unchanged — import them, don't reimplement) that looks up each director name against the cached
  dataset rows instead of live-fetching HTML.
- No type-based filtering — every matched row surfaces regardless of `BD_PER_TYPE` (decision 1/2
  above). `BD_PER_TYPE` still populates the `Type` metadata field, same as today, it's just no
  longer a gate on inclusion.
- Group matches by `BD_PER_DOC_NUM` before building results — one result per disqualification
  order, with distinct `BD_PER_NAME` spellings and addresses seen for that doc number rolled into
  the result's metadata (e.g. `Also Known As`, `Known Addresses`) rather than emitted as separate
  results (decision 2 above).
- Preserve the exact `SearchResult`/`ResultItem` output shape (`title`, `url`, `date`, `status`,
  `description`, `metadata` keys: `Director Name`, `Order Date`, `Expiry Date`, `Type`, `Address`)
  so `riskGrouper.ts` and `ReportContent.tsx` need **zero changes** — this is a hard constraint,
  not a nice-to-have, given how much of tonight's pain came from silent shape mismatches
  elsewhere in this same feature.
- Decide the `failed`/honesty-reporting story for this new path: a cache that's never
  successfully refreshed (no rows at all) is the equivalent of today's `failed: true`; a cache
  that's present but simply doesn't contain the queried name is a genuine `failed: false` clean
  result, same distinction as `checkDirector` already established two nights ago.
- Unit tests mirroring `server/scrapers/asicDisqualified.test.js`'s existing structure and
  coverage (genuine match, no match, case-insensitivity, the SURNAME-first / word-order cases
  already covered there) — re-run against the new function, not deleted.

**Resume checklist**: `npm test` green; a fixture-based test proving all four `BD_PER_TYPE`
values surface (i.e. nothing gets silently dropped the way the old regex would have) is the
single most important test to have passing before moving on, plus a test proving the
`BD_PER_DOC_NUM` grouping actually collapses Veronica Roberts's 4 fixture rows into 1 result.

### Phase 4 — Wire in, retire the old path — ✅ DONE (2026-08-19)

Decision 3 resolved: retire fully. `index.js` now calls `searchASICDisqualifiedFromDataset` from
`asicDpnMatch.js` (no `CAPTCHA_API_KEY` passed — confirmed still used elsewhere, not removed
platform-wide). `startAsicDpnDatasetRefresh()` added alongside `startPaymentTimesRefresh()`.

Retired entirely, not left dead: `checkDirector`, `searchASICDisqualified`,
`parseDisqualifiedResults` removed from `asicDisqualified.js` (now just the shared
`isNameMatch`/`normalise`/`buildSearchUrl` helpers, still used by `asicDpnMatch.js`);
`fetchAdfDpnSearch` and its DPN form constants removed from `browser.js`. Obsolete tests removed
too: `tests/test-asic-disqualified-parser.js`, `tests/test-asic-disqualified-live.js`,
`tests/fixtures/adfDpnRow.js`, plus the corresponding `run-all.sh` entry and `tests/README.md`
sections. `asicDisqualified.test.js` trimmed to direct tests of the surviving exports. `npm
test`: 49/49 pass.

`CLAUDE.md` updated: new "Scraper conventions" entry for the bulk-dataset pattern, and the
2026-08-19 `asicDisqualified` incident entry marked superseded (kept, not deleted — it's the
record of *why*).

**Resume checklist item confirmed via `git diff --stat`**: `riskGrouper.ts` has zero diff.
`ReportContent.tsx` shows a diff, but it's entirely pre-existing unrelated work (QBCC decision
PDF link handling) that predates this session — not touched by this migration.

**End-to-end proof**: started the server locally with real Railway env vars
(`railway run -- node index.js`) and POSTed the exact real `/api/search` request that showed the
original false negative (CONSTRUCTION VICTORIA PROPRIETARY LIMITED / ACN 616327863 / director
Veronica Roberts). Result: `asicDisqualified` now returns her record correctly, through the full
real pipeline (`resolveDirectors` → `asicDpnMatch` → the exact NDJSON line the frontend consumes)
— not an isolated function call.

Depends on Phase 3. Small, sequential.

- Swap the call site in `server/index.js` (currently
  `searchASICDisqualified(await resolveDirectors(), process.env.CAPTCHA_API_KEY)`) to the new
  dataset-backed function. `CAPTCHA_API_KEY` is no longer needed for this specific check (still
  needed elsewhere — `asic.js`, `asicExtract.js`, SA/TAS licence registers — don't remove it
  platform-wide).
- Per the retire-or-keep decision above: either delete `checkDirector`/`fetchAdfDpnSearch`'s DPN
  branch entirely, or leave it in place but unused/unreachable with a comment explaining why.
- Add `startAsicDpnDatasetRefresh()` alongside the existing `startPaymentTimesRefresh()` call at
  the bottom of `server/index.js`.
- Update `CLAUDE.md`: add a new "Scraper conventions" entry for the bulk-dataset pattern (mirror
  the existing Payment Times convention entries), and mark the 2026-08-18/19 `asicDisqualified`
  incident entries as superseded by this migration rather than deleting them (they're a genuine,
  useful record of why the live-scrape approach was abandoned).

**Resume checklist**: a git diff review confirming `riskGrouper.ts`/`ReportContent.tsx` have zero
changes (the shape-preservation constraint from Phase 3 held).

### Phase 5 — Verify — ✅ DONE, migration itself confirmed correct (2026-08-19)

`npm test`: 49/49 green. Deployed (`c38220f`, Railway commit confirmed via `railway status`).
Re-ran the exact production request that started this whole investigation (CONSTRUCTION VICTORIA
PROPRIETARY LIMITED / ACN 616327863 / Veronica Roberts) directly against the live production
`/api/search` endpoint, twice, both times confirming `asicDisqualified` correctly returns her
disqualification record through the full real pipeline. Not spot-checked in an actual browser
(report UI render) — everything else about this phase is proven at the API/data level, but the
frontend render itself wasn't visually confirmed; low risk given zero changes to
`riskGrouper.ts`/`ReportContent.tsx` and the result shape being unchanged, but flagging the gap
rather than silently claiming full coverage.

**Important finding from this phase, not a regression from this migration**: a full-search test
run showed only 5 of 29 scrapers completing under real concurrent load, including the new
(Puppeteer-free) `asicDisqualified` failing to flush a result that time — this is the pre-existing
"hung scraper" issue (documented since 2026-08-13/19), now confirmed more severe and to affect
even non-Puppeteer scrapers under heavy load, not something introduced here. Full detail and
next steps in `CLAUDE.md`'s "Puppeteer-dependent scrapers systemically starved" entry (2026-08-19,
the one after the now-superseded `asicDisqualified` incident entry). **This means the migration is
correct but not yet a complete fix for reliably surfacing this check on every single search** —
that depends on resolving the separate concurrency issue, which remains open and is a strictly
bigger, platform-wide problem (affects the other ~15 Puppeteer-dependent scrapers too, not just
this one).

---

## Execution status

**All 5 phases complete (2026-08-19).** All 3 decisions resolved: ban-type scope → surface all;
dedup granularity → by document number; retire-or-keep the live scrape → retired fully. Deployed
as `c38220f`. `npm test`: 49/49. Live-verified against production twice.

**The migration itself is done and correct** — proven at the unit-test, isolated-live-call, and
full-real-pipeline levels (locally and in production). **What's NOT resolved**: a separate,
pre-existing, platform-wide concurrency/resource-exhaustion issue (Puppeteer-dependent scrapers,
now confirmed to include starving even non-Puppeteer ones under heavy load) means this check —
like ~15 other scrapers — isn't guaranteed to complete on every single real search yet. That's
tracked in `CLAUDE.md`'s "Puppeteer-dependent scrapers systemically starved" entry (2026-08-19),
not in this plan — it's a bigger, separate piece of work, out of scope for what was asked here.

Phase-by-phase detail, including the one new deviation found during implementation (no artificial
director cap — the old 6-director limit existed purely because each check cost a real captcha
solve) and the reverted false start (a `waitForNetworkIdle` hardening attempt from the *previous*
session, unrelated to this plan), is in each phase's section above.
