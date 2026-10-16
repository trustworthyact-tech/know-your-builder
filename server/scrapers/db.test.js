'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getPool, isConfigured, ensureSchema, _resetForTests, _setPoolForTests } = require('./db');

// Regression guard for the 2026-09-14 production incident: DATABASE_URL was added in
// Railway for the first time and the entire container crashed immediately. Root cause —
// pg's Pool crashes the whole process on any idle-client connection error (dropped
// connection, auth hiccup, network blip) unless something is listening for its 'error'
// event; Node treats an unhandled EventEmitter 'error' as fatal. getPool() previously
// created the Pool with no listener at all.
//
// Creating a real pg.Pool does not open a network connection by itself (connections are
// opened lazily, on first checkout/query) — so this test can safely construct one against
// a fake connection string and prove the fix by actually emitting 'error' on it. Without
// the fix, that emit line would crash this entire test process (not just fail an
// assertion) — this is the fatal-EventEmitter mechanism, not a normal exception a
// try/catch could contain, so a soft assertion isn't a strong enough guard on its own.

test('getPool — the returned pool has a listener for "error", so an idle-client error does not crash the process', () => {
  process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
  _resetForTests();
  try {
    const pool = getPool();
    assert.ok(isConfigured());
    assert.equal(pool.listenerCount('error') > 0, true);

    // The actual proof: this would throw (crashing the process, not just this assertion)
    // if no 'error' listener were attached.
    assert.doesNotThrow(() => pool.emit('error', new Error('simulated idle-client error')));
  } finally {
    _resetForTests();
    delete process.env.DATABASE_URL;
  }
});

test('getPool — returns null when DATABASE_URL is not configured', () => {
  delete process.env.DATABASE_URL;
  _resetForTests();
  assert.equal(getPool(), null);
  assert.equal(isConfigured(), false);
});

// Regression guard for the 2026-09-15 production incident: a real search showed every
// mvpScope key that depends on the database (directly, or via the shared resolveDirectors()
// dependency chain) timing out at exactly its own runScraper() ceiling — the classic
// signature of an unbounded wait upstream that only ever gets rescued by an unrelated
// caller's own timeout. pg's own default for connectionTimeoutMillis is 0 (wait forever)
// — every fail-open catch/disk-fallback path in this codebase assumes a stuck connection
// attempt eventually rejects; none of that mattered while nothing ever bounded the wait.
test('getPool — connectionTimeoutMillis is set, so a stuck connection attempt fails fast instead of hanging forever', () => {
  process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
  _resetForTests();
  try {
    const pool = getPool();
    assert.ok(pool.options.connectionTimeoutMillis > 0);
  } finally {
    _resetForTests();
    delete process.env.DATABASE_URL;
  }
});

// Found 2026-10-16: "[db] failed to apply schema.sql: deadlock detected" on every startup, from
// several refresh jobs applying schema.sql at once on separate pooled connections.
function fakePool(responses) {
  const calls = [];
  return {
    calls,
    query: async (sql) => {
      calls.push(sql);
      await new Promise((r) => setTimeout(r, 5));
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return { rows: [] };
    },
  };
}
const deadlock = () => Object.assign(new Error('deadlock detected'), { code: '40P01' });
const noSleep = { _sleep: async () => {} };

test('ensureSchema — concurrent callers share one attempt instead of racing each other', async () => {
  process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
  const fake = fakePool([undefined]);
  _setPoolForTests(fake);
  try {
    const results = await Promise.all(Array.from({ length: 5 }, () => ensureSchema(noSleep)));
    assert.deepEqual(results, [true, true, true, true, true]);
    assert.equal(fake.calls.length, 1);
    assert.equal(await ensureSchema(noSleep), true);
    assert.equal(fake.calls.length, 1, 'applied once per process');
  } finally {
    _resetForTests();
    delete process.env.DATABASE_URL;
  }
});

test('ensureSchema — a deadlock (e.g. the other container during a deploy) is retried once', async () => {
  process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
  const fake = fakePool([deadlock(), undefined]);
  _setPoolForTests(fake);
  try {
    assert.equal(await ensureSchema(noSleep), true);
    assert.equal(fake.calls.length, 2);
  } finally {
    _resetForTests();
    delete process.env.DATABASE_URL;
  }
});

test('ensureSchema — a failure is logged and returns false, and a later call tries again', async (t) => {
  process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
  t.mock.method(console, 'error', () => {});
  const fake = fakePool([deadlock(), deadlock(), new Error('connection refused'), undefined]);
  _setPoolForTests(fake);
  try {
    assert.equal(await ensureSchema(noSleep), false, 'two deadlocks in a row give up');
    assert.equal(await ensureSchema(noSleep), false);
    assert.equal(await ensureSchema(noSleep), true);
    assert.equal(fake.calls.length, 4);
  } finally {
    _resetForTests();
    delete process.env.DATABASE_URL;
  }
});
