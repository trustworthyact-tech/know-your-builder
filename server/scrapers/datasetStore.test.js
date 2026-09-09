'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { replaceDatasetRecords, queryDataset, recordIngestionFailure, diskCachePath, diskFailureMarkerPath } = require('./datasetStore');

// Injectable fake pg Pool — same DI style as asicDpnDataset.js's _axios. Records every
// query so tests can assert the transaction shape without a real Postgres connection.

function makeFakePool({ clientQueryImpl, poolQueryImpl } = {}) {
  const calls = { client: [], pool: [] };
  const client = {
    query: async (sql, values) => {
      calls.client.push({ sql, values });
      if (clientQueryImpl) return clientQueryImpl(sql, values, calls.client.length);
      return { rows: [] };
    },
    release: () => {},
  };
  return {
    calls,
    connect: async () => client,
    query: async (sql, values) => {
      calls.pool.push({ sql, values });
      if (poolQueryImpl) return poolQueryImpl(sql, values);
      return { rows: [] };
    },
  };
}

function cleanup(datasetKey) {
  try { fs.unlinkSync(diskCachePath(datasetKey)); } catch { /* fine if absent */ }
}

test('replaceDatasetRecords — no pool configured falls back to disk, still succeeds', async () => {
  const key = 'test_no_pool';
  cleanup(key);
  try {
    const rows = [{ payload: { name: 'Acme' } }, { payload: { name: 'Beta' } }];
    const result = await replaceDatasetRecords(key, rows, {}, null);
    assert.equal(result.stored, 'disk');
    assert.equal(result.rowCount, 2);

    const read = await queryDataset(key, {}, null);
    assert.deepEqual(read.rows, [{ name: 'Acme' }, { name: 'Beta' }]);
    assert.equal(read.dataSource, 'cache');
    assert.equal(read.storageTier, 'disk');
  } finally {
    cleanup(key);
  }
});

test('replaceDatasetRecords — writes one transaction: BEGIN, upsert snapshot, delete, insert, COMMIT', async () => {
  const key = 'test_transaction_shape';
  cleanup(key);
  try {
    const pool = makeFakePool();
    const rows = [{ payload: { a: 1 }, abn: '123' }, { payload: { a: 2 }, abn: '456' }];
    const result = await replaceDatasetRecords(key, rows, { sourceUrl: 'https://example.com' }, pool);

    assert.equal(result.stored, 'db');
    const sqls = pool.calls.client.map((c) => c.sql);
    assert.match(sqls[0], /^BEGIN$/);
    assert.match(sqls[1], /INSERT INTO dataset_snapshot/);
    assert.match(sqls[2], /DELETE FROM register_record WHERE dataset_key = \$1/);
    assert.match(sqls[3], /INSERT INTO register_record/);
    assert.match(sqls[sqls.length - 1], /^COMMIT$/);
  } finally {
    cleanup(key);
  }
});

test('replaceDatasetRecords — chunks inserts past 500 rows', async () => {
  const key = 'test_chunking';
  cleanup(key);
  try {
    const pool = makeFakePool();
    const rows = Array.from({ length: 1200 }, (_, i) => ({ payload: { i } }));
    await replaceDatasetRecords(key, rows, {}, pool);

    const insertCalls = pool.calls.client.filter((c) => /INSERT INTO register_record/.test(c.sql));
    // 1200 rows / 500-row chunks = 3 insert statements
    assert.equal(insertCalls.length, 3);
    assert.equal(insertCalls[0].values.length, 500 * 6);
    assert.equal(insertCalls[2].values.length, 200 * 6);
  } finally {
    cleanup(key);
  }
});

test('replaceDatasetRecords — DB failure rolls back and falls back to the disk write already made', async () => {
  const key = 'test_db_failure';
  cleanup(key);
  try {
    const pool = makeFakePool({
      clientQueryImpl: async (sql) => {
        if (/INSERT INTO register_record/.test(sql)) throw new Error('simulated DB failure');
        return { rows: [] };
      },
    });
    const rows = [{ payload: { name: 'Still On Disk' } }];
    const result = await replaceDatasetRecords(key, rows, {}, pool);

    assert.equal(result.stored, 'disk');
    assert.ok(result.error.includes('simulated DB failure'));
    assert.ok(pool.calls.client.some((c) => c.sql === 'ROLLBACK'));

    // disk fallback was written before the DB attempt, so it's still readable
    const read = await queryDataset(key, {}, null);
    assert.deepEqual(read.rows, [{ name: 'Still On Disk' }]);
  } finally {
    cleanup(key);
  }
});

test('queryDataset — DB path returns rows + fetchedAt from the snapshot, applies abn/acn/name filters', async () => {
  const key = 'test_query_db';
  const fetchedAt = new Date('2026-09-01T00:00:00Z');
  const pool = makeFakePool({
    poolQueryImpl: async (sql, values) => {
      if (/SELECT fetched_at FROM dataset_snapshot/.test(sql)) return { rows: [{ fetched_at: fetchedAt }] };
      if (/SELECT payload FROM register_record/.test(sql)) {
        assert.ok(sql.includes('abn = $2'));
        assert.ok(sql.includes('normalised_name ILIKE $3'));
        assert.deepEqual(values, [key, '123456789', '%acme%']);
        return { rows: [{ payload: { name: 'Acme Pty Ltd' } }] };
      }
      return { rows: [] };
    },
  });

  const result = await queryDataset(key, { abn: '123456789', name: 'Acme' }, pool);
  assert.deepEqual(result.rows, [{ name: 'Acme Pty Ltd' }]);
  assert.deepEqual(result.fetchedAt, fetchedAt);
  assert.equal(result.dataSource, 'cache');
  assert.equal(result.storageTier, 'db');
});

test('queryDataset — DB read failure falls back to disk cache', async () => {
  const key = 'test_query_db_failure';
  cleanup(key);
  try {
    await replaceDatasetRecords(key, [{ payload: { name: 'Seeded On Disk' } }], {}, null);

    const throwingPool = makeFakePool({
      poolQueryImpl: async () => { throw new Error('connection refused'); },
    });
    const result = await queryDataset(key, {}, throwingPool);
    assert.deepEqual(result.rows, [{ name: 'Seeded On Disk' }]);
    assert.equal(result.storageTier, 'disk');
  } finally {
    cleanup(key);
  }
});

test('queryDataset — stale is only computed when slaMs is supplied', async () => {
  const key = 'test_stale';
  const oldFetchedAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago
  const pool = makeFakePool({
    poolQueryImpl: async (sql) => {
      if (/dataset_snapshot/.test(sql)) return { rows: [{ fetched_at: oldFetchedAt }] };
      return { rows: [] };
    },
  });

  const withoutSla = await queryDataset(key, {}, pool);
  assert.equal(withoutSla.stale, undefined);

  const withSla = await queryDataset(key, { slaMs: 60 * 60 * 1000 }, pool); // 1h SLA, data is 24h old
  assert.equal(withSla.stale, true);

  const withGenerousSla = await queryDataset(key, { slaMs: 48 * 60 * 60 * 1000 }, pool);
  assert.equal(withGenerousSla.stale, false);
});

test('queryDataset — missing snapshot (dataset never ingested) falls back to disk, not a crash', async () => {
  const key = 'test_no_snapshot';
  cleanup(key);
  try {
    const pool = makeFakePool({ poolQueryImpl: async () => ({ rows: [] }) }); // no snapshot row
    const result = await queryDataset(key, {}, pool);
    assert.equal(result.storageTier, 'disk');
    assert.equal(result.empty, true);
  } finally {
    cleanup(key);
  }
});

function cleanupFailureMarker(datasetKey) {
  try { fs.unlinkSync(diskFailureMarkerPath(datasetKey)); } catch { /* fine if absent */ }
}

test('recordIngestionFailure — no pool configured writes a disk marker, does not touch existing good rows', async () => {
  const key = 'test_failure_no_pool';
  cleanup(key);
  cleanupFailureMarker(key);
  try {
    await replaceDatasetRecords(key, [{ payload: { name: 'Good Row' } }], {}, null);

    const result = await recordIngestionFailure(key, 'header discovery failed', null);
    assert.equal(result.recorded, 'disk');
    assert.ok(fs.existsSync(diskFailureMarkerPath(key)));

    // the previously-ingested good row is still there, untouched
    const read = await queryDataset(key, {}, null);
    assert.deepEqual(read.rows, [{ name: 'Good Row' }]);
  } finally {
    cleanup(key);
    cleanupFailureMarker(key);
  }
});

test('recordIngestionFailure — DB path marks status=failed via upsert, never touches register_record', async () => {
  const key = 'test_failure_db';
  const pool = makeFakePool();
  const result = await recordIngestionFailure(key, 'header discovery failed: name column not found', pool);

  assert.equal(result.recorded, 'db');
  const sqls = pool.calls.pool.map((c) => c.sql);
  assert.equal(sqls.length, 1);
  assert.match(sqls[0], /INSERT INTO dataset_snapshot/);
  assert.match(sqls[0], /ON CONFLICT \(dataset_key\) DO UPDATE SET status='failed'/);
  assert.ok(!sqls.some((s) => /register_record/.test(s)), 'must never touch register_record');
});

test('recordIngestionFailure — DB write failure is reported, not thrown', async () => {
  const pool = makeFakePool({ poolQueryImpl: async () => { throw new Error('connection refused'); } });
  const result = await recordIngestionFailure('test_failure_db_error', 'bad parse', pool);
  assert.equal(result.recorded, 'none');
  assert.ok(result.error.includes('connection refused'));
});
