'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { proxied, proxyUrl, _resetForTests } = require('./proxyLimiter');

const noSleep = async () => {};
const http429 = () => Object.assign(new Error('Request failed with status code 429'), { response: { status: 429 } });

beforeEach(() => {
  _resetForTests();
  delete process.env.PROXY_MAX_CONCURRENCY;
});

test('proxied — never runs more than PROXY_MAX_CONCURRENCY calls at once', async () => {
  process.env.PROXY_MAX_CONCURRENCY = '2';
  let inFlight = 0;
  let peak = 0;
  const call = () =>
    proxied(
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return 'ok';
      },
      { _enabled: true }
    );

  const results = await Promise.all(Array.from({ length: 7 }, call));
  assert.deepEqual(results, Array(7).fill('ok'));
  assert.equal(peak, 2);
});

test('proxied — defaults to 5 concurrent when the env var is unset or invalid', async () => {
  process.env.PROXY_MAX_CONCURRENCY = 'not-a-number';
  let inFlight = 0;
  let peak = 0;
  const call = () =>
    proxied(
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
      },
      { _enabled: true }
    );
  await Promise.all(Array.from({ length: 12 }, call));
  assert.equal(peak, 5);
});

test('proxied — a slot is released when the call throws', async () => {
  process.env.PROXY_MAX_CONCURRENCY = '1';
  await assert.rejects(proxied(async () => { throw new Error('boom'); }, { _enabled: true }), /boom/);
  // Would hang forever if the failed call had leaked its only slot.
  assert.equal(await proxied(async () => 'next', { _enabled: true }), 'next');
});

test('proxied — retries exactly once on HTTP 429, then succeeds', async () => {
  let calls = 0;
  const result = await proxied(
    async () => {
      calls++;
      if (calls === 1) throw http429();
      return 'recovered';
    },
    { _enabled: true, _sleep: noSleep }
  );
  assert.equal(result, 'recovered');
  assert.equal(calls, 2);
});

test('proxied — a second 429 propagates to the caller', async () => {
  let calls = 0;
  await assert.rejects(
    proxied(async () => { calls++; throw http429(); }, { _enabled: true, _sleep: noSleep }),
    (err) => err.response.status === 429
  );
  assert.equal(calls, 2);
});

test('proxied — non-429 errors are not retried', async () => {
  let calls = 0;
  const err500 = Object.assign(new Error('500'), { response: { status: 500 } });
  await assert.rejects(proxied(async () => { calls++; throw err500; }, { _enabled: true, _sleep: noSleep }), /500/);
  assert.equal(calls, 1);
});

test('proxied — bypasses the semaphore entirely when the proxy is disabled', async () => {
  process.env.PROXY_MAX_CONCURRENCY = '1';
  let inFlight = 0;
  let peak = 0;
  const call = () =>
    proxied(
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
      },
      { _enabled: false }
    );
  await Promise.all(Array.from({ length: 4 }, call));
  assert.equal(peak, 4);
});

test('proxyUrl — wraps with the ScrapeOps API, keep_headers only when asked', () => {
  const saved = process.env.SCRAPEOPS_API_KEY;
  try {
    process.env.SCRAPEOPS_API_KEY = 'k123';
    const target = 'https://example.com/a?b=1&c=2';
    assert.equal(
      proxyUrl(target),
      `https://proxy.scrapeops.io/v1/?api_key=k123&url=${encodeURIComponent(target)}`
    );
    assert.equal(
      proxyUrl(target, { keepHeaders: true }),
      `https://proxy.scrapeops.io/v1/?api_key=k123&keep_headers=true&url=${encodeURIComponent(target)}`
    );
    delete process.env.SCRAPEOPS_API_KEY;
    assert.equal(proxyUrl(target), target);
  } finally {
    if (saved === undefined) delete process.env.SCRAPEOPS_API_KEY;
    else process.env.SCRAPEOPS_API_KEY = saved;
  }
});

// ---- priority tiers ----

// Occupies the only slot until `release()` is called, so every later call queues.
function holdOnlySlot() {
  process.env.PROXY_MAX_CONCURRENCY = '1';
  let release;
  const held = proxied(() => new Promise((r) => { release = r; }), { _enabled: true });
  return { held, release: () => release() };
}

const tick = () => new Promise((r) => setImmediate(r));

test('proxied — a high-priority request takes the next slot ahead of queued normal ones', async () => {
  const { held, release } = holdOnlySlot();
  const order = [];
  const queued = [
    proxied(async () => order.push('normal-1'), { _enabled: true }),
    proxied(async () => order.push('normal-2'), { _enabled: true }),
    proxied(async () => order.push('high'), { _enabled: true, priority: 'high' }),
  ];
  await tick();
  release();
  await Promise.all([held, ...queued]);
  assert.deepEqual(order, ['high', 'normal-1', 'normal-2']);
});

test('proxied — requests stay FIFO within a tier', async () => {
  const { held, release } = holdOnlySlot();
  const order = [];
  const queued = ['h1', 'h2', 'h3'].map((id) =>
    proxied(async () => order.push(id), { _enabled: true, priority: 'high' })
  );
  await tick();
  release();
  await Promise.all([held, ...queued]);
  assert.deepEqual(order, ['h1', 'h2', 'h3']);
});

test('proxied — normal requests are not starved by a steady stream of high ones', async () => {
  const { held, release } = holdOnlySlot();
  const order = [];
  const queued = [
    proxied(async () => order.push('normal'), { _enabled: true }),
    ...Array.from({ length: 8 }, (_, i) =>
      proxied(async () => order.push(`high-${i}`), { _enabled: true, priority: 'high' })
    ),
  ];
  await tick();
  release();
  await Promise.all([held, ...queued]);
  // MAX_HIGH_STREAK (4) high grants, then the waiting normal request, then the rest.
  assert.equal(order.indexOf('normal'), 4);
  assert.equal(order.length, 9);
});
