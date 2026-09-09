'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runScraper } = require('./runScraper');
const health = require('./scraperHealth');

function entry(key, overrides = {}) {
  return {
    key,
    label: 'Test Scraper',
    timeoutMs: 200,
    breaker: { failureThreshold: 3, cooldownMs: 100 },
    ...overrides,
  };
}

function collector() {
  const sent = [];
  return { sent, send: (r) => sent.push(r) };
}

const neverResolves = () => new Promise(() => {});

test('runScraper — success path sends searching then done with the result merged in', async () => {
  const { sent, send } = collector();
  await runScraper(entry('t_success'), async () => ({ results: [{ title: 'hit' }], summary: 'ok' }), { send });

  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { key: 't_success', label: 'Test Scraper', status: 'searching' });
  assert.equal(sent[1].status, 'done');
  assert.deepEqual(sent[1].results, [{ title: 'hit' }]);
});

test('runScraper — a rejecting fn sends an error result and never throws', async () => {
  const { sent, send } = collector();
  await runScraper(entry('t_reject'), async () => { throw new Error('boom'); }, { send });

  assert.equal(sent[1].status, 'error');
  assert.equal(sent[1].error, 'Search failed');
  assert.deepEqual(sent[1].results, []);
  assert.equal(sent[1].completeness, 'unavailable');
});

test('runScraper — a hanging fn is cut off by timeoutMs', async () => {
  const { sent, send } = collector();
  const start = Date.now();
  await runScraper(entry('t_timeout', { timeoutMs: 30 }), neverResolves, { send });
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 500, `expected the timeout to fire quickly, took ${elapsed}ms`);
  assert.equal(sent[1].status, 'error');
});

test('runScraper — circuit opens after failureThreshold consecutive failures, then short-circuits', async () => {
  const key = 't_breaker_open';
  const failing = entry(key, { breaker: { failureThreshold: 3, cooldownMs: 10_000 } });
  const { send } = collector();

  for (let i = 0; i < 3; i++) {
    await runScraper(failing, async () => { throw new Error('fail'); }, { send });
  }
  assert.equal(health.isOpen(key), true);

  let fnCalled = false;
  const { sent: shortCircuitSent, send: send2 } = collector();
  await runScraper(failing, async () => { fnCalled = true; return { results: [], summary: 'should not run' }; }, { send: send2 });

  assert.equal(fnCalled, false, 'fn must not be invoked while the circuit is open');
  assert.equal(shortCircuitSent.length, 1);
  assert.equal(shortCircuitSent[0].status, 'error');
  assert.equal(shortCircuitSent[0].completeness, 'unavailable');
});

test('runScraper — half-open trial success closes the circuit', async () => {
  const key = 't_breaker_half_open_success';
  const cfg = entry(key, { breaker: { failureThreshold: 2, cooldownMs: 30 } });
  const { send } = collector();

  await runScraper(cfg, async () => { throw new Error('fail'); }, { send });
  await runScraper(cfg, async () => { throw new Error('fail'); }, { send });
  assert.equal(health.isOpen(key), true);

  await new Promise((r) => setTimeout(r, 40)); // let cooldown elapse

  let fnCalled = false;
  await runScraper(cfg, async () => { fnCalled = true; return { results: [], summary: 'recovered' }; }, { send });

  assert.equal(fnCalled, true, 'half-open trial should let exactly one call through');
  assert.equal(health.isOpen(key), false, 'a successful trial call should close the circuit');
});

test('runScraper — half-open trial failure re-opens the circuit', async () => {
  const key = 't_breaker_half_open_failure';
  const cfg = entry(key, { breaker: { failureThreshold: 2, cooldownMs: 30 } });
  const { send } = collector();

  await runScraper(cfg, async () => { throw new Error('fail'); }, { send });
  await runScraper(cfg, async () => { throw new Error('fail'); }, { send });
  assert.equal(health.isOpen(key), true);

  await new Promise((r) => setTimeout(r, 40));

  await runScraper(cfg, async () => { throw new Error('still failing'); }, { send });
  assert.equal(health.isOpen(key), true, 'a failed trial call should re-open the circuit');
});

test('runScraper — a success resets consecutiveFailures (breaker does not open on an old streak)', async () => {
  const key = 't_breaker_reset_on_success';
  const cfg = entry(key, { breaker: { failureThreshold: 2, cooldownMs: 10_000 } });
  const { send } = collector();

  await runScraper(cfg, async () => { throw new Error('fail'); }, { send });
  await runScraper(cfg, async () => ({ results: [], summary: 'ok' }), { send }); // resets the streak
  await runScraper(cfg, async () => { throw new Error('fail'); }, { send }); // only 1 in a row now

  assert.equal(health.isOpen(key), false);
});
