'use strict';

// ASIC company record from the Company Dataset's live DataStore API (DATA_SOURCES_PLAN.md 1.3).
// Network-free: every test injects a fake `_http` whose get() answers DataStore queries from a
// fixture keyed by the filter or full-text query it receives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { searchASIC, lookupAsicCompany } = require('./asic');
const { NAME_ONLY, resolveEntityIdentity } = require('./licenceMatching');

const row = (name, acn, extra = {}) => ({
  'Company Name': name,
  ACN: acn,
  Type: 'APTY',
  Class: 'LMSH',
  'Sub Class': 'PROP',
  Status: 'REGD',
  'Date of Registration': '21/02/2012',
  'Date of Deregistration': null,
  'Current Name Indicator': null,
  ABN: `67${acn}`,
  'Current Name': null,
  'Current Name Start Date': null,
  ...extra,
});

// Turnkey's real shape (checked live 2026-10-12): two former names, each pointing at the current one.
const TURNKEY = [
  row('FAW HOLDINGS PTY LTD', '155832732', { 'Current Name': 'TURNKEY CREATIONS PTY LTD', 'Current Name Start Date': '01/07/2015' }),
  row('A.C.N. 155 832 732 PTY LTD', '155832732', { 'Current Name': 'TURNKEY CREATIONS PTY LTD', 'Current Name Start Date': '01/07/2015' }),
  row('TURNKEY CREATIONS PTY LTD', '155832732', { 'Current Name Indicator': 'Y' }),
];

function fakeHttp(answer) {
  const calls = [];
  return {
    calls,
    async get(url, { params }) {
      calls.push(params);
      const result = answer(params);
      if (result instanceof Error) throw result;
      return { data: { success: true, result: { records: result } } };
    },
  };
}

const byFilter = (table) => (params) => {
  if (params.filters) {
    const [[field, value]] = Object.entries(JSON.parse(params.filters));
    return table[`${field}:${value}`] ?? [];
  }
  return table[`q:${params.q}`] ?? [];
};

const companyIdentity = (abn = '67155832732') =>
  resolveEntityIdentity({ abn }, { results: [{ title: 'TURNKEY CREATIONS PTY LTD', metadata: { 'Entity type': 'Australian Private Company' } }] });

test('ACN lookup returns the current record, a plain-words status and the former names', async () => {
  const http = fakeHttp(byFilter({ 'ACN:155832732': TURNKEY }));
  const out = await searchASIC(companyIdentity(), { _http: http });
  assert.equal(out.results.length, 1);
  const [item] = out.results;
  assert.equal(item.title, 'TURNKEY CREATIONS PTY LTD');
  assert.equal(item.status, 'Registered');
  assert.equal(item.metadata.ACN, '155832732');
  assert.equal(item.metadata.Type, 'Australian proprietary company');
  assert.equal(item.metadata.MatchedBy, 'ACN');
  assert.equal(item.metadata['Former names'], 'FAW HOLDINGS PTY LTD; A.C.N. 155 832 732 PTY LTD');
  assert.deepEqual(out.formerNames, ['FAW HOLDINGS PTY LTD', 'A.C.N. 155 832 732 PTY LTD']);
  assert.match(out.summary, /status: Registered/);
});

test('ASIC status codes become the words riskGrouper checks — EXAD is external administration', async () => {
  const http = fakeHttp(byFilter({ 'ACN:078297748': [row('UNIVERSAL PROPERTY GROUP PTY LIMITED', '078297748', { Status: 'EXAD', 'Current Name Indicator': 'Y' })] }));
  const identity = resolveEntityIdentity({ abn: '98078297748', acn: '078297748' }, null);
  const out = await searchASIC(identity, { _http: http });
  assert.equal(out.results[0].status, 'External administration');
});

test('an unknown status code is shown as-is, never dropped', async () => {
  const http = fakeHttp(byFilter({ 'ACN:155832732': [row('X PTY LTD', '155832732', { Status: 'ZZZZ', 'Current Name Indicator': 'Y' })] }));
  const out = await searchASIC(companyIdentity(), { _http: http });
  assert.equal(out.results[0].status, 'ZZZZ');
});

test('falls back to the ABN column when the ACN finds nothing', async () => {
  const http = fakeHttp(byFilter({ 'ABN:67155832732': TURNKEY }));
  const out = await searchASIC(companyIdentity(), { _http: http });
  assert.equal(out.results[0].metadata.MatchedBy, 'ABN');
  assert.deepEqual(http.calls.map((c) => Object.keys(JSON.parse(c.filters))[0]), ['ACN', 'ABN']);
});

test('no record for a known company ACN is reported as not found, with the ACN', async () => {
  const http = fakeHttp(() => []);
  const out = await searchASIC(companyIdentity(), { _http: http });
  assert.deepEqual(out.results, []);
  assert.equal(out.status, undefined);
  assert.match(out.summary, /No ASIC company record found for ACN 155832732/);
});

test('a failed lookup is retried once, then reported as unavailable — never as "not found"', async () => {
  const http = fakeHttp(() => new Error('socket hang up'));
  const out = await searchASIC(companyIdentity(), { _http: http });
  assert.equal(http.calls.length, 2);
  assert.equal(out.status, 'error');
  assert.equal(out.completeness, 'unavailable');
  assert.deepEqual(out.results, []);
  assert.doesNotMatch(out.summary, /No ASIC/);
});

test('a transient failure followed by success returns the record', async () => {
  let n = 0;
  const http = fakeHttp((params) => (n++ === 0 ? new Error('timeout') : byFilter({ 'ACN:155832732': TURNKEY })(params)));
  const out = await searchASIC(companyIdentity(), { _http: http });
  assert.equal(out.results[0].title, 'TURNKEY CREATIONS PTY LTD');
});

test('a known non-company with no ACN is not looked up and is not a finding', async () => {
  const http = fakeHttp(() => []);
  const identity = resolveEntityIdentity(
    { abn: '11222333444' },
    { results: [{ title: 'The Trustee for the Smith Family Trust', metadata: { 'Entity type': 'Discretionary Trading Trust' } }] }
  );
  const out = await searchASIC(identity, { _http: http });
  assert.equal(http.calls.length, 0);
  assert.match(out.summary, /Not a company/);
});

test('with no ABN or ACN, a name match is only ever "Name only — verify"', async () => {
  const http = fakeHttp(byFilter({ 'q:Turnkey Creations Pty Ltd': [...TURNKEY, row('TURNKEY CREATIONS GROUP PTY LTD', '999999999', { 'Current Name Indicator': 'Y' })] }));
  const out = await searchASIC(resolveEntityIdentity({ companyName: 'Turnkey Creations Pty Ltd' }, null), { _http: http });
  assert.equal(out.results.length, 1, 'only the exact normalised name match is kept');
  assert.equal(out.results[0].metadata.MatchedBy, NAME_ONLY);
  assert.deepEqual(out.formerNames, [], 'unconfirmed former names never become search terms');
});

test('Data API directors are appended only when ASIC_DATA_API_KEY is set and the company is confirmed', async () => {
  const http = fakeHttp(byFilter({ 'ACN:155832732': TURNKEY }));
  const director = { title: 'JANE SMITH', metadata: { Role: 'Director' } };
  const prev = process.env.ASIC_DATA_API_KEY;
  try {
    delete process.env.ASIC_DATA_API_KEY;
    let out = await searchASIC(companyIdentity(), { _http: http, _fetchDirectors: async () => [director] });
    assert.equal(out.results.length, 1);
    process.env.ASIC_DATA_API_KEY = 'test-key';
    out = await searchASIC(companyIdentity(), { _http: http, _fetchDirectors: async () => [director] });
    assert.equal(out.results.length, 2);
    assert.equal(out.results[1].metadata.Role, 'Director');
    out = await searchASIC(companyIdentity(), { _http: http, _fetchDirectors: async () => { throw new Error('403'); } });
    assert.equal(out.results.length, 1, 'a Data API failure leaves the company record standing');
  } finally {
    if (prev === undefined) delete process.env.ASIC_DATA_API_KEY;
    else process.env.ASIC_DATA_API_KEY = prev;
  }
});

test('lookupAsicCompany returns null when ASIC has no such company', async () => {
  assert.equal(await lookupAsicCompany({ abn: '67155832732' }, fakeHttp(() => [])), null);
});
