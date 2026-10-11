/**
 * test-licence-matching.js — live fixtures for identifier-first licence matching
 * (LICENCE_MATCHING_PLAN.md Phase 2).
 *
 * Resolves each fixture's identity from the real ABR record, then runs the real NSW (Verify
 * NSW) and ACT (Socrata, fetched live — no local cache needed) matching against it:
 *
 *   NSW 1 — TURNKEY CREATIONS PTY LTD, searched as its trading name "Canberra Granny Flat
 *           Builders": licence 259006C found via ACN; Constable + Walmsley as Directors;
 *           Constable's personal licence 241240C linked from the record.
 *   NSW 2 — Universal Property Group Pty Limited: 85273C via ABN; Bhart Bhushan (Director),
 *           Raj Mohan (Nominated Supervisor).
 *   NSW 3 — Ardent Builders Pty Ltd (NSW recorded an ABN only): 354290C via ABN.
 *   ACT 1 — Turnkey, same trading-name search: licence 2012767 via ACN; Walmsley + Constable.
 *   ACT 2 — DEMOLITION BROTHERS (AUST) PTY LTD (ABN stored in licensee_acn): 202039 via ABN.
 *   Person 1 — director-only search "Nickolas Jai Constable" (NSW): his licence 241240C, and
 *           Turnkey (259006C, ACN 155832732) as a linked company from that licence's record.
 *   Person 2 — director-only search "Frank Walmsley" (ACT; he holds no licence): Turnkey as a
 *           linked company via the partners field.
 *
 * Fixtures are real register records as of 2026-10-09 — if one fails with "not found",
 * check the record still exists on the register before assuming a regression.
 *
 * In production NSW goes through the ScrapeOps proxy; with SCRAPEOPS_API_KEY set this test
 * spends roughly 30 credits. Without it (local dev, GitHub Actions) requests go direct.
 */

const path = require('path');
const { searchABN } = require(path.join(__dirname, '../scrapers/abn'));
const { resolveEntityIdentity } = require(path.join(__dirname, '../scrapers/licenceMatching'));
const { fetchNswCompanyLookup, searchNSWFairTrading } = require(path.join(__dirname, '../scrapers/nswFairTrading'));
const { searchACTLicences, resolveActAssociatedNames, resolveActLinkedCompanies } = require(path.join(__dirname, '../scrapers/actLicences'));
const { fetchActLicenceRecords } = require(path.join(__dirname, '../scrapers/actLicencesDataset'));
const { pass, fail, step, header, summary } = require('./lib/helpers');

async function identityFor(abn, typedName) {
  return resolveEntityIdentity({ abn, companyName: typedName }, await searchABN(abn, typedName, ''));
}

function licence(results, number) {
  return results.find((r) => String(r.metadata?.LicenceNumber) === number);
}

(async () => {
  header('Licence matching — identifier-first NSW/ACT live fixtures');
  let passed = 0;
  let failed = 0;
  const check = (label, ok, msg, details) => {
    if (ok) {
      pass(label, msg);
      passed++;
    } else {
      fail(label, msg, details);
      failed++;
    }
  };

  const turnkey = await identityFor('67155832732', 'Canberra Granny Flat Builders');

  step('NSW 1: Turnkey searched as "Canberra Granny Flat Builders"...');
  {
    const primary = await fetchNswCompanyLookup(turnkey);
    const result = await searchNSWFairTrading(turnkey, '', [], primary);
    const company = licence(result.results, '259006C');
    const directors = primary.associatedNames.filter((a) => a.role === 'Director').map((a) => a.name);
    check('NSW 1', company?.metadata.MatchedBy === 'ACN', 'licence 259006C found via ACN', result.results);
    check(
      'NSW 1',
      directors.includes('Nickolas Jai Constable') && directors.includes('Frank Walmsley'),
      'Constable + Walmsley discovered as Directors',
      primary.associatedNames
    );
    check(
      'NSW 1',
      licence(result.results, '241240C')?.metadata.MatchedBy === 'Linked on licence record',
      "Constable's personal licence 241240C linked from the record",
      result.results
    );
  }

  step('NSW 2: Universal Property Group Pty Limited...');
  {
    const id = await identityFor('98078297748', 'Universal Property Group Pty Limited');
    const primary = await fetchNswCompanyLookup(id);
    const roles = primary.associatedNames.map((a) => `${a.name}|${a.role}`);
    check('NSW 2', licence(primary.items, '85273C')?.metadata.MatchedBy === 'ABN', 'licence 85273C found via ABN', primary.items);
    check(
      'NSW 2',
      roles.includes('Bhart Bhushan|Director') && roles.includes('Raj Mohan|Nominated Supervisor'),
      'Bhart Bhushan (Director) + Raj Mohan (Nominated Supervisor)',
      roles
    );
  }

  step('NSW 3: Ardent Builders Pty Ltd (ABN-only NSW record)...');
  {
    const id = await identityFor('84614738751', 'Ardent Builders');
    const primary = await fetchNswCompanyLookup(id);
    check('NSW 3', licence(primary.items, '354290C')?.metadata.MatchedBy === 'ABN', 'licence 354290C found via ABN', primary.items);
  }

  const nobody = resolveEntityIdentity({ companyName: '' }, null);

  step('Person 1: director-only search "Nickolas Jai Constable" (NSW)...');
  {
    const primary = await fetchNswCompanyLookup(nobody, ['Nickolas Jai Constable']);
    check('Person 1', Boolean(licence(primary.items, '241240C')), 'his licence 241240C found', primary.items);
    const turnkeyLink = primary.linkedCompanies.find((c) => c.licenceNumber === '259006C');
    check('Person 1', turnkeyLink?.acn === '155832732', 'Turnkey linked from his licence record, with its ACN', primary.linkedCompanies);
  }

  step('ACT: fetching the ACT licence dataset live (~40s)...');
  let rows;
  try {
    rows = await fetchActLicenceRecords();
  } catch (err) {
    check('ACT', false, `could not fetch the ACT dataset: ${err.message}`);
  }
  if (rows) {
    const read = async () => rows;

    const result = await searchACTLicences(turnkey, '', [], read);
    check('ACT 1', licence(result.results, '2012767')?.metadata.MatchedBy === 'ACN', 'Turnkey licence 2012767 found via ACN', result.results);
    const people = (await resolveActAssociatedNames(turnkey, read)).map((p) => p.name.toUpperCase());
    check(
      'ACT 1',
      people.includes('FRANK WALMSLEY') && people.includes('NICKOLAS JAI CONSTABLE'),
      'Walmsley + Constable from the licence record',
      people
    );

    const demo = await identityFor('54616886321', 'Some Trading Name');
    const demoResult = await searchACTLicences(demo, '', [], read);
    check('ACT 2', licence(demoResult.results, '202039')?.metadata.MatchedBy === 'ABN', 'ABN stored in licensee_acn found via ABN', demoResult.results);

    const linked = await resolveActLinkedCompanies(nobody, ['Frank Walmsley'], read);
    check(
      'Person 2',
      linked.some((c) => c.licenceNumber === '2012767' && c.acn === '155832732'),
      'director-only "Frank Walmsley" → Turnkey via the ACT partners field',
      linked
    );
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
