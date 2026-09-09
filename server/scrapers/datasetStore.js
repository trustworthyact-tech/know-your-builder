'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getPool, ensureSchema } = require('./db');

// Shared read/write API for every bucket-1 (bulk-dataset) scraper — WS0.3 of the
// reliability plan. Postgres-backed (dataset_snapshot + register_record, see
// server/db/schema.sql), with a disk-JSON fallback so a DB outage or unset
// DATABASE_URL (local dev has no DB setup step, per CLAUDE.md) degrades gracefully
// instead of failing the check outright — same "never silently present as fresh"
// philosophy as every existing stale-cache scraper in this codebase.
//
// A row is { payload, jurisdiction?, abn?, acn?, normalisedName? } — only `payload`
// is required; the rest are nullable classification columns some datasets won't use
// (e.g. the ASIC DPN register has no ABN/ACN, only director names matched fuzzily in
// JS — see asicDpnMatch.js — so DB-side WHERE filtering isn't useful for every
// dataset, only some).

const CHUNK_SIZE = 500;

function diskCachePath(datasetKey) {
  return path.join(os.tmpdir(), `dataset_cache_${datasetKey}.json`);
}

function diskFailureMarkerPath(datasetKey) {
  return path.join(os.tmpdir(), `dataset_cache_${datasetKey}_failure.json`);
}

function writeDiskFallback(datasetKey, rows, fetchedAt) {
  try {
    fs.writeFileSync(
      diskCachePath(datasetKey),
      JSON.stringify({ fetchedAt: fetchedAt.toISOString(), rows: rows.map((r) => r.payload) })
    );
  } catch (err) {
    console.warn(`[datasetStore] disk fallback write failed for ${datasetKey}:`, err.message);
  }
}

function readDiskFallback(datasetKey) {
  try {
    const parsed = JSON.parse(fs.readFileSync(diskCachePath(datasetKey), 'utf8'));
    return {
      rows: parsed.rows,
      fetchedAt: new Date(parsed.fetchedAt),
      dataSource: 'cache',
      storageTier: 'disk',
    };
  } catch {
    return { rows: [], fetchedAt: null, dataSource: 'cache', storageTier: 'disk', empty: true };
  }
}

function withStale(result, slaMs) {
  if (slaMs == null || !result.fetchedAt) return result;
  return { ...result, stale: Date.now() - new Date(result.fetchedAt).getTime() > slaMs };
}

async function insertRowsChunked(client, datasetKey, rows) {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const values = [];
    const placeholders = chunk.map((row, idx) => {
      const base = idx * 6;
      values.push(
        datasetKey,
        row.jurisdiction ?? null,
        row.abn ?? null,
        row.acn ?? null,
        row.normalisedName ?? null,
        JSON.stringify(row.payload)
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`;
    });
    await client.query(
      `INSERT INTO register_record (dataset_key, jurisdiction, abn, acn, normalised_name, payload) VALUES ${placeholders.join(',')}`,
      values
    );
  }
}

/**
 * Atomically replaces every row for `datasetKey` — one transaction (DELETE existing +
 * INSERT new + UPSERT dataset_snapshot), so a concurrent read never sees a
 * half-swapped dataset. Also always writes a disk snapshot as a resilience fallback,
 * independent of whether the DB write succeeds.
 *
 * _pool is injectable so tests can exercise this without a real Postgres connection —
 * same DI style as asicDpnDataset.js's _axios.
 */
async function replaceDatasetRecords(datasetKey, rows, { sourceUrl } = {}, _pool = getPool()) {
  const fetchedAt = new Date();
  writeDiskFallback(datasetKey, rows, fetchedAt);

  if (!_pool) return { stored: 'disk', fetchedAt, rowCount: rows.length };

  await ensureSchema();
  const client = await _pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO dataset_snapshot (dataset_key, fetched_at, row_count, status, source_url, error)
       VALUES ($1,$2,$3,'ok',$4,NULL)
       ON CONFLICT (dataset_key) DO UPDATE SET fetched_at=$2, row_count=$3, status='ok', source_url=$4, error=NULL`,
      [datasetKey, fetchedAt, rows.length, sourceUrl ?? null]
    );
    await client.query('DELETE FROM register_record WHERE dataset_key = $1', [datasetKey]);
    await insertRowsChunked(client, datasetKey, rows);
    await client.query('COMMIT');
    return { stored: 'db', fetchedAt, rowCount: rows.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[datasetStore] replaceDatasetRecords(${datasetKey}) DB write failed, disk fallback already written:`, err.message);
    return { stored: 'disk', fetchedAt, rowCount: rows.length, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Records that an ingestion attempt for `datasetKey` failed validation *before* any
 * row was written — i.e. the caller decided the parsed data looks wrong (e.g.
 * paymentTimes.js's header-column discovery falling back to a hardcoded letter for
 * the name/ABN column) and chose not to call replaceDatasetRecords at all. Marks
 * dataset_snapshot.status='failed' + records `message`, WITHOUT touching
 * register_record — whatever rows were already there (from the last good ingestion)
 * stay exactly as they were, still fully queryable via queryDataset. This is the
 * direct fix for the historical Section 8.3 column-shift bug (CLAUDE.md): a bad
 * parse now fails loudly instead of silently promoting empty/misaligned data.
 *
 * _pool is injectable, same as replaceDatasetRecords/queryDataset.
 */
async function recordIngestionFailure(datasetKey, message, _pool = getPool()) {
  if (!_pool) {
    try {
      fs.writeFileSync(diskFailureMarkerPath(datasetKey), JSON.stringify({ message, at: new Date().toISOString() }));
    } catch (err) {
      console.warn(`[datasetStore] failed to write disk failure marker for ${datasetKey}:`, err.message);
    }
    return { recorded: 'disk' };
  }

  await ensureSchema();
  try {
    await _pool.query(
      `INSERT INTO dataset_snapshot (dataset_key, fetched_at, row_count, status, source_url, error)
       VALUES ($1, now(), 0, 'failed', NULL, $2)
       ON CONFLICT (dataset_key) DO UPDATE SET status='failed', error=$2`,
      [datasetKey, message]
    );
    return { recorded: 'db' };
  } catch (err) {
    console.error(`[datasetStore] recordIngestionFailure(${datasetKey}) DB write failed:`, err.message);
    return { recorded: 'none', error: err.message };
  }
}

/**
 * Returns { rows, fetchedAt, dataSource, stale? } for `datasetKey`. `rows` are the raw
 * `payload` objects as stored (i.e. exactly what the scraper originally passed in) —
 * matching stays the caller's job for datasets whose matching logic is fuzzier than a
 * SQL WHERE clause (e.g. name matching). Optional `abn`/`acn`/`name` narrow the query
 * DB-side for datasets where exact/prefix matching is enough. `slaMs`, if supplied
 * (typically the manifest entry's cadence), sets `stale` on the result — omitted
 * entirely if not supplied, so callers that don't care aren't forced to compute it.
 *
 * _pool is injectable, same as replaceDatasetRecords.
 */
async function queryDataset(datasetKey, { abn, acn, name, slaMs } = {}, _pool = getPool()) {
  if (_pool) {
    try {
      await ensureSchema();
      const snap = await _pool.query(
        'SELECT fetched_at FROM dataset_snapshot WHERE dataset_key = $1',
        [datasetKey]
      );
      if (snap.rows.length === 0) throw new Error(`no snapshot recorded for dataset "${datasetKey}"`);

      const conditions = ['dataset_key = $1'];
      const values = [datasetKey];
      if (abn) { values.push(abn); conditions.push(`abn = $${values.length}`); }
      if (acn) { values.push(acn); conditions.push(`acn = $${values.length}`); }
      if (name) { values.push(`%${name.toLowerCase()}%`); conditions.push(`normalised_name ILIKE $${values.length}`); }

      const res = await _pool.query(
        `SELECT payload FROM register_record WHERE ${conditions.join(' AND ')}`,
        values
      );
      return withStale(
        {
          rows: res.rows.map((r) => r.payload),
          fetchedAt: snap.rows[0].fetched_at,
          dataSource: 'cache',
          storageTier: 'db',
        },
        slaMs
      );
    } catch (err) {
      console.warn(`[datasetStore] queryDataset(${datasetKey}) DB read failed, falling back to disk cache:`, err.message);
    }
  }
  return withStale(readDiskFallback(datasetKey), slaMs);
}

module.exports = { replaceDatasetRecords, queryDataset, recordIngestionFailure, diskCachePath, diskFailureMarkerPath };
