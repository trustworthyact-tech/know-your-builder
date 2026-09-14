'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getPool, isConfigured, _resetForTests } = require('./db');

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
