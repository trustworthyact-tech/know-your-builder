'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  associatedNamesFromDetails,
  linksFromDetails,
  searchNSWFairTrading,
  fetchNswCompanyLookup,
} = require('./nswFairTrading');
const { resolveEntityIdentity } = require('./licenceMatching');

// Shapes mirror Verify NSW's real details payload (componentData.associatedRoles) — see
// LICENCE_MATCHING_PLAN.md finding 2.

test('associatedNamesFromDetails — a "Directors" group with two parties returns both directors', () => {
  const cd = {
    associatedRoles: [
      {
        name: 'Directors',
        parties: [
          { name: 'Nickolas Jai Constable', role: 'Director' },
          { name: 'Frank Walmsley', role: 'Director' },
        ],
      },
      { name: 'Nominated Supervisor', parties: [{ name: 'Nickolas Jai Constable', role: 'Nominated Supervisor' }] },
    ],
  };
  assert.deepEqual(associatedNamesFromDetails(cd), [
    { name: 'Nickolas Jai Constable', role: 'Director' },
    { name: 'Frank Walmsley', role: 'Director' },
    { name: 'Nickolas Jai Constable', role: 'Nominated Supervisor' },
  ]);
});

test('associatedNamesFromDetails — the single-director "Director" group still works', () => {
  const cd = {
    associatedRoles: [
      { name: 'Director', parties: [{ name: 'Bhart Bhushan', role: 'Director' }] },
      { name: 'Nominated Supervisor', parties: [{ name: 'Raj Mohan', role: 'Nominated Supervisor' }] },
    ],
  };
  assert.deepEqual(associatedNamesFromDetails(cd), [
    { name: 'Bhart Bhushan', role: 'Director' },
    { name: 'Raj Mohan', role: 'Nominated Supervisor' },
  ]);
});

test('associatedNamesFromDetails — falls back to the group label when a party has no role', () => {
  const cd = { associatedRoles: [{ name: 'Directors', parties: [{ name: 'A Person' }, { name: 'B Person', role: '' }] }] };
  assert.deepEqual(associatedNamesFromDetails(cd), [
    { name: 'A Person', role: 'Director' },
    { name: 'B Person', role: 'Director' },
  ]);
});

test('associatedNamesFromDetails — ignores unrelated roles and malformed input', () => {
  assert.deepEqual(associatedNamesFromDetails(null), []);
  assert.deepEqual(associatedNamesFromDetails({}), []);
  const cd = { associatedRoles: [{ name: 'Licensee', parties: [{ name: 'Someone', role: 'Licensee' }, { role: 'Director' }] }] };
  assert.deepEqual(associatedNamesFromDetails(cd), []);
});

// ---- search flow — fake _http, no network ----
// Queries are sent normalised (lowercase, company suffix dropped) and digits-only for ABN/ACN.

const hit = (licensee, licenceNumber, licenceId, ids = {}) => ({
  licensee,
  licenceNumber,
  licenceId,
  licenceType: 'Contractor Licence',
  licenceTypeFriendly: 'Contractor',
  status: 'Current',
  expires: '2027-01-01',
  ...ids,
});

function fakeHttp({ searchResults = {}, failQueries = [], details = {} } = {}) {
  const posts = [];
  const gets = [];
  return {
    posts,
    gets,
    post: async (_url, body) => {
      posts.push(body.search);
      if (failQueries.includes(body.search)) throw new Error('connect ETIMEDOUT');
      return { data: { results: searchResults[body.search] || [] } };
    },
    get: async (url) => {
      const id = decodeURIComponent(url.split('/').pop());
      gets.push(id);
      return { data: { componentData: details[id] ?? null } };
    },
  };
}

// ABR shape as returned by abn.js's searchABN for a company with business names.
const turnkeyAbr = {
  results: [{ title: 'TURNKEY CREATIONS PTY LTD', metadata: { 'Entity name': 'TURNKEY CREATIONS PTY LTD', 'Entity type': 'Australian Private Company' } }],
  businessNames: ['Canberra Granny Flat Builders', 'Natures Blanket'],
  tradingNames: [],
};
const turnkey = resolveEntityIdentity(
  { abn: '67 155 832 732', companyName: 'Canberra Granny Flat Builders' },
  turnkeyAbr
);

test('fetchNswCompanyLookup — searches ABN, ACN and legal name, not the typed trading name', async () => {
  const http = fakeHttp();
  await fetchNswCompanyLookup(turnkey, [], http);
  assert.deepEqual(http.posts.sort(), ['155832732', '67155832732', 'turnkey creations']);
});

test('searchNSWFairTrading — a licence recorded only under its ACN is found and marked MatchedBy ACN', async () => {
  const http = fakeHttp({
    searchResults: { 155832732: [hit('Turnkey Creations Pty Ltd', '259006C', 'L1', { ACN: '155832732' })] },
  });
  const primary = await fetchNswCompanyLookup(turnkey, [], http);
  const result = await searchNSWFairTrading(turnkey, '', [], primary, http);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].metadata.MatchedBy, 'ACN');
  assert.equal(result.results[0].metadata.ACN, '155832732');
});

test('searchNSWFairTrading — the same licence found by ACN and by name is listed once', async () => {
  const lic = hit('Turnkey Creations Pty Ltd', '259006C', 'L1', { ACN: '155832732' });
  const http = fakeHttp({ searchResults: { 155832732: [lic], 'turnkey creations': [lic] } });
  const result = await searchNSWFairTrading(turnkey, '', [], undefined, http);
  assert.equal(result.results.length, 1);
  assert.deepEqual(http.gets, ['L1']);
});

test('searchNSWFairTrading — a same-name licence with a different ACN is rejected', async () => {
  const http = fakeHttp({
    searchResults: { 'turnkey creations': [hit('TURNKEY CREATIONS PTY LTD', '1X', 'L2', { ACN: '999999999' })] },
  });
  const result = await searchNSWFairTrading(turnkey, '', [], undefined, http);
  assert.equal(result.results.length, 0);
});

test('searchNSWFairTrading — a name match with no identifiers is kept as name-only', async () => {
  const http = fakeHttp({ searchResults: { 'natures blanket': [hit('NATURES BLANKET P/L', '2X', 'L3')] } });
  const result = await searchNSWFairTrading(turnkey, '', [], undefined, http);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].metadata.MatchedBy, 'Name only — verify');
});

test('searchNSWFairTrading — free-text noise matching neither identifiers nor names is dropped', async () => {
  const http = fakeHttp({ searchResults: { 155832732: [hit('SOMEONE ELSE PTY LTD', '3X', 'L4', { ACN: '123123123' })] } });
  const result = await searchNSWFairTrading(turnkey, '', [], undefined, http);
  assert.equal(result.results.length, 0);
});

test('searchNSWFairTrading — business names are searched, capped at 10, and person names are not', async () => {
  const many = { ...turnkeyAbr, businessNames: Array.from({ length: 12 }, (_, i) => `Brand Number${i}`) };
  const identity = resolveEntityIdentity({ abn: '67155832732', companyName: 'Turnkey Creations Pty Ltd' }, many);
  const http = fakeHttp();
  await searchNSWFairTrading(identity, '', ['Jane Citizen'], undefined, http);
  const brandQueries = http.posts.filter((q) => q.startsWith('brand'));
  assert.equal(brandQueries.length, 10);
  assert.ok(!http.posts.includes('jane citizen'));
});

test('searchNSWFairTrading — directors and their linked personal licences come from the licence record', async () => {
  const http = fakeHttp({
    searchResults: { 155832732: [hit('Turnkey Creations Pty Ltd', '259006C', 'L1', { ACN: '155832732' })] },
    details: {
      L1: {
        associatedRoles: [
          {
            name: 'Directors',
            parties: [
              {
                name: 'Nickolas Jai Constable',
                role: 'Director',
                licences: [{ licenceNumber: '241240C', licenceType: 'Contractor Licence', licenceID: 'P1', status: 'Expired', expiry: '2015-09-29T00:00:00', licensee: 'Nickolas Jai Constable' }],
              },
              { name: 'Frank Walmsley', role: 'Director' },
            ],
          },
        ],
      },
    },
  });
  const primary = await fetchNswCompanyLookup(turnkey, [], http);
  assert.deepEqual(primary.associatedNames.map((a) => `${a.name}|${a.confidence}`), [
    'Nickolas Jai Constable|confirmed',
    'Frank Walmsley|confirmed',
  ]);
  const result = await searchNSWFairTrading(turnkey, '', [], primary, http);
  assert.equal(result.results[0].metadata.Director, 'Nickolas Jai Constable; Frank Walmsley');
  const personal = result.results.find((r) => r.metadata.LicenceNumber === '241240C');
  assert.equal(personal.metadata.MatchedBy, 'Linked on licence record');
  assert.equal(personal.metadata.LinkedVia, 'Director on licence 259006C');
  assert.equal(personal.date, '2015-09-29');
});

test('linksFromDetails — splits a person\'s own licences from company licences they hold a role on', () => {
  const own = { licenceNumber: '1', licenceType: 'Contractor Licence', licenceID: 'P1', role: 'Licensee' };
  const company = { licenceNumber: '2', licenceType: 'Contractor Licence', licenceID: 'C2', role: 'Nominated Supervisor', licensee: 'Other Co Pty Ltd' };
  const cd = {
    associatedRoles: [
      { name: 'Directors', parties: [{ name: 'A', role: 'Director', licences: [own, company] }] },
      { name: 'Nominated supervisor', parties: [{ name: 'A', role: 'Nominated Supervisor', licences: [own] }] },
      { name: 'Licensee', parties: [{ name: 'Co', role: 'Licensee', partyType: 'Organisation', licences: [{ ...own, licenceID: 'X' }] }] },
    ],
  };
  const { personal, companies } = linksFromDetails(cd, 'SELF');
  assert.deepEqual(personal.map((l) => l.licenceID), ['P1']);
  assert.deepEqual(companies.map((l) => [l.licenceID, l.companyRole]), [['C2', 'Nominated Supervisor']]);
});

test('linksFromDetails — on a personal licence record, the individual "Licensee" party\'s company roles are links', () => {
  const cd = {
    associatedRoles: [
      {
        name: 'Licensee',
        parties: [
          {
            name: 'Nickolas Jai Constable',
            role: 'Licensee',
            partyType: 'Individual',
            licences: [{ licenceNumber: '259006C', licenceType: 'Contractor Licence', licenceID: 'T1', role: 'Nominated Supervisor', licensee: 'Turnkey Creations Pty Ltd' }],
          },
        ],
      },
    ],
  };
  assert.deepEqual(linksFromDetails(cd, 'P1').companies.map((c) => c.licensee), ['Turnkey Creations Pty Ltd']);
});

test('director-only search — searches the typed person, finds their licence and the company it links to', async () => {
  const personal = { licenceId: 'P1', licenceNumber: '241240C', licenceType: 'Contractor Licence', licensee: 'Nickolas Jai Constable', licenseeType: 'Individual', status: 'Expired', expires: '2015-09-29' };
  const http = fakeHttp({
    searchResults: { 'Nickolas Jai Constable': [personal, hit('CONSTABLE BUILDERS PTY LTD', '9Z', 'Q9', { licenseeType: 'Organisation' })] },
    details: {
      P1: {
        associatedRoles: [
          {
            name: 'Licensee',
            parties: [
              {
                name: 'Nickolas Jai Constable',
                role: 'Licensee',
                partyType: 'Individual',
                licences: [{ licenceNumber: '259006C', licenceType: 'Contractor Licence', licenceID: 'T1', role: 'Nominated Supervisor', licensee: 'Turnkey Creations Pty Ltd', status: 'Cancelled' }],
              },
            ],
          },
        ],
      },
      T1: { ACN: '155832732' },
    },
  });
  const identity = resolveEntityIdentity({ companyName: '' }, null);
  const primary = await fetchNswCompanyLookup(identity, ['Nickolas Jai Constable'], http);
  assert.deepEqual(http.posts, ['Nickolas Jai Constable']);
  assert.deepEqual(primary.linkedCompanies.map((c) => [c.name, c.acn, c.confidence]), [['Turnkey Creations Pty Ltd', '155832732', 'name-only']]);
  const result = await searchNSWFairTrading(identity, '', ['Nickolas Jai Constable'], primary, http);
  assert.deepEqual(result.results.map((r) => [r.metadata.LicenceNumber, r.metadata.MatchedBy]), [
    ['241240C', 'Name only — verify'],
    ['259006C', 'Name only — verify'],
  ]);
});

test('company search — a director\'s personal licence linking to another company yields a confirmed linked company', async () => {
  const http = fakeHttp({
    searchResults: { 155832732: [hit('Turnkey Creations Pty Ltd', '259006C', 'L1', { ACN: '155832732' })] },
    details: {
      L1: { associatedRoles: [{ name: 'Directors', parties: [{ name: 'Frank Walmsley', role: 'Director', licences: [{ licenceNumber: '5P', licenceType: 'Contractor Licence', licenceID: 'P5', role: 'Licensee', licensee: 'Frank Walmsley' }] }] }] },
      P5: { associatedRoles: [{ name: 'Licensee', parties: [{ name: 'Frank Walmsley', role: 'Licensee', partyType: 'Individual', licences: [
        { licenceNumber: '259006C', licenceType: 'Contractor Licence', licenceID: 'L1', role: 'Director', licensee: 'Turnkey Creations Pty Ltd' },
        { licenceNumber: '777C', licenceType: 'Contractor Licence', licenceID: 'O7', role: 'Director', licensee: 'Old Builds Pty Ltd' },
      ] }] }] },
      O7: { ACN: '111222333' },
    },
  });
  const primary = await fetchNswCompanyLookup(turnkey, [], http);
  assert.deepEqual(primary.linkedCompanies.map((c) => [c.name, c.confidence, c.via]), [['Old Builds Pty Ltd', 'confirmed', 'Frank Walmsley (Director)']]);
  const item = primary.items.find((i) => i.metadata.LicenceNumber === '777C');
  assert.equal(item.metadata.MatchedBy, 'Linked company — via Frank Walmsley');
});

test('searchNSWFairTrading — nothing to search under is unavailable, never "no licence"', async () => {
  const http = fakeHttp();
  const result = await searchNSWFairTrading(resolveEntityIdentity({ companyName: '' }, null), '', [], undefined, http);
  assert.equal(result.status, 'error');
  assert.equal(result.completeness, 'unavailable');
});

// ---- failure reporting (Phase 1.2) ----

test('searchNSWFairTrading — every search failing is an error/unavailable, not "no licence"', async () => {
  const http = fakeHttp({ failQueries: ['acme builders'] });
  const result = await searchNSWFairTrading('Acme Builders Pty Ltd', '', [], undefined, http);
  assert.equal(result.status, 'error');
  assert.equal(result.completeness, 'unavailable');
  assert.equal(result.results.length, 0);
  assert.doesNotMatch(result.summary, /^No NSW contractor licence/);
});

test('searchNSWFairTrading — some searches failing with nothing found is partial', async () => {
  const http = fakeHttp({ failQueries: ['natures blanket'] });
  const result = await searchNSWFairTrading(turnkey, '', [], undefined, http);
  assert.equal(result.status, undefined);
  assert.equal(result.completeness, 'partial');
  assert.equal(result.summary, 'NSW licence lookup failed for 1 of 5 search(es) — verify manually');
});

test('searchNSWFairTrading — a genuine empty result stays complete', async () => {
  const http = fakeHttp();
  const result = await searchNSWFairTrading('Acme Builders Pty Ltd', '', [], undefined, http);
  assert.equal(result.completeness, undefined);
  assert.equal(result.summary, 'No NSW contractor licence found under this name');
});

test('searchNSWFairTrading — with an ABN, a clean result says "linked to this ABN", not a pass', async () => {
  const result = await searchNSWFairTrading(turnkey, '', [], undefined, fakeHttp());
  assert.equal(result.summary, 'No NSW contractor licence linked to this ABN found (searched by ABN, ACN and name)');
});

test('searchNSWFairTrading — the summary counts name-only matches', async () => {
  const http = fakeHttp({
    searchResults: {
      155832732: [hit('Turnkey Creations Pty Ltd', '259006C', 'L1', { ACN: '155832732' })],
      'natures blanket': [hit('NATURES BLANKET P/L', '2X', 'L3')],
    },
  });
  const result = await searchNSWFairTrading(turnkey, '', [], undefined, http);
  assert.equal(result.summary, '2 NSW contractor licence record(s) found (1 matched by name only — verify)');
});

test('searchNSWFairTrading — one failed query keeps found records but marks partial', async () => {
  const http = fakeHttp({
    searchResults: { 155832732: [hit('Turnkey Creations Pty Ltd', '259006C', 'L1', { ACN: '155832732' })] },
    failQueries: ['natures blanket'],
  });
  const result = await searchNSWFairTrading(turnkey, '', [], undefined, http);
  assert.equal(result.results.length, 1);
  assert.equal(result.completeness, 'partial');
  assert.match(result.summary, /^1 NSW contractor licence record\(s\) found; NSW licence lookup failed for 1 of 5/);
});

test('searchNSWFairTrading — a failed discovery result is re-queried, not reused as empty', async () => {
  const http = fakeHttp({ searchResults: { 'acme builders': [hit('ACME BUILDERS PTY LTD', '123A', 'L1')] } });
  // Shape of searchOrchestrator.js's 20s-timeout fallback.
  const timedOut = { items: [], associatedNames: [], failed: true };
  const result = await searchNSWFairTrading('Acme Builders Pty Ltd', '', [], timedOut, http);
  assert.deepEqual(http.posts, ['acme builders']);
  assert.equal(result.results.length, 1);
  assert.equal(result.completeness, undefined);
});

test('searchNSWFairTrading — a successful discovery result is reused without re-querying', async () => {
  const http = fakeHttp({ searchResults: { 'acme builders': [hit('ACME BUILDERS PTY LTD', '123A', 'L1')] } });
  const primary = await fetchNswCompanyLookup('Acme Builders Pty Ltd', [], http);
  assert.equal(primary.failed, false);
  http.posts.length = 0;
  const result = await searchNSWFairTrading('Acme Builders Pty Ltd', '', [], primary, http);
  assert.deepEqual(http.posts, []);
  assert.equal(result.results.length, 1);
});
