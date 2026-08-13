# ASIC Disqualified — Stale Fixture Fix Plan

Source: ASIC scraper health check, 2026-08-13. `npm test` (server) currently fails 5/8
`parseDisqualifiedResults` cases in `server/scrapers/asicDisqualified.test.js` — not a live
scraper regression. Confirmed via `server/tests/test-asic-disqualified-parser.js` (realistic
ADF fixture, 11/11 passing) that the parser itself is correct; the older unit-test file's
`buildTableHtml()` builds flat 4-`<td>` rows with a `Reason` field that hasn't matched the
real ADF markup (7 cells, hidden-span name, `Type`/`Address` metadata, no `Reason` field)
since a later parser rewrite. The two test files independently invented fixture shapes and
drifted apart.

---

## Outcome (2026-08-13) — all steps complete

All 3 steps done. `npm test` (server): 29/29 pass. `node tests/test-asic-disqualified-parser.js`:
11/11 pass. No parser code changed — `server/scrapers/asicDisqualified.js` was already correct;
only the two test files were touched (plus the new shared fixture module).

One extra fix beyond the original plan: the "partial name match" case's expected outcome was
itself wrong, inherited from the old (never-actually-exercised) test. `isNameMatch()` does
order-independent word-set matching, not substring matching — a query name whose words are all
present in a longer register name (e.g. "John Smith" vs. "Smith, John Robert") is expected to
match. Renamed the test and flipped its assertion to `results.length === 1` to reflect that.

No further follow-up needed on this item.
