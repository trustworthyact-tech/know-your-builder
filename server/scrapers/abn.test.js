'use strict';

// ABN lookup (DATA_SOURCES_PLAN.md 1.1): ABN Lookup web services first, ABR page scrape as the
// fallback, and a failed lookup never reported as "not found". Network-free: a fake `_http`
// answers by URL. Responses are synthetic but shaped like the real ones captured 2026-10-13.
const test = require('node:test');
const assert = require('node:assert/strict');
const { searchABN, searchByName, displayDate } = require('./abn');

const xml = (body) => `<?xml version="1.0" encoding="utf-8"?>
<ABRPayloadSearchResults xmlns="http://abr.business.gov.au/ABRXMLSearch/"><response>${body}</response></ABRPayloadSearchResults>`;
const named = (tag, name, from, to = '0001-01-01') =>
  `<${tag}><organisationName>${name}</organisationName><effectiveFrom>${from}</effectiveFrom><effectiveTo>${to}</effectiveTo></${tag}>`;

const COMPANY = xml(`<businessEntity202001>
  <ABN><identifierValue>67155832732</identifierValue><isCurrentIndicator>Y</isCurrentIndicator></ABN>
  <entityStatus><entityStatusCode>Active</entityStatusCode><effectiveFrom>2012-02-21</effectiveFrom><effectiveTo>0001-01-01</effectiveTo></entityStatus>
  <ASICNumber>155832732</ASICNumber>
  <entityType><entityTypeCode>PRV</entityTypeCode><entityDescription>Australian Private Company</entityDescription></entityType>
  <goodsAndServicesTax><effectiveFrom>2012-07-01</effectiveFrom><effectiveTo>0001-01-01</effectiveTo></goodsAndServicesTax>
  <mainName><organisationName>TURNKEY CREATIONS PTY LTD</organisationName><effectiveFrom>2012-05-22</effectiveFrom></mainName>
  ${named('mainName', 'A.C.N. 155 832 732 PTY LTD', '2012-05-21', '2012-05-22')}
  ${named('mainName', 'FAW Holdings Pty Ltd', '2012-02-21', '2012-05-21')}
  ${named('mainName', 'FAW HOLDINGS PTY. LTD.', '2012-02-01', '2012-02-21')}
  <mainBusinessPhysicalAddress><stateCode>ACT</stateCode><postcode>2911</postcode><effectiveFrom>2026-06-09</effectiveFrom><effectiveTo>0001-01-01</effectiveTo></mainBusinessPhysicalAddress>
  <mainBusinessPhysicalAddress><stateCode>ACT</stateCode><postcode>2617</postcode><effectiveFrom>2025-05-07</effectiveFrom><effectiveTo>2026-06-09</effectiveTo></mainBusinessPhysicalAddress>
  <businessName><organisationName>Auction Advantage</organisationName><effectiveFrom>2026-03-25</effectiveFrom></businessName>
  ${named('businessName', 'Short Stays Canberra', '2020-01-01')}
  ${named('businessName', 'Turnkey Carpentry', '2019-01-01', '2024-01-12')}
</businessEntity202001>`);

const SOLE_TRADER = xml(`<businessEntity202001>
  <entityStatus><entityStatusCode>Cancelled</entityStatusCode><effectiveFrom>2015-03-01</effectiveFrom><effectiveTo>0001-01-01</effectiveTo></entityStatus>
  <entityStatus><entityStatusCode>Active</entityStatusCode><effectiveFrom>2011-09-08</effectiveFrom><effectiveTo>2015-03-01</effectiveTo></entityStatus>
  <ASICNumber />
  <entityType><entityTypeCode>IND</entityTypeCode><entityDescription>Individual/Sole Trader</entityDescription></entityType>
  <legalName><givenName>JANE</givenName><otherGivenName>MARY</otherGivenName><familyName>CITIZEN</familyName><effectiveFrom>2013-11-29</effectiveFrom><effectiveTo>0001-01-01</effectiveTo></legalName>
  <legalName><givenName>JANE</givenName><otherGivenName>MAREE</otherGivenName><familyName>CITIZEN</familyName><effectiveFrom>2011-09-08</effectiveFrom><effectiveTo>2013-11-29</effectiveTo></legalName>
  <mainTradingName><organisationName>CITIZEN BUILDING</organisationName><effectiveFrom>2011-09-08</effectiveFrom></mainTradingName>
  ${named('otherTradingName', 'OLD TRADING NAME', '2011-09-08', '2012-01-01')}
</businessEntity202001>`);

const exception = (msg) => xml(`<exception><exceptionDescription>${msg}</exceptionDescription><exceptionCode>WEBSERVICES</exceptionCode></exception>`);

const SCRAPED_PAGE = `<html><body><span itemprop="legalName">TURNKEY CREATIONS PTY LTD</span>
  <table><caption>ABN details</caption><tr><th>Entity type:</th><td>Australian Private Company</td></tr><tr><th>ABN status:</th><td>Active from 21 Feb 2012</td></tr></table>
  <table><caption>Business name(s)</caption><tr><td colspan="2">help</td></tr><tr><th>Name</th><th>From</th></tr><tr><td>Auction Advantage</td><td>25 Mar 2026</td></tr></table>
</body></html>`;

// Routes each request by URL; a value that is an Error is thrown (a failed fetch).
function fakeHttp(routes) {
  const calls = [];
  return {
    calls,
    async get(url) {
      calls.push(url);
      const key = Object.keys(routes).find((k) => url.includes(k));
      const value = key ? routes[key] : new Error(`no route for ${url}`);
      if (value instanceof Error) throw value;
      return { data: value };
    },
  };
}

const GUID = 'test-guid';

test('company: same metadata keys as the old page scrape, plus registration date, ACN and dated former names', async () => {
  const http = fakeHttp({ SearchByABNv202001: COMPANY });
  const out = await searchABN('67155832732', '', '', { _http: http, guid: GUID });
  const [item] = out.results;
  assert.equal(item.title, 'TURNKEY CREATIONS PTY LTD');
  assert.equal(item.status, 'Active from 21 Feb 2012');
  assert.equal(item.date, '2012-02-21');
  assert.deepEqual(item.metadata, {
    'Entity name': 'TURNKEY CREATIONS PTY LTD',
    'ABN status': 'Active from 21 Feb 2012',
    'Entity type': 'Australian Private Company',
    'Goods & Services Tax (GST)': 'Registered from 01 Jul 2012',
    'Main business location': 'ACT 2911',
    'Business Name(s)': 'Auction Advantage, Short Stays Canberra',
    'Former name(s)': 'A.C.N. 155 832 732 PTY LTD, FAW Holdings Pty Ltd',
    ACN: '155832732',
  });
  assert.deepEqual(out.businessNames, ['Auction Advantage', 'Short Stays Canberra'], 'cancelled business names are excluded');
  assert.deepEqual(out.formerNames, ['A.C.N. 155 832 732 PTY LTD', 'FAW Holdings Pty Ltd'], 'newest first');
  assert.equal(http.calls.length, 1, 'no page scrape when the API answers');
});

test('sole trader: "FAMILY, GIVEN" name, current trading names only, cancelled status, no GST, no former names', async () => {
  const out = await searchABN('86589948430', '', '', { _http: fakeHttp({ SearchByABNv202001: SOLE_TRADER }), guid: GUID });
  const [item] = out.results;
  assert.equal(item.title, 'CITIZEN, JANE MARY');
  assert.equal(item.status, 'Cancelled from 01 Mar 2015');
  assert.equal(item.date, '2011-09-08', 'registration date is the earliest status record');
  assert.equal(item.metadata['Goods & Services Tax (GST)'], 'Not currently registered for GST');
  assert.deepEqual(out.tradingNames, ['CITIZEN BUILDING']);
  assert.equal(item.metadata.ACN, undefined);
  assert.deepEqual(out.formerNames, [], "a sole trader's earlier legal names aren't search terms");
});

test('an unknown ABN is a genuine "not found" — then the name search runs as before', async () => {
  const http = fakeHttp({
    SearchByABNv202001: exception('Search text is not a valid ABN or ACN'),
    'MatchingNames.aspx': 'cb({"Message":"","Names":[]})',
  });
  const out = await searchABN('12345678901', 'Nobody Pty Ltd', '', { _http: http, guid: GUID });
  assert.equal(out.status, undefined);
  assert.deepEqual(out.results, []);
  assert.match(out.summary, /No ABR records found/);
});

test('an API fault (e.g. an unrecognised GUID) falls back to the ABR page', async () => {
  const http = fakeHttp({
    SearchByABNv202001: exception('The GUID entered is not recognised as a Registered Party'),
    'ABN/View': SCRAPED_PAGE,
  });
  const out = await searchABN('67155832732', '', '', { _http: http, guid: GUID });
  assert.equal(out.results[0].title, 'TURNKEY CREATIONS PTY LTD');
  assert.deepEqual(out.businessNames, ['Auction Advantage']);
});

test('no GUID configured: the ABR page scrape is used, as before', async () => {
  const http = fakeHttp({ 'ABN/View': SCRAPED_PAGE });
  const out = await searchABN('67155832732', '', '', { _http: http, guid: '' });
  assert.equal(out.results[0].title, 'TURNKEY CREATIONS PTY LTD');
  assert.ok(http.calls.every((u) => u.includes('ABN/View')));
});

test('API and page both failing is reported as a failed lookup, never as "No ABR records found"', async () => {
  const http = fakeHttp({ SearchByABNv202001: new Error('503'), 'ABN/View': new Error('503') });
  const out = await searchABN('67155832732', '', '', { _http: http, guid: GUID });
  assert.equal(out.status, 'error');
  assert.equal(out.completeness, 'unavailable');
  assert.deepEqual(out.results, []);
  assert.doesNotMatch(out.summary, /No ABR records/);
});

test('a failed ABN lookup still falls back to the name search when a name was typed', async () => {
  const http = fakeHttp({
    SearchByABNv202001: new Error('503'),
    'ABN/View': new Error('503'),
    'MatchingNames.aspx': 'cb({"Message":"","Names":[{"Abn":"67155832732","AbnStatus":"0000000001","Name":"TURNKEY CREATIONS PTY LTD","NameType":"Entity Name","State":"ACT"}]})',
  });
  const out = await searchABN('67155832732', 'Turnkey Creations Pty Ltd', '', { _http: http, guid: GUID });
  assert.equal(out.status, undefined);
  assert.equal(out.results[0].metadata.ABN, '67155832732');
  assert.equal(out.results[0].metadata.Status, 'Active');
});

test('searchByName maps API status codes and throws when both sources fail', async () => {
  const ok = fakeHttp({
    'MatchingNames.aspx':
      'cb({"Message":"","Names":[{"Abn":"1","AbnStatus":"0000000001","Name":"A","NameType":"Entity Name","State":"NSW"},{"Abn":"2","AbnStatus":"0000000002","Name":"B","NameType":"Business Name","State":"VIC"}]})',
  });
  const matches = await searchByName('A', { _http: ok, guid: GUID });
  assert.deepEqual(matches.map((m) => m.status), ['Active', 'Cancelled']);
  assert.equal(matches[1].type, 'Business Name');
  const down = fakeHttp({ 'MatchingNames.aspx': new Error('503'), 'Search/ResultsActive': new Error('503') });
  await assert.rejects(searchByName('A', { _http: down, guid: GUID }));
});

test('displayDate', () => {
  assert.equal(displayDate('2012-02-21'), '21 Feb 2012');
  assert.equal(displayDate(''), '');
});
