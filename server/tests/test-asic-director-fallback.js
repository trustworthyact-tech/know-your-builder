/**
 * TEST: asic.js director-discovery fixes (2026-09-09 follow-up to WS3)
 *
 * PURPOSE
 *   Two bugs were fixed in searchASIC() (server/scrapers/asic.js): the ACN-search branch
 *   never called parseDirectors() at all, and the Data API fallback's `results.length === 0`
 *   guard meant it could never fire once that branch had already pushed a company item —
 *   permanently unreachable for the one case (company found, no directors) it existed to
 *   cover. Neither fix could be verified live when made: the CAPTCHA-gated ASIC Connect path
 *   needs a real CAPTCHA_API_KEY, and the Data API path needs ASIC_DATA_API_KEY, which is
 *   categorically unobtainable until ASIC's DSP applications reopen in 2027 (see CLAUDE.md's
 *   WS3 entries) — not a missing-config problem, an access one.
 *
 *   searchASIC() now takes two injectable trailing params (_fetchAdfPageWithCaptcha,
 *   _fetchFromDataApi), same pattern as asicDpnMatch.js's _fetchDpnRows and the captcha-gated-
 *   check convention documented in CLAUDE.md — this is what makes the pilots below possible
 *   without any live network or real credentials.
 *
 *   Pilot 1 — ACN branch + a synthetic page WITH a director table: parseDirectors() finds it,
 *     and the Data API fallback is correctly never invoked (director already found).
 *   Pilot 2 — ACN branch + a synthetic page WITHOUT a director table: parseDirectors() finds
 *     nothing, doesn't throw, and the company item found via parseCompanyDetail() survives.
 *   Pilot 3 — the merge-not-replace fix: company found (no directors) + a working Data API
 *     stub → only the Data API's director item is appended; its own company record does NOT
 *     overwrite the one already found via ASIC Connect.
 *   Pilot 4 — the original results.length === 0 behavior is unchanged: ASIC Connect finds
 *     nothing at all → the Data API result (company + directors) is taken in full.
 *
 * USAGE
 *   node server/tests/test-asic-director-fallback.js
 *
 * EXIT CODE
 *   0 — all pilots passed   1 — any pilot failed
 */

'use strict';

const path = require('path');
const { searchASIC } = require(path.join(__dirname, '../scrapers/asic'));
const { pass, fail, step, header, summary } = require('./lib/helpers');

// Deliberately avoids "name"/"acn"/"number" in the directors table's header (beyond what
// parseDirectors itself needs — "officer"/"role") so it can't accidentally be picked up by
// parseSearchResults's own table-header sniffing — keeps Pilot 1/2's setup unambiguous.
const DETAIL_TABLE = `
  <table>
    <tr><th>Name</th><td>TEST DIRECTOR DISCOVERY PTY LTD</td></tr>
    <tr><th>ACN</th><td>123456789</td></tr>
    <tr><th>Status</th><td>Registered</td></tr>
  </table>
`;
const DIRECTOR_TABLE = `
  <table>
    <tr><th>Officer</th><th>Role</th><th>Appointed</th></tr>
    <tr><td>Jane Test Director</td><td>Director</td><td>01/01/2020</td></tr>
  </table>
`;

function acnFetcher(html) {
  // Simulates fetchAdfPageWithCaptcha for both the search-results call and (if reached) a
  // detail-page call — the ACN branch only ever makes the one search call, so this only
  // needs to satisfy that.
  return async () => html;
}

(async () => {
  header('asic.js director-discovery fixes — ACN branch parseDirectors() + Data API merge');
  let passed = 0;
  let failed = 0;

  // ── Pilot 1: director found on the ACN-branch page; Data API skipped ─────────
  step('Pilot 1: ACN branch with a director table present...');
  {
    let dataApiCalls = 0;
    const fakeDataApi = async () => {
      dataApiCalls++;
      return [];
    };
    const result = await searchASIC(
      'Test Director Discovery Pty Ltd',
      '',
      '123456789',
      'fake-captcha-key',
      acnFetcher(`<html><body>${DETAIL_TABLE}${DIRECTOR_TABLE}</body></html>`),
      fakeDataApi
    );
    const director = result.results.find((r) => r.metadata?.Role === 'Director');
    const company = result.results.find((r) => r.title === 'TEST DIRECTOR DISCOVERY PTY LTD');

    if (!company) {
      fail('Pilot 1', 'Expected the company item to still be present', result.results);
      failed++;
    } else if (!director || director.title !== 'Jane Test Director') {
      fail('Pilot 1', 'Expected parseDirectors() to find "Jane Test Director" via the ACN branch', result.results);
      failed++;
    } else if (dataApiCalls !== 0) {
      fail('Pilot 1', 'Data API fallback should not fire once a director was already found', { dataApiCalls });
      failed++;
    } else {
      pass('Pilot 1', 'ACN branch found the director directly; Data API fallback correctly skipped');
      passed++;
    }
  }

  // ── Pilot 2: no director table — no throw, company item survives ─────────────
  step('Pilot 2: ACN branch with no director table present...');
  {
    const result = await searchASIC(
      'Test Director Discovery Pty Ltd',
      '',
      '123456789',
      'fake-captcha-key',
      acnFetcher(`<html><body>${DETAIL_TABLE}</body></html>`),
      async () => []
    );
    const company = result.results.find((r) => r.title === 'TEST DIRECTOR DISCOVERY PTY LTD');
    const anyDirector = result.results.some((r) => r.metadata?.Role === 'Director');

    if (!company) {
      fail('Pilot 2', 'Expected the company item to survive when parseDirectors() finds nothing', result.results);
      failed++;
    } else if (anyDirector) {
      fail('Pilot 2', 'Did not expect a director when no director table was present', result.results);
      failed++;
    } else {
      pass('Pilot 2', 'No director table — parseDirectors() found nothing, no throw, company item intact');
      passed++;
    }
  }

  // ── Pilot 3: company found, no directors — Data API appends director only ────
  step('Pilot 3: Data API fallback merges (appends director, does not overwrite company)...');
  {
    const prevKey = process.env.ASIC_DATA_API_KEY;
    process.env.ASIC_DATA_API_KEY = 'fake-data-api-key';
    try {
      const dataApiCompanyAndDirector = [
        { title: 'DATA API SOURCED NAME PTY LTD', metadata: { ACN: '123456789' } },
        { title: 'John DataApi Director', metadata: { Role: 'Director', 'Appointment Date': '2021' } },
      ];
      const result = await searchASIC(
        'Test Director Discovery Pty Ltd',
        '',
        '123456789',
        'fake-captcha-key',
        acnFetcher(`<html><body>${DETAIL_TABLE}</body></html>`),
        async () => dataApiCompanyAndDirector
      );
      const company = result.results.find((r) => r.title === 'TEST DIRECTOR DISCOVERY PTY LTD');
      const dataApiCompany = result.results.find((r) => r.title === 'DATA API SOURCED NAME PTY LTD');
      const director = result.results.find((r) => r.title === 'John DataApi Director');

      if (!company) {
        fail('Pilot 3', 'ASIC-Connect-sourced company record should not be lost', result.results);
        failed++;
      } else if (dataApiCompany) {
        fail('Pilot 3', "Data API's own company record should NOT overwrite the one already found", result.results);
        failed++;
      } else if (!director) {
        fail('Pilot 3', 'Expected the Data API director item to be appended', result.results);
        failed++;
      } else {
        pass('Pilot 3', 'Company record preserved; only the missing director was appended from the Data API');
        passed++;
      }
    } finally {
      if (prevKey === undefined) delete process.env.ASIC_DATA_API_KEY;
      else process.env.ASIC_DATA_API_KEY = prevKey;
    }
  }

  // ── Pilot 4: nothing found at all — Data API result taken in full (unchanged) ─
  step('Pilot 4: ASIC Connect finds nothing at all — Data API result used in full...');
  {
    const prevKey = process.env.ASIC_DATA_API_KEY;
    process.env.ASIC_DATA_API_KEY = 'fake-data-api-key';
    try {
      const dataApiCompanyAndDirector = [
        { title: 'DATA API SOURCED NAME PTY LTD', metadata: { ACN: '999999999' } },
        { title: 'Sole DataApi Director', metadata: { Role: 'Director' } },
      ];
      // companyName is deliberately '' here: parseCompanyDetail() falls back to companyName
      // when it finds no "Name" field (`fields['Name'] || companyName`) — a non-empty
      // companyName would create a companyItem even on this empty page, making
      // results.length 1 rather than 0 and testing the merge path (Pilot 3) instead of the
      // full-replace one this pilot targets.
      const result = await searchASIC(
        '',
        '',
        '999999999',
        'fake-captcha-key',
        acnFetcher('<html><body><p>No results found.</p></body></html>'),
        async () => dataApiCompanyAndDirector
      );

      if (result.results.length !== 2) {
        fail('Pilot 4', 'Expected the Data API result (company + director) taken in full', result.results);
        failed++;
      } else if (!result.results.some((r) => r.title === 'DATA API SOURCED NAME PTY LTD')) {
        fail('Pilot 4', "Expected the Data API's own company record when nothing was found via ASIC Connect", result.results);
        failed++;
      } else {
        pass('Pilot 4', 'Original results.length === 0 behavior unchanged — full Data API result used');
        passed++;
      }
    } finally {
      if (prevKey === undefined) delete process.env.ASIC_DATA_API_KEY;
      else process.env.ASIC_DATA_API_KEY = prevKey;
    }
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
