'use strict';

// Network-free tests for the ACT courts search (courts_act): ACT Courts + ACAT fetched in
// parallel per term, a single-source failure reported as partial (never a silent "complete"),
// and a deadline that keeps the whole search inside courts_act's manifest budget. Added
// 2026-10-06 after a production timeout — see courtRecords.js's fetchActAndAcatTermResults.
// Fetchers are injected via searchActJudgments's _fetchCourts/_fetchAcat test hooks.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchActJudgments } = require('./courtRecords');

const TERM = 'Future Form';
const courtCase = { title: 'Future Form Pty Ltd v Smith [2025] ACTSC 1', url: 'https://courts.act.gov.au/case/1' };
const acatCase = { title: 'Jones v Future Form Pty Ltd [2025] ACAT 2', url: 'https://acat.act.gov.au/case/2' };

// Records calls (term + options) and returns/throws per a scripted sequence of outcomes.
function fakeFetcher(outcomes) {
  const calls = [];
  const fn = async (term, opts) => {
    calls.push({ term, opts, at: Date.now() });
    const next = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  };
  fn.calls = calls;
  return fn;
}

test('both sources succeed — results from both, completeness complete', async () => {
  const courts = fakeFetcher([[courtCase]]);
  const acat = fakeFetcher([[acatCase]]);
  const result = await searchActJudgments(TERM, [], { _fetchCourts: courts, _fetchAcat: acat });

  assert.equal(result.completeness, 'complete');
  assert.deepEqual(result.results.map((r) => r.url).sort(), [courtCase.url, acatCase.url].sort());
  assert.match(result.summary, /Found 2 case\(s\)/);
});

test('ACT Courts and ACAT are requested in parallel, not one after the other', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  // Courts blocks until released; if the two ran sequentially, ACAT would never start.
  const courts = fakeFetcher([() => gate.then(() => [courtCase])]);
  const acat = fakeFetcher([[acatCase]]);

  const pending = searchActJudgments(TERM, [], { _fetchCourts: courts, _fetchAcat: acat });
  await new Promise((r) => setImmediate(r));
  assert.equal(acat.calls.length, 1, 'ACAT should start while ACT Courts is still in flight');
  release();
  await pending;
});

test('ACAT fails, ACT Courts succeeds — partial, names ACAT, keeps the court results (never a silent complete)', async () => {
  const courts = fakeFetcher([[courtCase]]);
  const acat = fakeFetcher([new Error('timeout of 20000ms exceeded')]);
  const result = await searchActJudgments(TERM, [], { _fetchCourts: courts, _fetchAcat: acat });

  assert.equal(result.completeness, 'partial');
  assert.notEqual(result.status, 'error');
  assert.match(result.summary, /ACAT could not be checked/);
  assert.deepEqual(result.results.map((r) => r.url), [courtCase.url]);
});

test('ACT Courts fails, ACAT succeeds with no hits — partial, never "No cases found ... complete"', async () => {
  const courts = fakeFetcher([new Error('socket hang up')]);
  const acat = fakeFetcher([[]]);
  const result = await searchActJudgments(TERM, [], { _fetchCourts: courts, _fetchAcat: acat });

  assert.equal(result.completeness, 'partial');
  assert.match(result.summary, /ACT Courts could not be checked/);
});

test('both sources fail on every attempt — status error, completeness unavailable', async () => {
  const courts = fakeFetcher([new Error('down')]);
  const acat = fakeFetcher([new Error('down')]);
  const result = await searchActJudgments(TERM, [], { _fetchCourts: courts, _fetchAcat: acat });

  assert.equal(result.status, 'error');
  assert.equal(result.completeness, 'unavailable');
});

test('both fail once, then succeed on the retry (deadline allows it) — complete', async () => {
  const courts = fakeFetcher([new Error('blip'), [courtCase]]);
  const acat = fakeFetcher([new Error('blip'), [acatCase]]);
  const result = await searchActJudgments(TERM, [], {
    deadline: Date.now() + 30_000,
    _fetchCourts: courts,
    _fetchAcat: acat,
  });

  assert.equal(courts.calls.length, 2);
  assert.equal(result.completeness, 'complete');
});

test('with a deadline, each request may use the time remaining before it (and never more)', async () => {
  const courts = fakeFetcher([[courtCase]]);
  const acat = fakeFetcher([[acatCase]]);

  await searchActJudgments(TERM, [], { deadline: Date.now() + 40_000, _fetchCourts: courts, _fetchAcat: acat });
  for (const f of [courts, acat]) {
    const t = f.calls[0].opts.timeoutMs;
    assert.ok(t <= 40_000 && t > 38_000, `expected ~40s, got ${t}`);
  }
});

test('without a deadline, requests keep the previous fixed 45s timeout', async () => {
  const courts = fakeFetcher([[courtCase]]);
  const acat = fakeFetcher([[acatCase]]);
  await searchActJudgments(TERM, [], { _fetchCourts: courts, _fetchAcat: acat });
  assert.equal(courts.calls[0].opts.timeoutMs, 45_000);
});

test('no retry when the deadline would not leave time for it — returns unavailable instead of overrunning', async () => {
  const courts = fakeFetcher([new Error('down')]);
  const acat = fakeFetcher([new Error('down')]);
  // 6s left: after the 2s retry backoff only ~4s would remain, below the 5s minimum.
  const result = await searchActJudgments(TERM, [], { deadline: Date.now() + 6_000, _fetchCourts: courts, _fetchAcat: acat });

  assert.equal(courts.calls.length, 1, 'should not retry');
  assert.equal(result.completeness, 'unavailable');
});

test('deadline already reached before any fetch — no request is made, reported unavailable', async () => {
  const courts = fakeFetcher([[courtCase]]);
  const acat = fakeFetcher([[acatCase]]);
  const result = await searchActJudgments(TERM, [], { deadline: Date.now() + 1_000, _fetchCourts: courts, _fetchAcat: acat });

  assert.equal(courts.calls.length, 0);
  assert.equal(acat.calls.length, 0);
  assert.equal(result.completeness, 'unavailable');
});

test('one name variant fully fails while another succeeds — partial with the existing name-variant note', async () => {
  const courts = async (term) => { if (term === 'Jane Citizen') throw new Error('down'); return [courtCase]; };
  const acat = async (term) => { if (term === 'Jane Citizen') throw new Error('down'); return []; };
  const result = await searchActJudgments(TERM, ['Jane Citizen'], { deadline: Date.now() + 6_000, _fetchCourts: courts, _fetchAcat: acat });

  assert.equal(result.completeness, 'partial');
  assert.match(result.summary, /name variants could not be checked/);
  assert.deepEqual(result.results.map((r) => r.url), [courtCase.url]);
});
