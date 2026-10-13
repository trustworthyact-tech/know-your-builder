'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normaliseEntityName,
  searchableName,
  makeNameMatcher,
  parseTrustName,
  resolveEntityIdentity,
  entityNames,
  identifiersMatch,
  classifyMatch,
  buildTermProvenance,
  labelResultsByTerm,
  licenceSummary,
  NAME_ONLY,
} = require('./licenceMatching');
const { searchACTLicences, searchACTDisciplinary, resolveActAssociatedNames, resolveActLinkedCompanies } = require('./actLicences');

const abr = (name, entityType, businessNames = []) => ({
  results: [{ title: name, metadata: { 'Entity name': name, 'Entity type': entityType } }],
  businessNames,
  tradingNames: [],
});

// ---- names ----

test('normaliseEntityName — suffix variants, brackets, & and punctuation', () => {
  assert.equal(normaliseEntityName('ALFRED BUILDERS (AUST) P/L'), 'alfred builders pty ltd');
  assert.equal(normaliseEntityName('Universal Property Group Pty Limited'), 'universal property group pty ltd');
  assert.equal(normaliseEntityName('Smith Proprietary Limited'), 'smith pty ltd');
  assert.equal(normaliseEntityName('A & B Pty. Ltd.'), 'a and b pty ltd');
  assert.equal(normaliseEntityName('Geocon Constructors (ACT) Pty Ltd'), 'geocon constructors pty ltd');
});

test('searchableName — drops the company suffix for register free-text search', () => {
  assert.equal(searchableName('TURNKEY CREATIONS PTY LTD'), 'turnkey creations');
  assert.equal(searchableName('Universal Property Group Pty Limited'), 'universal property group');
  assert.equal(searchableName('ALFRED BUILDERS (AUST) P/L'), 'alfred builders');
});

test('makeNameMatcher — "P/L" record matches a "Pty Ltd" query; whole words only', () => {
  const m = makeNameMatcher('Alfred Builders (Aust) Pty Ltd');
  assert.equal(m('ALFRED BUILDERS (AUST) P/L'), true);
  assert.equal(m('ALFREDO BUILDERS PTY LTD'), false);
  assert.equal(makeNameMatcher('BHP')('BHP GROUP LIMITED'), true);
  assert.equal(makeNameMatcher('Pty Ltd')('Anything Pty Ltd'), false);
});

test('parseTrustName — "The Trustee for X" → X', () => {
  assert.equal(parseTrustName('The Trustee for the Smith Family Trust'), 'Smith Family Trust');
  assert.equal(parseTrustName('THE TRUSTEE FOR BROCKWELL FAMILY TRUST'), 'BROCKWELL FAMILY TRUST');
  assert.equal(parseTrustName('TURNKEY CREATIONS PTY LTD'), '');
});

// ---- identity ----

test('resolveEntityIdentity — a company gets its ACN from the last 9 ABN digits; legal name replaces a typed trading name', () => {
  const id = resolveEntityIdentity(
    { abn: '67 155 832 732', companyName: 'Canberra Granny Flat Builders' },
    abr('TURNKEY CREATIONS PTY LTD', 'Australian Private Company', ['Canberra Granny Flat Builders', 'Natures Blanket'])
  );
  assert.equal(id.legalName, 'TURNKEY CREATIONS PTY LTD');
  assert.equal(id.abn, '67155832732');
  assert.equal(id.acn, '155832732');
  assert.equal(id.possibleAcn, '');
  assert.deepEqual(id.businessNames, ['Canberra Granny Flat Builders', 'Natures Blanket']);
  assert.deepEqual(entityNames(id), ['TURNKEY CREATIONS PTY LTD', 'Canberra Granny Flat Builders', 'Natures Blanket']);
});

test('resolveEntityIdentity — a trust gets no derived ACN, and its trust name', () => {
  const id = resolveEntityIdentity(
    { abn: '12345678901', companyName: 'x' },
    abr('The Trustee for the Smith Family Trust', 'Discretionary Trading Trust')
  );
  assert.equal(id.acn, '');
  assert.equal(id.possibleAcn, '');
  assert.equal(id.trustName, 'Smith Family Trust');
});

test('resolveEntityIdentity — no ABR record: typed name, and the ABN tail as a confirm-only possible ACN', () => {
  const id = resolveEntityIdentity({ abn: '67155832732', companyName: 'Turnkey Creations Pty Ltd' }, null);
  assert.equal(id.legalName, '');
  assert.equal(id.acn, '');
  assert.equal(id.possibleAcn, '155832732');
  assert.deepEqual(entityNames(id), ['Turnkey Creations Pty Ltd']);
});

test('resolveEntityIdentity — a user-supplied ACN wins', () => {
  const id = resolveEntityIdentity({ acn: '155 832 732', companyName: 'Turnkey' }, null);
  assert.equal(id.acn, '155832732');
});

// ---- classification ----

const turnkey = resolveEntityIdentity(
  { abn: '67155832732', companyName: 'Turnkey Creations' },
  abr('TURNKEY CREATIONS PTY LTD', 'Australian Private Company')
);
const matchers = entityNames(turnkey).map(makeNameMatcher);

test('identifiersMatch — ABN or ACN in either field, spaced or not', () => {
  assert.equal(identifiersMatch(['155 832 732'], turnkey), true);
  assert.equal(identifiersMatch(['67 155 832 732'], turnkey), true); // ABN in an ACN field
  assert.equal(identifiersMatch([undefined, '155832732'], turnkey), true);
  assert.equal(identifiersMatch(['123456789'], turnkey), false);
});

test('classifyMatch — identifiers match → confirmed, even with a different name', () => {
  assert.deepEqual(classifyMatch({ identifiers: ['155832732'], names: ['Something Else'] }, turnkey, matchers), {
    match: 'confirmed',
    matchedBy: 'ACN',
  });
  assert.equal(classifyMatch({ identifiers: ['67155832732'], names: [] }, turnkey, matchers).matchedBy, 'ABN');
});

test('classifyMatch — ACN in the ABN field confirms by ACN', () => {
  assert.equal(classifyMatch({ identifiers: ['155832732', ''], names: [] }, turnkey, matchers).matchedBy, 'ACN');
});

test('classifyMatch — same name, different identifiers → rejected', () => {
  assert.equal(
    classifyMatch({ identifiers: ['999999999'], names: ['TURNKEY CREATIONS PTY LTD'] }, turnkey, matchers).match,
    'rejected'
  );
});

test('classifyMatch — same name, no identifiers → name-only', () => {
  assert.deepEqual(classifyMatch({ identifiers: [], names: ['Turnkey Creations P/L'] }, turnkey, matchers), {
    match: 'name-only',
    matchedBy: NAME_ONLY,
  });
});

test('classifyMatch — a trust with only an ABN is not rejected by its trustee company\'s ACN', () => {
  const trust = resolveEntityIdentity(
    { abn: '11222333444', companyName: 'x' },
    abr('The Trustee for Brockwell Family Trust', 'Discretionary Trading Trust')
  );
  const m = entityNames(trust).map(makeNameMatcher);
  assert.equal(
    classifyMatch({ identifiers: ['007129384'], names: ['Brolec Pty Ltd as Trustee for the Brockwell Family Trust'] }, trust, m).match,
    'name-only'
  );
});

test('classifyMatch — unrelated record → null', () => {
  assert.equal(classifyMatch({ identifiers: ['123123123'], names: ['Other Co'] }, turnkey, matchers).match, null);
});

// ---- ACT (local matching against cached rows) ----

const actRows = [
  { occupation: 'Builder', surname: 'TURNKEY CREATIONS PTY LTD', licensee_acn: '155 832 732', cola_licence_number: '2012767', partners: 'FRANK WALMSLEY', nominees: 'NICKOLAS JAI CONSTABLE: 20091091-Builder-Class B' },
  { occupation: 'Builder', surname: 'DEMOLITION BROTHERS (AUST) PTY LTD', licensee_acn: '54616886321', cola_licence_number: '202039' },
  { occupation: 'Builder', surname: 'TURNKEY CREATIONS PTY LTD', licensee_acn: '999999999', cola_licence_number: 'OTHER' },
  { occupation: 'Builder', surname: 'NATURES BLANKET', cola_licence_number: 'NB1', partners: 'SOMEONE UNSURE' },
  { occupation: 'Builder', surname: 'CONSTABLE', given_names: 'NICKOLAS JAI', cola_licence_number: '20091091' },
  { occupation: 'Builder', surname: 'WALMSLEY', given_names: 'FRANK', cola_licence_number: '30000001' },
  { occupation: 'Builder', surname: 'OLD BUILDS PTY LTD', licensee_acn: '111 222 333', cola_licence_number: 'OB1', partners: 'FRANK WALMSLEY;ANITA WALMSLEY' },
  { occupation: 'Builder', surname: 'NOMINEE CO PTY LTD', licensee_acn: '444555666', cola_licence_number: 'NC1', nominees: 'N J CONSTABLE: 20091091-Builder-Class C' },
  { occupation: 'Builder', surname: 'WALMSLEY ARKADE PTY LTD', cola_licence_number: 'WA1', partners: 'ANITA WALMSLEY' },
  { occupation: 'Electrician', surname: 'TURNKEY CREATIONS PTY LTD', licensee_acn: '155832732', cola_licence_number: 'E1' },
];
const readRows = async () => ({ records: actRows });
const turnkeyWithBrands = resolveEntityIdentity(
  { abn: '67155832732', companyName: 'Canberra Granny Flat Builders' },
  abr('TURNKEY CREATIONS PTY LTD', 'Australian Private Company', ['Natures Blanket'])
);

test('searchACTLicences — ACN match, name-only business name, rejected same-name ACN, people and linked companies', async () => {
  const result = await searchACTLicences(turnkeyWithBrands, '', ['Nickolas Jai Constable', 'Frank Walmsley'], readRows);
  const byNumber = Object.fromEntries(result.results.map((r) => [r.metadata.LicenceNumber, r.metadata.MatchedBy]));
  assert.deepEqual(byNumber, {
    2012767: 'ACN',
    NB1: NAME_ONLY,
    // Constable's licence number is a nominee number on Turnkey's confirmed licence.
    20091091: 'Linked on licence record',
    // Walmsley's is matched by name only.
    30000001: NAME_ONLY,
    // Walmsley is a listed partner — a name link.
    OB1: NAME_ONLY,
    // Tied by Constable's confirmed licence number in its nominees field.
    NC1: 'Linked company — via Nickolas Jai Constable',
  });
  assert.equal(result.results.find((r) => r.metadata.LicenceNumber === 'OB1').metadata.LinkedVia, 'Frank Walmsley (Partner)');
});

test('resolveActLinkedCompanies — other companies people appear on, never the entity itself or another same-surname person', async () => {
  const linked = await resolveActLinkedCompanies(turnkeyWithBrands, ['Nickolas Jai Constable', 'Frank Walmsley'], readRows);
  assert.deepEqual(
    linked.map((c) => [c.name, c.acn, c.confidence]).sort(),
    [
      ['NOMINEE CO PTY LTD', '444555666', 'confirmed'],
      ['OLD BUILDS PTY LTD', '111222333', 'name-only'],
    ]
  );
});

test('searchACTLicences — an ABN stored in licensee_acn is found via ABN', async () => {
  const id = resolveEntityIdentity(
    { abn: '54616886321', companyName: 'Some Trading Name' },
    abr('DEMOLITION BROTHERS (AUST) PTY LTD', 'Australian Private Company')
  );
  const result = await searchACTLicences(id, '', [], readRows);
  assert.deepEqual(result.results.map((r) => [r.metadata.LicenceNumber, r.metadata.MatchedBy]), [['202039', 'ABN']]);
});

test('resolveActAssociatedNames — people tagged by the confidence of their licence match', async () => {
  const names = await resolveActAssociatedNames(turnkeyWithBrands, readRows);
  assert.deepEqual(names, [
    { name: 'FRANK WALMSLEY', role: 'Partner', confidence: 'confirmed' },
    { name: 'NICKOLAS JAI CONSTABLE', role: 'Nominee', confidence: 'confirmed' },
    { name: 'SOMEONE UNSURE', role: 'Partner', confidence: 'name-only' },
  ]);
});

test('searchACTDisciplinary — a_c_n match without a name match; plain name string still works', async () => {
  const rows = [
    { occupation: 'Builder', licensee_name: 'Renamed Co Pty Ltd', a_c_n: '155832732', licence_number: '1', action_date: 'd', action_type: 'Suspension' },
    { occupation: 'Builder', licensee_name: 'KEGGINS INDUSTRIAL PTY LTD', a_c_n: '', licence_number: '2', action_date: 'd', action_type: 'Suspension' },
  ];
  const read = async () => ({ records: rows });
  const a = await searchACTDisciplinary(turnkey, '', [], read);
  assert.deepEqual(a.results.map((r) => r.metadata.MatchedBy), ['ACN']);
  const b = await searchACTDisciplinary('KEGGINS INDUSTRIAL PTY LTD', '', [], read);
  assert.deepEqual(b.results.map((r) => r.metadata.MatchedBy), [NAME_ONLY]);
});

test('searchACTDisciplinary — linked companies: confirmed only for a confirmed link matched by identifier', async () => {
  const rows = [
    { occupation: 'Builder', licensee_name: 'Old Builds Pty Ltd', a_c_n: '111222333', licence_number: '7', action_date: 'd', action_type: 'Cancellation' },
    { occupation: 'Builder', licensee_name: 'Other Link Pty Ltd', a_c_n: '', licence_number: '8', action_date: 'd', action_type: 'Reprimand' },
  ];
  const linked = [
    { name: 'OLD BUILDS PTY LTD', acn: '111222333', abn: '', person: 'Frank Walmsley', via: 'Frank Walmsley (Director)', confidence: 'confirmed' },
    { name: 'OTHER LINK PTY LTD', acn: '', abn: '', via: 'Frank Walmsley (Partner)', confidence: 'name-only' },
  ];
  const result = await searchACTDisciplinary(turnkey, '', [], async () => ({ records: rows }), linked);
  assert.deepEqual(result.results.map((r) => r.metadata.MatchedBy), [
    'Linked company — via Frank Walmsley',
    NAME_ONLY,
  ]);
});

// ---- report provenance (Phase 3) ----

test('labelResultsByTerm — court/FWO hits labelled by the name that found them', () => {
  const provenance = buildTermProvenance({
    companyName: 'Canberra Granny Flat Builders',
    identity: turnkeyWithBrands,
    typedPeople: [],
    discoveredPeople: [
      { name: 'Frank Walmsley', confidence: 'confirmed' },
      { name: 'Someone Unsure', confidence: 'name-only' },
    ],
    linkedCompanies: [
      { name: 'OLD BUILDS PTY LTD', person: 'Frank Walmsley', via: 'Frank Walmsley (Director)', confidence: 'confirmed' },
      { name: 'Maybe Co Pty Ltd', person: 'Frank Walmsley', via: 'Frank Walmsley (Partner)', confidence: 'name-only' },
    ],
  });
  const result = labelResultsByTerm(
    {
      results: [
        { title: 'A v Turnkey', matchedTerm: 'TURNKEY CREATIONS' },
        { title: 'B v Walmsley', matchedTerm: 'Frank Walmsley' },
        { title: 'C v Unsure', matchedTerm: 'Someone Unsure' },
        { title: 'D v Old Builds', matchedTerm: 'OLD BUILDS' },
        { title: 'E v Maybe', matchedTerm: 'Maybe Co' },
        { title: 'no term' },
      ],
    },
    provenance
  );
  const meta = Object.fromEntries(result.results.map((r) => [r.title, r.metadata]));
  assert.deepEqual(meta['A v Turnkey'], { FoundBySearching: 'TURNKEY CREATIONS' });
  assert.deepEqual(meta['B v Walmsley'], { FoundBySearching: 'Frank Walmsley' });
  assert.equal(meta['C v Unsure'].MatchedBy, NAME_ONLY);
  assert.equal(meta['D v Old Builds'].MatchedBy, 'Linked company — via Frank Walmsley');
  assert.equal(meta['D v Old Builds'].LinkedCompany, 'OLD BUILDS PTY LTD');
  assert.equal(meta['E v Maybe'].MatchedBy, NAME_ONLY);
  assert.equal(meta['E v Maybe'].LinkedCompany, 'Maybe Co Pty Ltd');
  assert.equal(meta['no term'], undefined);
});

test('buildTermProvenance — the entity\'s own names and confirmed people win over weaker readings', () => {
  const provenance = buildTermProvenance({
    companyName: 'Turnkey Creations',
    identity: turnkey,
    discoveredPeople: [
      { name: 'Frank Walmsley', confidence: 'name-only' },
      { name: 'Frank Walmsley', confidence: 'confirmed' },
    ],
    linkedCompanies: [{ name: 'Turnkey Creations Pty Ltd', confidence: 'confirmed' }],
  });
  assert.equal(provenance.get('turnkey creations').kind, 'entity');
  assert.equal(provenance.get('frank walmsley').confidence, 'confirmed');
});

test('licenceSummary — wording depends on whether there was an ABN', () => {
  const words = { found: 'X record(s)', none: 'X licence' };
  assert.equal(licenceSummary([], turnkey, words), 'No X licence linked to this ABN found (searched by ABN, ACN and name)');
  assert.equal(licenceSummary([], resolveEntityIdentity({ companyName: '' }, null), words), 'No X licence found under this name');
  assert.equal(
    licenceSummary([{ metadata: { MatchedBy: 'ACN' } }, { metadata: { MatchedBy: NAME_ONLY } }], turnkey, words),
    '2 X record(s) found (1 matched by name only — verify)'
  );
});

// DATA_SOURCES_PLAN.md 1.4 — ABR-outage identity fallback and former names as entity terms.
const { withAsicIdentityFallback, buildTermProvenance: buildProvenance } = require('./licenceMatching');

const asicCompany = {
  current: { 'Company Name': 'TURNKEY CREATIONS PTY LTD', ACN: '155832732' },
  formerNames: ['FAW HOLDINGS PTY LTD'],
};

test('withAsicIdentityFallback — fills legal name and ACN when the ABR gave nothing', () => {
  const identity = resolveEntityIdentity({ abn: '67155832732', companyName: 'Turnkey' }, null);
  assert.equal(identity.legalName, '');
  const out = withAsicIdentityFallback(identity, asicCompany);
  assert.equal(out.legalName, 'TURNKEY CREATIONS PTY LTD');
  assert.equal(out.acn, '155832732');
  assert.equal(out.possibleAcn, '');
  assert.match(out.entityType, /Company/);
  assert.match(out.identitySource, /ABR unavailable/);
  assert.deepEqual(out.businessNames, [], 'business names still need the ABR');
});

test('withAsicIdentityFallback — leaves an ABR-resolved identity, or a missing ASIC record, untouched', () => {
  const abr = resolveEntityIdentity({ abn: '67155832732' }, { results: [{ title: 'TURNKEY CREATIONS PTY LTD', metadata: { 'Entity type': 'Australian Private Company' } }] });
  assert.equal(withAsicIdentityFallback(abr, asicCompany), abr);
  const bare = resolveEntityIdentity({ abn: '67155832732' }, null);
  assert.equal(withAsicIdentityFallback(bare, null), bare);
});

test('buildTermProvenance — former names are the entity\'s own names', () => {
  const identity = resolveEntityIdentity({ abn: '67155832732', companyName: 'Turnkey Creations' }, null);
  const map = buildProvenance({ companyName: 'Turnkey Creations', identity, formerNames: ['FAW HOLDINGS PTY LTD'] });
  assert.deepEqual(map.get(searchableName('FAW HOLDINGS PTY LTD')), { kind: 'entity' });
});

test('entityNames — includes former names when the identity carries them, deduped', () => {
  const identity = { ...resolveEntityIdentity({ companyName: 'Turnkey Creations Pty Ltd' }, null), formerNames: ['FAW Holdings Pty Ltd', 'Turnkey Creations Pty Ltd'] };
  assert.deepEqual(entityNames(identity), ['Turnkey Creations Pty Ltd', 'FAW Holdings Pty Ltd']);
});

test('normaliseEntityName — zero-width characters are removed, even inside a word', () => {
  assert.equal(normaliseEntityName('​​Imam Holdings Pty Ltd​'), 'imam holdings pty ltd');
  assert.equal(normaliseEntityName('Im​am Hold﻿ings P/L'), 'imam holdings pty ltd');
  assert.ok(makeNameMatcher('Imam Holdings Pty Ltd')('IM​AM HOLDINGS PTY LTD'));
});
