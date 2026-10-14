// The only way to make a request to a site that may block Railway's IP (CLAUDE.md convention).
// nswFairTrading.js, courtRecords.js (ACT courts + ACAT) and fwo.js all go through
// proxiedRequest() below.
//
// History:
// - LICENCE_MATCHING_PLAN.md Phase 1.3 (2026-10-09): one process-wide semaphore in front of the
//   ScrapeOps account (5 concurrent account-wide, HTTP 429 past that), one retry on a 429, and
//   two priority tiers after NSW's few requests waited 25s behind ~40 FWO/ACT court requests.
// - DATA_SOURCES_PLAN.md Phase 2 (2026-10-13): direct first, proxy as fallback. Blocks come and
//   go (Verify NSW answered Railway directly again on 2026-10-13, a month after it hung), so
//   every request tries the site directly unless that site is in a cooldown after a failed
//   direct attempt. `validate` must recognise a real results page, so a block page served with
//   a 200 is a failure, never "no results".
// - DATA_SOURCES_PLAN.md Phase 4 (this version): a chain of routes instead of a single proxy
//   fallback. Default order: direct → residential → residential again (a new connection, so a
//   rotating gateway gives a new IP) → ScrapeOps. The residential route is any HTTP(S) proxy
//   URL in PROXY_URL (a pay-as-you-go residential provider with Australian IPs); with it unset
//   the chain is exactly Phase 2's direct → ScrapeOps. The order can be changed per deploy with
//   PROXY_ROUTES, or per site with PROXY_ROUTES_<SITE> (e.g. PROXY_ROUTES_FWO) — FWO's Akamai
//   may reject Node's TLS fingerprint through a plain proxy, in which case FWO keeps ScrapeOps
//   (which makes the request itself) as its first proxy route.
//
// Every attempt runs inside one deadline taken from the caller's budget (`deadlineMs`), so a
// slow route leaves less time for the next rather than extending the request. Time spent queued
// for a slot counts against it too.
//
// Concurrency: ScrapeOps keeps its account-wide limit (PROXY_MAX_CONCURRENCY, default 5). The
// residential route has a per-site limit (RESIDENTIAL_SITE_CONCURRENCY, default 4) and an
// overall one (RESIDENTIAL_MAX_CONCURRENCY, default 12). Both keep NSW's 'high' priority tier
// and its starvation bound (priorityGate.js). The direct route isn't gated, as before.

const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { createGate } = require('./priorityGate');

const ROUTES = ['direct', 'residential', 'scrapeops'];
const DEFAULT_ROUTE_ORDER = ['direct', 'residential', 'residential', 'scrapeops'];
const DIRECT_COOLDOWN_MS = 30 * 60 * 1000;
const RESIDENTIAL_ATTEMPT_MS = 12_000;
const RETRY_BASE_MS = 1_500;
const RETRY_JITTER_MS = 1_000;

const envInt = (name, fallback) => {
  const n = parseInt(process.env[name], 10);
  return n > 0 ? n : fallback;
};

const scrapeopsGate = createGate({ limit: () => envInt('PROXY_MAX_CONCURRENCY', 5) });
const residentialGate = createGate({ limit: () => envInt('RESIDENTIAL_MAX_CONCURRENCY', 12) });
const residentialSiteGates = new Map();
function residentialSiteGate(site) {
  if (!residentialSiteGates.has(site)) {
    residentialSiteGates.set(site, createGate({ limit: () => envInt('RESIDENTIAL_SITE_CONCURRENCY', 4) }));
  }
  return residentialSiteGates.get(site);
}

class InvalidResponseError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function routeConfigured(route) {
  if (route === 'residential') return Boolean(process.env.PROXY_URL);
  if (route === 'scrapeops') return Boolean(process.env.SCRAPEOPS_API_KEY);
  return route === 'direct';
}

function parseRoutes(raw) {
  return raw.split(',').map((r) => r.trim().toLowerCase()).filter((r) => ROUTES.includes(r));
}

// The configured order for a site, before dropping routes that have no credentials.
function routeOrder(site) {
  const perSite = process.env[`PROXY_ROUTES_${String(site).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  const raw = perSite || process.env.PROXY_ROUTES;
  const parsed = raw ? parseRoutes(raw) : [];
  return parsed.length > 0 ? parsed : DEFAULT_ROUTE_ORDER;
}

// ScrapeOps' URL-wrapper API. `keepHeaders` is required for nswFairTrading.js's POST — without
// it ScrapeOps substitutes its own headers and Verify NSW rejects the request with a 415.
function scrapeopsUrl(url, { keepHeaders = false } = {}) {
  return `https://proxy.scrapeops.io/v1/?api_key=${process.env.SCRAPEOPS_API_KEY}${keepHeaders ? '&keep_headers=true' : ''}&url=${encodeURIComponent(url)}`;
}

// A fresh agent per attempt: no keep-alive, so each attempt opens a new connection to the
// provider's gateway, which rotating residential gateways answer from a new IP.
function makeResidentialAgent() {
  return new HttpsProxyAgent(process.env.PROXY_URL, { keepAlive: false });
}

// PROXY_URL split into what Chromium needs: --proxy-server takes no credentials, so they're
// supplied separately with page.authenticate(). Null when no residential proxy is configured.
function residentialProxyForBrowser() {
  if (!process.env.PROXY_URL) return null;
  try {
    const u = new URL(process.env.PROXY_URL);
    return {
      server: `${u.protocol}//${u.host}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return null;
  }
}

function send(_http, { method, url, data, headers }, timeout, extra = {}) {
  return method === 'post'
    ? _http.post(url, data, { headers, timeout, ...extra })
    : _http.get(url, { headers, timeout, maxRedirects: 5, ...extra });
}

function checked(response, validate, label, route) {
  if (!validate(response?.data)) {
    throw new InvalidResponseError(`${label}: ${route} response did not look like a results page`);
  }
  return response.data;
}

function deadlineError(label) {
  return Object.assign(new Error(`${label}: request deadline passed`), { code: 'DEADLINE' });
}

const describe = (err) => err?.response?.status || err?.code || err?.message;

// ── Route statistics (Phase 4: alert if ScrapeOps serves more than 5% of proxied requests) ──
//
// Counts since process start, per route. `proxyServed` is a rolling window of which proxy route
// served each request that needed one; when a residential proxy is configured and ScrapeOps
// serves more than SCRAPEOPS_SHARE_ALERT of that window, a warning is logged (at most hourly)
// — the residential provider is failing and ScrapeOps credits are being spent instead. Shown
// on /admin/scraper-health via getRouteStats().
const SCRAPEOPS_SHARE_ALERT = 0.05;
const SHARE_WINDOW = 200;
const SHARE_MIN_SAMPLE = 20;
const SHARE_ALERT_INTERVAL_MS = 60 * 60 * 1000;
const routeCounts = {};
const proxyServed = [];
let lastShareAlertAt = -Infinity;

function resetStats() {
  for (const r of ROUTES) routeCounts[r] = { ok: 0, failed: 0 };
  proxyServed.length = 0;
  lastShareAlertAt = -Infinity;
}
resetStats();

function scrapeopsShare() {
  if (proxyServed.length === 0) return null;
  return proxyServed.filter((r) => r === 'scrapeops').length / proxyServed.length;
}

function recordServed(route, now) {
  if (route === 'direct') return;
  proxyServed.push(route);
  if (proxyServed.length > SHARE_WINDOW) proxyServed.shift();
  const share = scrapeopsShare();
  if (
    routeConfigured('residential') &&
    proxyServed.length >= SHARE_MIN_SAMPLE &&
    share > SCRAPEOPS_SHARE_ALERT &&
    now - lastShareAlertAt >= SHARE_ALERT_INTERVAL_MS
  ) {
    lastShareAlertAt = now;
    console.error(
      `[proxyLimiter] ALERT: ScrapeOps served ${(share * 100).toFixed(1)}% of the last ${proxyServed.length} proxied requests (threshold ${SCRAPEOPS_SHARE_ALERT * 100}%) — the residential proxy is failing`
    );
  }
}

function getRouteStats() {
  return {
    routes: JSON.parse(JSON.stringify(routeCounts)),
    configured: Object.fromEntries(ROUTES.map((r) => [r, routeConfigured(r)])),
    defaultOrder: routeOrder('*'),
    scrapeopsShare: scrapeopsShare(),
    scrapeopsShareSample: proxyServed.length,
    scrapeopsShareAlertThreshold: SCRAPEOPS_SHARE_ALERT,
  };
}

// ── The request ──────────────────────────────────────────────────────────────────────────

const directBlockedUntil = new Map();

async function withGates(gates, priority, label, route, deadline, now, fn) {
  const held = [];
  try {
    for (const gate of gates) {
      const waited = await gate.acquire(priority);
      held.push(gate);
      if (waited > 0) console.warn(`[proxyLimiter] ${label} waited ${waited}ms for a ${route} slot`);
    }
    if (deadline - now() <= 0) throw deadlineError(label);
    return await fn();
  } finally {
    for (const gate of held.reverse()) gate.release();
  }
}

// Resolves with the response body, or throws: the last route's error, an InvalidResponseError
// when a response fails `validate` (never returned as results), or a deadline error. Callers'
// existing failure handling turns any throw into `partial`/`unavailable`.
//
// `directTimeoutMs` bounds the direct attempt when another route follows it, so a site that
// hangs (FWO) costs at most that much per cooldown. `routes` overrides the configured order
// (used by tests and tests/proxy-trial.js).
async function proxiedRequest({
  site,
  method = 'get',
  url,
  headers,
  data,
  validate = () => true,
  label = site,
  priority = 'normal',
  keepHeaders = false,
  deadlineMs = 30_000,
  directTimeoutMs = 8_000,
  routes,
  _http = axios,
  _now = Date.now,
  _sleep = sleep,
  _agent = makeResidentialAgent,
}) {
  const request = { method, url, data, headers };
  const order = (routes ?? routeOrder(site)).filter(routeConfigured);
  if (order.length === 0) throw new Error(`${label}: no request route is configured`);

  const deadline = _now() + deadlineMs;
  const remaining = () => deadline - _now();
  let lastErr;

  for (let i = 0; i < order.length; i++) {
    const route = order[i];
    const isLast = i === order.length - 1;
    if (route === 'direct' && !isLast && (directBlockedUntil.get(site) ?? 0) > _now()) continue;
    if (remaining() <= 0) {
      lastErr = lastErr ?? deadlineError(label);
      break;
    }

    const started = _now();
    try {
      let body;
      if (route === 'direct') {
        const timeout = isLast ? remaining() : Math.min(directTimeoutMs, remaining());
        body = checked(await send(_http, request, timeout), validate, label, route);
        if (directBlockedUntil.has(site)) {
          directBlockedUntil.delete(site);
          console.log(`[proxyLimiter] ${site}: direct requests work again — proxy no longer used`);
        }
      } else if (route === 'residential') {
        body = await withGates([residentialSiteGate(site), residentialGate], priority, label, route, deadline, _now, async () => {
          const agent = _agent();
          const timeout = Math.min(RESIDENTIAL_ATTEMPT_MS, remaining());
          const response = await send(_http, request, timeout, { httpsAgent: agent, httpAgent: agent, proxy: false });
          return checked(response, validate, label, route);
        });
      } else {
        const proxied = { ...request, url: scrapeopsUrl(url, { keepHeaders }) };
        body = await withGates([scrapeopsGate], priority, label, route, deadline, _now, async () => {
          // A 429 means the account is over its concurrent limit: retry once after a short
          // backoff, holding the slot (giving it away would just produce another 429).
          try {
            return checked(await send(_http, proxied, remaining()), validate, label, route);
          } catch (err) {
            if (err?.response?.status !== 429) throw err;
            console.warn(`[proxyLimiter] ${label} got HTTP 429 from ScrapeOps, retrying once`);
            await _sleep(RETRY_BASE_MS + Math.random() * RETRY_JITTER_MS);
            if (remaining() <= 0) throw deadlineError(label);
            return checked(await send(_http, proxied, remaining()), validate, label, route);
          }
        });
      }
      routeCounts[route].ok++;
      recordServed(route, _now());
      return body;
    } catch (err) {
      lastErr = err;
      routeCounts[route].failed++;
      if (route === 'direct') {
        if (!isLast) {
          directBlockedUntil.set(site, _now() + DIRECT_COOLDOWN_MS);
          console.warn(
            `[proxyLimiter] ${site}: direct request failed (${describe(err)}) after ${_now() - started}ms — skipping direct for ${DIRECT_COOLDOWN_MS / 60_000} min`
          );
        }
      } else {
        console.warn(`[proxyLimiter] ${label}: ${route} attempt failed (${describe(err)}) after ${_now() - started}ms`);
      }
    }
  }
  throw lastErr;
}

function _resetForTests() {
  scrapeopsGate._reset();
  residentialGate._reset();
  residentialSiteGates.clear();
  directBlockedUntil.clear();
  resetStats();
}

module.exports = {
  proxiedRequest,
  InvalidResponseError,
  DIRECT_COOLDOWN_MS,
  DEFAULT_ROUTE_ORDER,
  routeOrder,
  scrapeopsUrl,
  residentialProxyForBrowser,
  getRouteStats,
  _resetForTests,
};
