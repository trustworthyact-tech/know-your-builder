'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { logEvent, getRollup, mergeHistory } = require('./healthHistory');

// Injectable fake pg Pool — same DI style as datasetStore.test.js's makeFakePool()
// (duplicated here, not imported, matching this codebase's per-file helper-duplication
// convention). Records every query so tests can assert shape without a real Postgres.
function makeFakePool({ queryImpl } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (queryImpl) return queryImpl(sql, values, calls.length);
      return { rows: [] };
    },
  };
}

test('logEvent — no pool configured no-ops cleanly, does not throw', async () => {
  await assert.doesNotReject(logEvent('someKey', 'success', null, null));
});

test('logEvent — inserts scraper_key/outcome/error via the pool', async () => {
  const pool = makeFakePool();
  await logEvent('asic', 'failure', 'boom', pool);

  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /INSERT INTO health_check_event/);
  assert.deepEqual(pool.calls[0].values, ['asic', 'failure', 'boom', null]);
});

test('logEvent — a null error is passed through as null, not the string "null"', async () => {
  const pool = makeFakePool();
  await logEvent('asic', 'success', null, pool);
  assert.equal(pool.calls[0].values[2], null);
});

test('logEvent — a rejecting pool.query is swallowed, not thrown', async () => {
  const pool = makeFakePool({ queryImpl: async () => { throw new Error('connection lost'); } });
  await assert.doesNotReject(logEvent('asic', 'failure', 'boom', pool));
});

test('getRollup — no pool configured returns null, not an empty object', async () => {
  const result = await getRollup({ windowDays: 7 }, null);
  assert.equal(result, null);
});

test('getRollup — computes successRate from attempts/successes and excludes circuit_open from the denominator', async () => {
  const pool = makeFakePool({
    queryImpl: async () => ({
      rows: [
        { scraper_key: 'asic', successes: '3', attempts: '4' },
        { scraper_key: 'fwo', successes: '0', attempts: '2' },
      ],
    }),
  });

  const result = await getRollup({ windowDays: 7 }, pool);

  assert.deepEqual(result.asic, { attempts: 4, successes: 3, successRate: 0.75, completeChecks: 0, completeRate: null });
  assert.deepEqual(result.fwo, { attempts: 2, successes: 0, successRate: 0, completeChecks: 0, completeRate: null });
  assert.match(pool.calls[0].sql, /GROUP BY scraper_key/);
  assert.match(pool.calls[0].sql, /outcome IN \('success', 'failure'\)/);
});

test('getRollup — a rejecting pool.query (e.g. table not yet created) resolves to null, does not throw', async () => {
  const pool = makeFakePool({ queryImpl: async () => { throw new Error('relation "health_check_event" does not exist'); } });
  await assert.doesNotReject(getRollup({ windowDays: 7 }, pool));
  assert.equal(await getRollup({ windowDays: 7 }, pool), null);
});

test('getRollup — a key with zero attempts in the window reports successRate null, not NaN', async () => {
  const pool = makeFakePool({
    queryImpl: async () => ({ rows: [{ scraper_key: 'qbcc', successes: '0', attempts: '0' }] }),
  });

  const result = await getRollup({ windowDays: 7 }, pool);
  assert.equal(result.qbcc.successRate, null);
});

test('getRollup — windowDays is interpolated as a bound parameter, not string-concatenated into the SQL', async () => {
  const pool = makeFakePool();
  await getRollup({ windowDays: 30 }, pool);

  assert.doesNotMatch(pool.calls[0].sql, /30/);
  assert.deepEqual(pool.calls[0].values, ['30']);
});

test('mergeHistory — null rollup (no DB configured) marks every row historyAvailable:false, not 0%', () => {
  const report = { generatedAt: 'x', scrapers: [{ key: 'asic', status: 'healthy' }] };
  const merged = mergeHistory(report, null);

  assert.equal(merged.scrapers[0].historyAvailable, false);
  assert.equal(merged.scrapers[0].attempts7d, null);
  assert.equal(merged.scrapers[0].successRate7d, null);
});

test('mergeHistory — a key present in the rollup gets its attempts/successRate merged in', () => {
  const report = { generatedAt: 'x', scrapers: [{ key: 'asic', status: 'healthy' }] };
  const rollup = { asic: { attempts: 10, successes: 9, successRate: 0.9 } };
  const merged = mergeHistory(report, rollup);

  assert.equal(merged.scrapers[0].historyAvailable, true);
  assert.equal(merged.scrapers[0].attempts7d, 10);
  assert.equal(merged.scrapers[0].successRate7d, 0.9);
});

test('mergeHistory — a key absent from a non-null rollup (no events yet) reports null attempts, not undefined/crash', () => {
  const report = { generatedAt: 'x', scrapers: [{ key: 'freshKey', status: 'no-data' }] };
  const merged = mergeHistory(report, {});

  assert.equal(merged.scrapers[0].historyAvailable, true);
  assert.equal(merged.scrapers[0].attempts7d, null);
  assert.equal(merged.scrapers[0].successRate7d, null);
});

// DATA_SOURCES_PLAN.md Phase 0 — completeness is stored and rolled up into a complete rate.
test('logEvent — stores completeness alongside the outcome', async () => {
  const pool = makeFakePool();
  await logEvent('asic', 'success', null, pool, 'partial');
  const insert = pool.calls.find((c) => /INSERT INTO health_check_event/.test(c.sql));
  assert.match(insert.sql, /completeness/);
  assert.deepEqual(insert.values, ['asic', 'success', null, 'partial']);
});

test('getRollup / mergeHistory — complete rate counts only rows that recorded completeness', async () => {
  const pool = makeFakePool({
    queryImpl: (sql) =>
      /FROM health_check_event/.test(sql)
        ? { rows: [{ scraper_key: 'fwo', successes: '10', attempts: '12', completes: '6', completeness_logged: '8' }] }
        : { rows: [] },
  });
  const rollup = await getRollup({ windowDays: 7 }, pool);
  assert.equal(rollup.fwo.completeRate, 6 / 8);
  assert.equal(rollup.fwo.completeChecks, 8);
  const merged = mergeHistory({ scrapers: [{ key: 'fwo' }, { key: 'abn' }] }, rollup);
  assert.equal(merged.scrapers[0].completeRate7d, 0.75);
  assert.equal(merged.scrapers[1].completeRate7d, null);
});
