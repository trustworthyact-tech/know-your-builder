// Shared gate for every request routed through the ScrapeOps proxy (LICENCE_MATCHING_PLAN.md
// Phase 1.3). nswFairTrading.js, courtRecords.js (ACT Courts + ACAT) and fwo.js all share one
// ScrapeOps account, which allows at most 5 concurrent requests account-wide and returns HTTP
// 429 past that. Each file used to wrap its own requests independently, so a single search
// could easily exceed the limit on its own (ACT courts alone fires 2 requests per search term,
// all terms concurrently) — and a 429 surfaced as a failed lookup.
//
// One process-wide semaphore (PROXY_MAX_CONCURRENCY, default 5) plus one retry with backoff on
// a 429. Time spent queued for a slot counts against the caller's own timeout (runScraper's
// manifest budget, the 20s NSW discovery bound), so queue waits are logged to make that
// visible. When SCRAPEOPS_API_KEY isn't set (local dev) requests go direct and the semaphore
// is bypassed — there's no shared account to protect.
//
// Two priority tiers. Found in production right after Phase 1 shipped (2026-10-09): a search
// for a company with 11 ABR business names queued ~14 FWO and ~28 ACT court requests at once,
// and NSW's licence requests waited up to 25s behind them, so the nswFairTrading key timed out
// at 45s. NSW makes only a few requests per search and director discovery depends on them, so
// they pass `priority: 'high'` and take the next free slot ahead of normal requests. FIFO
// within each tier, no preemption of running requests, and a starvation bound: after
// MAX_HIGH_STREAK consecutive high grants while normal requests are waiting, one normal
// request goes next.

const axios = require('axios');

const DEFAULT_MAX_CONCURRENCY = 5;
const RETRY_BASE_MS = 1_500;
const RETRY_JITTER_MS = 1_000;
const MAX_HIGH_STREAK = 4;

let active = 0;
const waiters = { high: [], normal: [] };
let highStreak = 0;

function maxConcurrency() {
  const n = parseInt(process.env.PROXY_MAX_CONCURRENCY, 10);
  return n > 0 ? n : DEFAULT_MAX_CONCURRENCY;
}

function proxyEnabled() {
  return Boolean(process.env.SCRAPEOPS_API_KEY);
}

// ScrapeOps' URL-wrapper API. `keepHeaders` is required for nswFairTrading.js's POST — without
// it ScrapeOps substitutes its own headers and Verify NSW rejects the request with a 415 (see
// that file's comment). Falls back to the bare URL when no key is configured.
function proxyUrl(url, { keepHeaders = false } = {}) {
  const key = process.env.SCRAPEOPS_API_KEY;
  if (!key) return url;
  return `https://proxy.scrapeops.io/v1/?api_key=${key}${keepHeaders ? '&keep_headers=true' : ''}&url=${encodeURIComponent(url)}`;
}

// Resolves with how long the caller waited (ms). A released slot is handed straight to the
// next waiter, so `active` only drops when nobody is queued.
async function acquire(priority) {
  if (active < maxConcurrency()) {
    active++;
    return 0;
  }
  const start = Date.now();
  await new Promise((resolve) => waiters[priority === 'high' ? 'high' : 'normal'].push(resolve));
  return Date.now() - start;
}

function nextWaiter() {
  const preferNormal = highStreak >= MAX_HIGH_STREAK && waiters.normal.length > 0;
  if (waiters.high.length > 0 && !preferNormal) {
    highStreak++;
    return waiters.high.shift();
  }
  highStreak = 0;
  return waiters.normal.shift();
}

function release() {
  const next = nextWaiter();
  if (next) next();
  else active--;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs `fn` (one proxied HTTP call) inside the shared semaphore. A 429 is retried once after a
// short jittered backoff, holding the slot meanwhile — the account is already over its limit,
// so giving the slot to someone else would just produce another 429. Any other error, or a
// second 429, propagates to the caller's own error handling unchanged.
async function proxied(fn, { label = 'proxy', priority = 'normal', _enabled = proxyEnabled(), _sleep = sleep } = {}) {
  if (!_enabled) return fn();
  const waited = await acquire(priority);
  if (waited > 0) console.warn(`[proxyLimiter] ${label} waited ${waited}ms for a proxy slot`);
  try {
    try {
      return await fn();
    } catch (err) {
      if (err?.response?.status !== 429) throw err;
      console.warn(`[proxyLimiter] ${label} got HTTP 429 from the proxy, retrying once`);
      await _sleep(RETRY_BASE_MS + Math.random() * RETRY_JITTER_MS);
      return await fn();
    }
  } finally {
    release();
  }
}

// ── Direct first, proxy as fallback (DATA_SOURCES_PLAN.md Phase 2) ──────────────────────────
//
// The three proxy-backed sites were moved onto ScrapeOps because each blocked Railway's IP, and
// blocks come and go: on 2026-10-13 Verify NSW answered Railway directly again (11/11, ~200ms,
// a month after it hung), while ACT courts/ACAT still returned a Cloudflare 403 and FWO still
// timed out. So every request tries the site directly first and only pays for the proxy when
// that fails. A failed direct attempt puts the site in a cooldown, so a still-blocked site
// costs one quick failed attempt per DIRECT_COOLDOWN_MS rather than one per request; a direct
// success clears it. A site that unblocks Railway stops costing credits with no deploy, and
// one that re-blocks falls back to the proxy the same way.
//
// `validate(data)` must recognise a real results (or genuine no-results) response. A response
// that fails it — a challenge or block page served with a 200, or ScrapeOps wrapping an
// upstream error in a 200 — is never returned: on the direct route it's treated as a block, and
// on the proxy route (or the only route, with no proxy key) it throws InvalidResponseError, so
// the caller's existing failure handling reports `partial`/`unavailable` instead of parsing it
// as "no results" (a silent false clean).

const DIRECT_COOLDOWN_MS = 30 * 60 * 1000;
const directBlockedUntil = new Map();

class InvalidResponseError extends Error {}

function send(_http, { method = 'get', url, data, headers }, timeout) {
  return method === 'post' ? _http.post(url, data, { headers, timeout }) : _http.get(url, { headers, timeout, maxRedirects: 5 });
}

function checked(response, validate, label, route) {
  if (!validate(response?.data)) {
    throw new InvalidResponseError(`${label}: ${route} response did not look like a results page`);
  }
  return response.data;
}

// Resolves with the response body. `timeoutMs` is the proxy route's timeout (and the direct
// route's when there's no proxy to fall back to); `directTimeoutMs` bounds the direct attempt
// when the proxy is available, so a site that hangs (FWO) costs at most that much per cooldown.
async function fetchDirectFirst({
  site,
  request,
  validate = () => true,
  label = site,
  priority = 'normal',
  keepHeaders = false,
  timeoutMs = 20_000,
  directTimeoutMs = 8_000,
  _http = axios,
  _enabled = proxyEnabled(),
  _now = Date.now,
  _sleep = sleep,
}) {
  if (!_enabled) return checked(await send(_http, request, timeoutMs), validate, label, 'direct');

  const started = _now();
  if ((directBlockedUntil.get(site) ?? 0) <= _now()) {
    try {
      const data = checked(await send(_http, request, directTimeoutMs), validate, label, 'direct');
      if (directBlockedUntil.has(site)) {
        directBlockedUntil.delete(site);
        console.log(`[proxyLimiter] ${site}: direct requests work again — proxy no longer used`);
      }
      return data;
    } catch (err) {
      directBlockedUntil.set(site, _now() + DIRECT_COOLDOWN_MS);
      console.warn(
        `[proxyLimiter] ${site}: direct request failed (${err.response?.status || err.code || err.message}) after ${_now() - started}ms — using the proxy for ${DIRECT_COOLDOWN_MS / 60_000} min`
      );
    }
  }

  const proxiedRequest = { ...request, url: proxyUrl(request.url, { keepHeaders }) };
  const response = await proxied(() => send(_http, proxiedRequest, timeoutMs), { label, priority, _enabled, _sleep });
  return checked(response, validate, label, 'proxy');
}

function _resetForTests() {
  active = 0;
  waiters.high.length = 0;
  waiters.normal.length = 0;
  highStreak = 0;
  directBlockedUntil.clear();
}

module.exports = { proxied, proxyUrl, proxyEnabled, fetchDirectFirst, InvalidResponseError, DIRECT_COOLDOWN_MS, _resetForTests };
