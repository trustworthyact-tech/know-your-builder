'use strict';

const fs = require('fs');
const path = require('path');

// Module-level singleton, not the globalThis pattern — that pattern exists specifically
// for Next.js hot-reload safety (see CLAUDE.md's "Singletons" convention). server/ is a
// single long-running process (same reasoning CLAUDE.md gives for why workers use a plain
// module-level client instead), so a plain module-level pool is the right fit here.
//
// Lazily required so that server/ can still boot and run entirely on the disk-cache
// fallback path (e.g. local dev, per CLAUDE.md's 3-terminal run instructions, which have
// no DB setup step) without `pg` even needing to resolve/connect.
let pool = null;
let schemaEnsured = false;
let schemaPromise = null;

function isConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!isConfigured()) return null;
  if (pool) return pool;
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Works against both Railway's managed Postgres and Supabase's connection pooler;
    // rejectUnauthorized: false skips validating the cert chain against Node's default
    // trust store rather than requiring a specific provider's CA to be installed.
    ssl: process.env.DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    // Found live in production (2026-09-14): pg's own default for this is 0 — wait
    // forever for a connection to free up. Every one of this codebase's DB-touching
    // functions (queryDataset, replaceDatasetRecords, healthHistory's logEvent/getRollup)
    // already has a fail-open catch or disk fallback — but every one of those is
    // defeated if the .connect()/.query() call they're wrapping never settles at all.
    // Observed symptom: a real search where every DB-touching (or resolveDirectors()-
    // dependent, since that itself does a dataset lookup) mvpScope key timed out at
    // exactly its own runScraper() ceiling (10s/20s/45s) — non-mvp keys sharing the same
    // dependency just hung silently with no ceiling to report against at all. A bounded
    // connection-acquisition timeout turns "hang forever, only rescued by an unrelated
    // caller's timeout" into "fail fast," which is what every existing fallback path here
    // was already written assuming would happen.
    connectionTimeoutMillis: 5_000,
  });
  // REQUIRED — without this, pg's Pool crashes the entire process on any idle-client
  // connection error (a dropped connection, an auth hiccup, a network blip): Node treats
  // an EventEmitter 'error' event with no listener as fatal and throws, bypassing every
  // try/catch in this codebase entirely (this is a distinct mechanism from a promise
  // rejection — every scraper/refresh-job try/catch here is irrelevant to it). This was
  // found live in production (2026-09-14): adding DATABASE_URL for the first time crashed
  // the whole Railway container immediately, taking down the entire app, not just the
  // health-history feature that motivated adding it.
  pool.on('error', (err) => {
    console.error('[db] pool error (idle client) — not fatal, connection will be retried:', err.message);
  });
  return pool;
}

// Idempotent — safe to call on every startup. Non-fatal on failure: callers (datasetStore.js)
// already fall back to disk-cache behavior if the DB is unreachable, so a schema-apply
// failure here should log loudly, not crash the process.
//
// Single flight (found 2026-10-16: "[db] failed to apply schema.sql: deadlock detected" on
// every startup): several refresh jobs call this at once on boot, and each applied schema.sql
// on its own pooled connection, so their ALTER TABLE statements deadlocked each other. Now
// concurrent callers share one attempt. A deadlock can still come from the other container
// during a deploy (Railway briefly runs old and new side by side), so a deadlock is retried
// once after a short pause. A failed attempt is forgotten, so a later call tries again.
const DEADLOCK = '40P01';

async function applySchema(p, _sleep) {
  const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  for (let attempt = 1; ; attempt++) {
    try {
      await p.query(schemaSql);
      return;
    } catch (err) {
      if (err?.code !== DEADLOCK || attempt >= 2) throw err;
      await _sleep(1_000 + Math.random() * 1_000);
    }
  }
}

async function ensureSchema({ _sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (schemaEnsured) return true;
  const p = getPool();
  if (!p) return false;
  schemaPromise ??= applySchema(p, _sleep)
    .then(() => {
      schemaEnsured = true;
      return true;
    })
    .catch((err) => {
      console.error('[db] failed to apply schema.sql:', err.message);
      return false;
    })
    .finally(() => {
      schemaPromise = null;
    });
  return schemaPromise;
}

// Test-only: resets module state between test files (node --test runs each file in its
// own process by default, but a single file exercising both configured/unconfigured
// states needs this).
function _resetForTests() {
  pool = null;
  schemaEnsured = false;
  schemaPromise = null;
}

// Test-only: installs a fake pool so ensureSchema can be tested without a database.
function _setPoolForTests(fake) {
  pool = fake;
  schemaEnsured = false;
  schemaPromise = null;
}

module.exports = { getPool, ensureSchema, isConfigured, _resetForTests, _setPoolForTests };
