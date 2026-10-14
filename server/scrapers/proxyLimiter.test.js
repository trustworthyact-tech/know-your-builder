'use strict';

// proxiedRequest (DATA_SOURCES_PLAN.md Phases 2 and 4): direct → residential → residential →
// ScrapeOps, inside one deadline. The priority/starvation behaviour of the slot queues is
// tested in priorityGate.test.js; these tests cover the route chain, its limits and its stats.
const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const {
  proxiedRequest,
  InvalidResponseError,
  DIRECT_COOLDOWN_MS,
  routeOrder,
  scrapeopsUrl,
  residentialProxyForBrowser,
  getRouteStats,
  _resetForTests,
} = require('./proxyLimiter');

const ENV_KEYS = [
  'SCRAPEOPS_API_KEY',
  'PROXY_URL',
  'PROXY_ROUTES',
  'PROXY_ROUTES_FWO',
  'PROXY_MAX_CONCURRENCY',
  'RESIDENTIAL_SITE_CONCURRENCY',
  'RESIDENTIAL_MAX_CONCURRENCY',
];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  _resetForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  mock.restoreAll();
});

const withScrapeOps = () => { process.env.SCRAPEOPS_API_KEY = 'k'; };
const withResidential = () => { process.env.PROXY_URL = 'http://user:pa%3Ass@gw.example-proxy.net:7000'; };

const noSleep = async () => {};
const GOOD = '<li class="search-result">x</li>';
const BLOCK = '<title>Just a moment...</title>';
const err = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

// A fake HTTP client. Each route's handler decides that route's response (an Error makes the
// request fail; a function of the call count lets a route change over time). Records the route
// every call took: a ScrapeOps URL → 'scrapeops', a request carrying the residential agent →
// 'residential', anything else → 'direct'.
function fakeRoutes(handlers) {
  const calls = [];
  const configs = [];
  const answer = async (url, config = {}) => {
    const route = url.includes('proxy.scrapeops.io') ? 'scrapeops' : config.httpsAgent ? 'residential' : 'direct';
    calls.push(route);
    configs.push({ url, ...config });
    const handler = handlers[route] ?? (() => new Error(`no ${route} handler`));
    const out = typeof handler === 'function' ? handler(calls.filter((c) => c === route).length, url) : handler;
    if (out instanceof Error) throw out;
    return { data: out };
  };
  return { calls, configs, get: (url, config) => answer(url, config), post: (url, _data, config) => answer(url, config) };
}

const opts = (http, extra = {}) => ({
  site: 'test-site',
  url: 'https://example.gov.au/search?q=x',
  validate: (d) => d === GOOD,
  _http: http,
  _sleep: noSleep,
  _agent: () => ({ fake: 'agent' }),
  ...extra,
});

// ── Route order and configuration ─────────────────────────────────────────────────────────

test('routeOrder — defaults to direct, residential twice, then ScrapeOps; env overrides, per site first', () => {
  assert.deepEqual(routeOrder('fwo'), ['direct', 'residential', 'residential', 'scrapeops']);
  process.env.PROXY_ROUTES = 'direct, scrapeops';
  assert.deepEqual(routeOrder('fwo'), ['direct', 'scrapeops']);
  process.env.PROXY_ROUTES_FWO = 'direct,scrapeops,residential,bogus';
  assert.deepEqual(routeOrder('fwo'), ['direct', 'scrapeops', 'residential']);
  assert.deepEqual(routeOrder('act-courts'), ['direct', 'scrapeops']);
  process.env.PROXY_ROUTES = 'nonsense';
  assert.deepEqual(routeOrder('act-courts'), ['direct', 'residential', 'residential', 'scrapeops']);
});

test('proxiedRequest — a working site is fetched directly, with no proxy call', async () => {
  withScrapeOps();
  withResidential();
  const http = fakeRoutes({ direct: GOOD, residential: GOOD, scrapeops: GOOD });
  assert.equal(await proxiedRequest(opts(http)), GOOD);
  assert.deepEqual(http.calls, ['direct']);
});

test('proxiedRequest — a blocked site goes to the residential proxy, not ScrapeOps', async () => {
  withScrapeOps();
  withResidential();
  const http = fakeRoutes({ direct: err(403), residential: GOOD, scrapeops: GOOD });
  assert.equal(await proxiedRequest(opts(http)), GOOD);
  assert.deepEqual(http.calls, ['direct', 'residential']);
  assert.equal(http.configs[1].proxy, false, 'axios must not apply its own proxy handling on top of the agent');
});

test('proxiedRequest — a failed residential attempt is retried once with a new agent, then ScrapeOps', async () => {
  withScrapeOps();
  withResidential();
  let agents = 0;
  const http = fakeRoutes({ direct: err(403), residential: (n) => (n === 1 ? err(502) : BLOCK), scrapeops: GOOD });
  assert.equal(await proxiedRequest(opts(http, { _agent: () => ({ fake: ++agents }) })), GOOD);
  assert.deepEqual(http.calls, ['direct', 'residential', 'residential', 'scrapeops']);
  assert.equal(agents, 2, 'each residential attempt gets its own agent (a new connection, so a new IP)');
});

test('proxiedRequest — the second residential attempt can rescue the first', async () => {
  withResidential();
  const http = fakeRoutes({ direct: err(403), residential: (n) => (n === 1 ? err(407) : GOOD) });
  assert.equal(await proxiedRequest(opts(http)), GOOD);
  assert.deepEqual(http.calls, ['direct', 'residential', 'residential']);
});

test('proxiedRequest — with no residential proxy configured, the chain is Phase 2\'s direct → ScrapeOps', async () => {
  withScrapeOps();
  const http = fakeRoutes({ direct: err(403), scrapeops: GOOD });
  assert.equal(await proxiedRequest(opts(http)), GOOD);
  assert.deepEqual(http.calls, ['direct', 'scrapeops']);
});

test('proxiedRequest — with no proxy at all, only the direct route runs, and a block page throws', async () => {
  const http = fakeRoutes({ direct: BLOCK });
  await assert.rejects(proxiedRequest(opts(http)), InvalidResponseError);
  assert.deepEqual(http.calls, ['direct']);
});

test('proxiedRequest — a per-site route order is honoured (FWO keeping ScrapeOps first)', async () => {
  withScrapeOps();
  withResidential();
  process.env.PROXY_ROUTES_FWO = 'direct,scrapeops,residential';
  const http = fakeRoutes({ direct: err(403), residential: GOOD, scrapeops: GOOD });
  await proxiedRequest(opts(http, { site: 'fwo' }));
  assert.deepEqual(http.calls, ['direct', 'scrapeops']);
});

test('proxiedRequest — a block page from every route throws; it is never returned as results', async () => {
  withScrapeOps();
  withResidential();
  const http = fakeRoutes({ direct: BLOCK, residential: BLOCK, scrapeops: BLOCK });
  await assert.rejects(proxiedRequest(opts(http)), InvalidResponseError);
  assert.deepEqual(http.calls, ['direct', 'residential', 'residential', 'scrapeops']);
});

test('proxiedRequest — every route failing throws the last route\'s error', async () => {
  withScrapeOps();
  withResidential();
  const http = fakeRoutes({ direct: err(403), residential: err(502), scrapeops: new Error('scrapeops down') });
  await assert.rejects(proxiedRequest(opts(http)), /scrapeops down/);
});

// ── Direct cooldown (Phase 2 behaviour, unchanged) ──────────────────────────────────────

test('proxiedRequest — after a failed direct attempt, direct is skipped for the cooldown, then retried', async () => {
  withScrapeOps();
  let now = 1_000_000;
  const http = fakeRoutes({ direct: err(403), scrapeops: GOOD });
  await proxiedRequest(opts(http, { _now: () => now }));
  await proxiedRequest(opts(http, { _now: () => now }));
  assert.deepEqual(http.calls, ['direct', 'scrapeops', 'scrapeops']);
  now += DIRECT_COOLDOWN_MS + 1;
  await proxiedRequest(opts(http, { _now: () => now }));
  assert.deepEqual(http.calls.slice(3), ['direct', 'scrapeops']);
});

test('proxiedRequest — a direct success clears the cooldown', async () => {
  withScrapeOps();
  let now = 5_000_000;
  let blocked = true;
  const http = fakeRoutes({ direct: () => (blocked ? err(403) : GOOD), scrapeops: GOOD });
  await proxiedRequest(opts(http, { _now: () => now }));
  blocked = false;
  now += DIRECT_COOLDOWN_MS + 1;
  await proxiedRequest(opts(http, { _now: () => now }));
  await proxiedRequest(opts(http, { _now: () => now }));
  assert.deepEqual(http.calls, ['direct', 'scrapeops', 'direct', 'direct']);
});

test('proxiedRequest — a site in cooldown still goes direct when direct is the only route', async () => {
  withScrapeOps();
  const http = fakeRoutes({ direct: err(403), scrapeops: GOOD });
  await proxiedRequest(opts(http));
  delete process.env.SCRAPEOPS_API_KEY;
  await assert.rejects(proxiedRequest(opts(http)), /403/);
  assert.deepEqual(http.calls, ['direct', 'scrapeops', 'direct']);
});

// ── Deadline ─────────────────────────────────────────────────────────────────────────────

test('proxiedRequest — every attempt shares one deadline; no route starts after it has passed', async () => {
  withScrapeOps();
  withResidential();
  let now = 0;
  const timeouts = [];
  const http = fakeRoutes({
    direct: () => { now += 5_000; return err(403); },
    residential: () => { now += 12_000; return err(502); },
    scrapeops: GOOD,
  });
  const record = (route) => (url, config) => { timeouts.push([route, config.timeout]); return http.get(url, config); };
  const client = { get: (url, config) => record(url.includes('scrapeops') ? 'scrapeops' : config.httpsAgent ? 'residential' : 'direct')(url, config) };
  await assert.rejects(proxiedRequest(opts(client, { deadlineMs: 17_000, directTimeoutMs: 5_000, _now: () => now })), /502/);
  assert.deepEqual(http.calls, ['direct', 'residential'], 'the deadline passed during the first residential attempt');
  assert.deepEqual(timeouts, [['direct', 5_000], ['residential', 12_000]]);
});

test('proxiedRequest — the last route gets whatever time is left', async () => {
  withScrapeOps();
  let now = 0;
  const seen = [];
  const http = {
    get: async (url, config) => {
      seen.push(config.timeout);
      if (!url.includes('scrapeops')) { now += 4_000; throw err(403); }
      return { data: GOOD };
    },
  };
  await proxiedRequest(opts(http, { deadlineMs: 25_000, directTimeoutMs: 5_000, _now: () => now }));
  assert.deepEqual(seen, [5_000, 21_000]);
});

// ── ScrapeOps specifics ──────────────────────────────────────────────────────────────────

test('proxiedRequest — a ScrapeOps 429 is retried exactly once', async () => {
  withScrapeOps();
  const http = fakeRoutes({ direct: err(403), scrapeops: (n) => (n === 1 ? err(429) : GOOD) });
  assert.equal(await proxiedRequest(opts(http)), GOOD);
  assert.deepEqual(http.calls, ['direct', 'scrapeops', 'scrapeops']);
});

test('proxiedRequest — a second 429, or any other ScrapeOps error, propagates without more retries', async () => {
  withScrapeOps();
  const twice = fakeRoutes({ direct: err(403), scrapeops: err(429) });
  await assert.rejects(proxiedRequest(opts(twice)), (e) => e.response.status === 429);
  assert.equal(twice.calls.filter((c) => c === 'scrapeops').length, 2);
  _resetForTests();
  const once = fakeRoutes({ direct: err(403), scrapeops: err(500) });
  await assert.rejects(proxiedRequest(opts(once)), /500/);
  assert.equal(once.calls.filter((c) => c === 'scrapeops').length, 1);
});

test('scrapeopsUrl / proxiedRequest — keep_headers only when asked (NSW)', async () => {
  withScrapeOps();
  const target = 'https://example.com/a?b=1&c=2';
  assert.equal(scrapeopsUrl(target), `https://proxy.scrapeops.io/v1/?api_key=k&url=${encodeURIComponent(target)}`);
  assert.equal(scrapeopsUrl(target, { keepHeaders: true }), `https://proxy.scrapeops.io/v1/?api_key=k&keep_headers=true&url=${encodeURIComponent(target)}`);
  const http = fakeRoutes({ direct: err(403), scrapeops: GOOD });
  await proxiedRequest(opts(http, { keepHeaders: true, method: 'post', data: { q: 1 } }));
  assert.match(http.configs[1].url, /keep_headers=true/);
});

// ── Concurrency limits ───────────────────────────────────────────────────────────────────

function peakTracker(route) {
  let inFlight = 0;
  const state = { peak: 0 };
  const http = {
    get: async (url, config) => {
      const r = url.includes('scrapeops') ? 'scrapeops' : config.httpsAgent ? 'residential' : 'direct';
      if (r === 'direct') throw err(403);
      if (r !== route) throw err(502);
      inFlight++;
      state.peak = Math.max(state.peak, inFlight);
      await new Promise((res) => setTimeout(res, 10));
      inFlight--;
      return { data: GOOD };
    },
  };
  return { http, state };
}

test('proxiedRequest — ScrapeOps never exceeds PROXY_MAX_CONCURRENCY', async () => {
  withScrapeOps();
  process.env.PROXY_MAX_CONCURRENCY = '2';
  const { http, state } = peakTracker('scrapeops');
  await Promise.all(Array.from({ length: 6 }, () => proxiedRequest(opts(http))));
  assert.equal(state.peak, 2);
});

test('proxiedRequest — the residential route is limited per site and overall', async () => {
  withResidential();
  process.env.RESIDENTIAL_SITE_CONCURRENCY = '2';
  process.env.RESIDENTIAL_MAX_CONCURRENCY = '3';
  const perSite = peakTracker('residential');
  await Promise.all(Array.from({ length: 6 }, () => proxiedRequest(opts(perSite.http, { site: 'a' }))));
  assert.equal(perSite.state.peak, 2, 'one site is held to its per-site limit');

  _resetForTests();
  const overall = peakTracker('residential');
  await Promise.all(
    ['a', 'b', 'c'].flatMap((site) => Array.from({ length: 3 }, () => proxiedRequest(opts(overall.http, { site }))))
  );
  assert.equal(overall.state.peak, 3, 'all sites together are held to the overall limit');
});

// ── Stats and the ScrapeOps-share alert ──────────────────────────────────────────────────

test('getRouteStats — counts outcomes per route and the share of proxied requests ScrapeOps served', async () => {
  withScrapeOps();
  withResidential();
  const http = fakeRoutes({ direct: err(403), residential: (n) => (n <= 2 ? err(502) : GOOD), scrapeops: GOOD });
  await proxiedRequest(opts(http)); // direct ✗, residential ✗ ✗, scrapeops ✓
  await proxiedRequest(opts(http)); // (direct skipped) residential ✓
  const stats = getRouteStats();
  assert.deepEqual(stats.routes.direct, { ok: 0, failed: 1 });
  assert.deepEqual(stats.routes.residential, { ok: 1, failed: 2 });
  assert.deepEqual(stats.routes.scrapeops, { ok: 1, failed: 0 });
  assert.equal(stats.scrapeopsShare, 0.5);
  assert.equal(stats.scrapeopsShareSample, 2);
  assert.deepEqual(stats.configured, { direct: true, residential: true, scrapeops: true });
});

test('getRouteStats — an alert is logged (at most hourly) once ScrapeOps serves over 5% with a residential proxy set', async () => {
  withScrapeOps();
  withResidential();
  const logged = mock.method(console, 'error', () => {});
  mock.method(console, 'warn', () => {});
  let now = 0;
  const http = fakeRoutes({ direct: err(403), residential: err(502), scrapeops: GOOD });
  for (let i = 0; i < 25; i++) await proxiedRequest(opts(http, { _now: () => now }));
  const alerts = logged.mock.calls.filter((c) => /ALERT: ScrapeOps served/.test(c.arguments[0]));
  assert.equal(alerts.length, 1, 'one alert, not one per request');
  now += 60 * 60 * 1000;
  await proxiedRequest(opts(http, { _now: () => now }));
  assert.equal(logged.mock.calls.filter((c) => /ALERT: ScrapeOps served/.test(c.arguments[0])).length, 2);
});

test('getRouteStats — no alert without a residential proxy (ScrapeOps is then the only proxy)', async () => {
  withScrapeOps();
  const logged = mock.method(console, 'error', () => {});
  mock.method(console, 'warn', () => {});
  const http = fakeRoutes({ direct: err(403), scrapeops: GOOD });
  for (let i = 0; i < 25; i++) await proxiedRequest(opts(http));
  assert.equal(logged.mock.calls.length, 0);
  assert.equal(getRouteStats().scrapeopsShare, 1);
});

// ── Browser proxy settings ───────────────────────────────────────────────────────────────

test('residentialProxyForBrowser — splits PROXY_URL into a server and decoded credentials', () => {
  assert.equal(residentialProxyForBrowser(), null);
  withResidential();
  assert.deepEqual(residentialProxyForBrowser(), { server: 'http://gw.example-proxy.net:7000', username: 'user', password: 'pa:ss' });
  process.env.PROXY_URL = 'not a url';
  assert.equal(residentialProxyForBrowser(), null);
});
