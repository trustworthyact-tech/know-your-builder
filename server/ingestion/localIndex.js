'use strict';

// The local index store for Phase 3's facts-only copies (DATA_SOURCES_PLAN.md Phase 3). One
// SQLite file on the Railway volume, so search-time lookups never cross the Pacific to Postgres
// (the 2026-10-02 lesson) and the multi-million-row ASIC notices index doesn't land in the small
// shared Supabase database (the Risks section's storage decision).
//
// Uses Node's built-in `node:sqlite` — no native package to compile in the Nixpacks build. On the
// container's Node 23.2 it needs the `--experimental-sqlite` flag (railway.toml's startCommand);
// Node 23.4+/24 load it without one. If it can't load, getDb() returns null and every index
// reports itself not ready, so each check keeps using its live scraper.
//
// The file lives at LOCAL_INDEX_PATH, else <RAILWAY_VOLUME_MOUNT_PATH>/local-indexes.db, else the
// OS temp directory (local dev).

const os = require('os');
const path = require('path');

let DatabaseSync = null;
let loadError = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  loadError = err;
}

const STATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS ingestion_state (
  job                  TEXT PRIMARY KEY,
  last_attempt_at      TEXT,
  last_success_at      TEXT,
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  progress             TEXT
);`;

let db = null;
let openFailed = false;

function indexPath() {
  return process.env.LOCAL_INDEX_PATH || path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || os.tmpdir(), 'local-indexes.db');
}

function configure(database) {
  database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  database.exec(STATE_SCHEMA);
  return database;
}

function getDb() {
  if (db) return db;
  if (!DatabaseSync || openFailed) return null;
  try {
    db = configure(new DatabaseSync(indexPath()));
    return db;
  } catch (err) {
    openFailed = true;
    console.error(`[localIndex] could not open ${indexPath()}: ${err.message} — local indexes disabled, live checks used instead`);
    return null;
  }
}

function available() {
  return Boolean(getDb());
}

// Runs `fn` inside one transaction; rolls back if it throws.
function transaction(database, fn) {
  database.exec('BEGIN');
  try {
    const out = fn();
    database.exec('COMMIT');
    return out;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

// ── Per-job state (also what the dashboard shows) ─────────────────────────────────────────

function getState(database, job) {
  const row = database.prepare('SELECT * FROM ingestion_state WHERE job = ?').get(job);
  if (!row) return { job, lastAttemptAt: null, lastSuccessAt: null, lastError: null, consecutiveFailures: 0, progress: {} };
  return {
    job,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    progress: row.progress ? JSON.parse(row.progress) : {},
  };
}

function saveState(database, state) {
  database
    .prepare(
      `INSERT INTO ingestion_state (job, last_attempt_at, last_success_at, last_error, consecutive_failures, progress)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(job) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at,
         last_error = excluded.last_error, consecutive_failures = excluded.consecutive_failures, progress = excluded.progress`
    )
    .run(state.job, state.lastAttemptAt, state.lastSuccessAt, state.lastError, state.consecutiveFailures, JSON.stringify(state.progress ?? {}));
}

// Tests get a private in-memory database; production code never calls this.
function _useDatabaseForTests(database) {
  db = database ? configure(database) : null;
  openFailed = false;
}

function _openMemoryForTests() {
  if (!DatabaseSync) throw loadError;
  return new DatabaseSync(':memory:');
}

module.exports = { getDb, available, transaction, getState, saveState, indexPath, _useDatabaseForTests, _openMemoryForTests };
