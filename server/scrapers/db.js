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

function isConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!isConfigured()) return null;
  if (pool) return pool;
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Railway's managed Postgres requires SSL; rejectUnauthorized: false matches Railway's
    // own connection guidance (their certs aren't in the default trust store).
    ssl: process.env.DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  });
  return pool;
}

// Idempotent — safe to call on every startup. Non-fatal on failure: callers (datasetStore.js)
// already fall back to disk-cache behavior if the DB is unreachable, so a schema-apply
// failure here should log loudly, not crash the process.
async function ensureSchema() {
  if (schemaEnsured) return true;
  const p = getPool();
  if (!p) return false;
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await p.query(schemaSql);
    schemaEnsured = true;
    return true;
  } catch (err) {
    console.error('[db] failed to apply schema.sql:', err.message);
    return false;
  }
}

// Test-only: resets module state between test files (node --test runs each file in its
// own process by default, but a single file exercising both configured/unconfigured
// states needs this).
function _resetForTests() {
  pool = null;
  schemaEnsured = false;
}

module.exports = { getPool, ensureSchema, isConfigured, _resetForTests };
