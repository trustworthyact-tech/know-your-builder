'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { associatedNamesFromDetails, searchNSWFairTrading, fetchNswCompanyLookup } = require('./nswFairTrading');

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

// ---- failure reporting (Phase 1.2) — fake _http, no network ----

const hit = (licensee, licenceNumber, licenceId) => ({
  licensee,
  licenceNumber,
  licenceId,
  licenceType: 'Contractor Licence',
  licenceTypeFriendly: 'Contractor',
  status: 'Current',
  expires: '2027-01-01',
});

function fakeHttp({ searchResults = {}, failQueries = [], details = null } = {}) {
  const posts = [];
  return {
    posts,
    post: async (_url, body) => {
      posts.push(body.search);
      if (failQueries.includes(body.search)) throw new Error('connect ETIMEDOUT');
      return { data: { results: searchResults[body.search] || [] } };
    },
    get: async () => ({ data: { componentData: details } }),
  };
}

test('searchNSWFairTrading — a failed search is reported as partial, not "no licence"', async () => {
  const http = fakeHttp({ failQueries: ['Acme Builders'] });
  const result = await searchNSWFairTrading('Acme Builders Pty Ltd', '', [], undefined, http);
  assert.equal(result.completeness, 'partial');
  assert.equal(result.results.length, 0);
  assert.match(result.summary, /failed for 1 of 1 search/);
  assert.doesNotMatch(result.summary, /No NSW Fair Trading contractor licence records found/);
});

test('searchNSWFairTrading — a genuine empty result stays complete', async () => {
  const http = fakeHttp();
  const result = await searchNSWFairTrading('Acme Builders Pty Ltd', '', [], undefined, http);
  assert.equal(result.completeness, undefined);
  assert.equal(result.summary, 'No NSW Fair Trading contractor licence records found');
});

test('searchNSWFairTrading — one failed director query keeps found records but marks partial', async () => {
  const http = fakeHttp({
    searchResults: { 'Acme Builders': [hit('ACME BUILDERS PTY LTD', '123A', 'L1')] },
    failQueries: ['Jane Citizen'],
  });
  const result = await searchNSWFairTrading('Acme Builders Pty Ltd', '', ['Jane Citizen'], undefined, http);
  assert.equal(result.results.length, 1);
  assert.equal(result.completeness, 'partial');
  assert.match(result.summary, /^1 NSW contractor licence record\(s\) found; NSW licence lookup failed for 1 of 2/);
});

test('searchNSWFairTrading — a failed discovery result is re-queried, not reused as empty', async () => {
  const http = fakeHttp({ searchResults: { 'Acme Builders': [hit('ACME BUILDERS PTY LTD', '123A', 'L1')] } });
  // Shape of searchOrchestrator.js's 20s-timeout fallback.
  const timedOut = { items: [], associatedNames: [], seen: new Set(), failed: true };
  const result = await searchNSWFairTrading('Acme Builders Pty Ltd', '', [], timedOut, http);
  assert.deepEqual(http.posts, ['Acme Builders']);
  assert.equal(result.results.length, 1);
  assert.equal(result.completeness, undefined);
});

test('searchNSWFairTrading — a successful discovery result is reused without re-querying', async () => {
  const http = fakeHttp({ searchResults: { 'Acme Builders': [hit('ACME BUILDERS PTY LTD', '123A', 'L1')] } });
  const primary = await fetchNswCompanyLookup('Acme Builders Pty Ltd', http);
  assert.equal(primary.failed, false);
  http.posts.length = 0;
  const result = await searchNSWFairTrading('Acme Builders Pty Ltd', '', [], primary, http);
  assert.deepEqual(http.posts, []);
  assert.equal(result.results.length, 1);
});

test('searchNSWFairTrading — lists every director in metadata, not just the first', async () => {
  const http = fakeHttp({
    searchResults: { 'Turnkey Creations': [hit('TURNKEY CREATIONS PTY LTD', '999B', 'L9')] },
    details: {
      associatedRoles: [
        {
          name: 'Directors',
          parties: [
            { name: 'Nickolas Jai Constable', role: 'Director' },
            { name: 'Frank Walmsley', role: 'Director' },
          ],
        },
      ],
    },
  });
  const result = await searchNSWFairTrading('Turnkey Creations Pty Ltd', '', [], undefined, http);
  assert.equal(result.results[0].metadata.Director, 'Nickolas Jai Constable; Frank Walmsley');
});
