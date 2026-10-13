/**
 * test-asic-company.js — live check of the ASIC company record (DATA_SOURCES_PLAN.md 1.3).
 *
 * searchASIC() reads ASIC's Company Dataset through data.gov.au's live DataStore API
 * (scrapers/asic.js). Fixtures checked live on 2026-10-12:
 *   - TURNKEY CREATIONS PTY LTD, ACN 155832732 — registered, two former names
 *     (FAW HOLDINGS PTY LTD; A.C.N. 155 832 732 PTY LTD).
 *   - UNIVERSAL PROPERTY GROUP PTY LIMITED, ACN 078297748 — external administration (EXAD),
 *     formerly BATHLA CONSTRUCTION / BATHLA INVESTMENTS. The ASIC Connect scraper this replaced
 *     returned nothing at all for this company.
 * Company statuses change over time — if a status assertion fails, re-check the company on
 * ASIC Connect before treating it as a regression.
 */
'use strict';

const path = require('path');
const { searchASIC, lookupAsicCompany } = require(path.join(__dirname, '../scrapers/asic'));
const { resolveEntityIdentity } = require(path.join(__dirname, '../scrapers/licenceMatching'));
const { pass, fail, step, header, summary } = require('./lib/helpers');

(async () => {
  header('ASIC company record — live Company Dataset (data.gov.au DataStore)');
  let passed = 0;
  let failed = 0;
  const check = (label, ok, msg, details) => {
    if (ok) { pass(label, msg); passed++; } else { fail(label, msg, details); failed++; }
  };

  step('Step 1: Turnkey by ABN (company ABN → derived ACN)...');
  const turnkey = await searchASIC(
    resolveEntityIdentity({ abn: '67155832732' }, { results: [{ title: 'TURNKEY CREATIONS PTY LTD', metadata: { 'Entity type': 'Australian Private Company' } }] })
  );
  const t = turnkey.results[0];
  check('Step 1', t?.title === 'TURNKEY CREATIONS PTY LTD' && t?.metadata?.MatchedBy === 'ACN', 'current record found by ACN', turnkey);
  check('Step 1b', t?.status === 'Registered', `status "${t?.status}"`, t);
  check(
    'Step 1c',
    turnkey.formerNames?.includes('FAW HOLDINGS PTY LTD'),
    `former names: ${(turnkey.formerNames || []).join('; ')}`,
    turnkey.formerNames
  );

  step('Step 2: Universal Property Group by ACN...');
  const upg = await searchASIC(resolveEntityIdentity({ abn: '98078297748', acn: '078297748' }, null));
  check('Step 2', upg.results[0]?.status === 'External administration', `status "${upg.results[0]?.status}"`, upg);

  step('Step 3: ABN-only lookup (the ABR-outage identity fallback path)...');
  const byAbn = await lookupAsicCompany({ abn: '67155832732' });
  check('Step 3', byAbn?.current?.['Company Name'] === 'TURNKEY CREATIONS PTY LTD', 'found by ABN column', byAbn);

  step('Step 4: an ACN with no company...');
  const none = await searchASIC(resolveEntityIdentity({ acn: '000000001' }, null));
  check('Step 4', none.results.length === 0 && /No ASIC company record found/.test(none.summary) && none.status !== 'error', none.summary, none);

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
