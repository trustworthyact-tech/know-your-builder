/**
 * WS4.4 — Concurrency & load test (reliability plan)
 *
 * Fires N concurrent POST /api/search requests against a REAL, running Express server
 * (not runSearchRequest() in-process — this needs the real HTTP path to also exercise the
 * rate limiter and NDJSON streaming, per WS4_IMPLEMENTATION_PLAN.md's 4.4 scope) and
 * reports, per request: time-to-first-byte, wall time to the stream closing, and how many
 * of the 29 manifest keys never reached a terminal (done/error) status — the direct,
 * black-box-observable version of the "stuck scraper" class of incident documented
 * throughout CLAUDE.md. (WS4.2's "never a false-complete" invariant is a different,
 * white-box check that needs control over breaker state to mean anything — not
 * duplicated here.)
 *
 * USAGE
 *   Terminal 1: cd server && CAPTCHA_API_KEY=x SCRAPERAPI_KEY=x node index.js
 *   Terminal 2: node server/tests/load-test-ws4.js [concurrency] [perRequestTimeoutMs]
 *
 * CAVEATS (read before trusting a "clean" result)
 *   - `searchLimiter` (index.js) caps at 20 req/min per IP. Concurrency above ~15-18 will
 *     start tripping 429s from the rate limiter itself, not from scraper load — that's
 *     expected, not a bug, and this script reports 429s separately from scraper timeouts.
 *   - Every past concurrency/starvation incident documented in CLAUDE.md (the
 *     MAX_CONCURRENT_PAGES leak, the "4 minutes and 8 scrapers stuck" incident) was only
 *     ever reproduced against the real Railway container — CPU/memory metrics pulled via
 *     `railway metrics`, confirmed NOT resource starvation but a page-pool leak specific
 *     to real concurrent Puppeteer load. A clean run of this script against a local
 *     dev server is evidence the request-handling logic doesn't crash under concurrency —
 *     it is not evidence real browser-pool starvation doesn't happen; that needs a real
 *     deploy per the plan's own note. Say so in the results, don't overclaim.
 */

'use strict';

const http = require('http');
const path = require('path');
const { SCRAPERS } = require(path.join(__dirname, '../scrapers/manifest'));

const HOST = process.env.LOAD_TEST_HOST || 'localhost';
const PORT = Number(process.env.LOAD_TEST_PORT) || 3001;
const CONCURRENCY = Number(process.argv[2]) || 5;
const PER_REQUEST_TIMEOUT_MS = Number(process.argv[3]) || 90_000;

// Real fixtures used throughout this project's test suite (test-ws2-live-hardening.js,
// test-ws3-director-discovery.js, test-ws4-fault-injection.js) — NSW and ACT, alternated
// across concurrent requests so this exercises both jurisdiction profiles at once.
const FIXTURES = [
  { companyName: 'Universal Property Group Pty Limited', abn: '98078297748' },
  { companyName: 'Geocon Constructors (ACT) Pty Ltd', abn: '' },
];

function postSearch(body, timeoutMs) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const startedAt = Date.now();
    let ttfbMs = null;
    let buffer = '';
    const events = [];
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(result);
    };

    // An absolute deadline via a plain JS timer, not req.setTimeout()'s socket-inactivity
    // timeout — the NDJSON stream keeps arriving in small bursts as individual scrapers
    // finish (real activity every few seconds even when the overall request is nowhere
    // near done), so an inactivity timeout never actually fires here. This is a hard cap
    // on total request duration regardless of intermittent activity.
    const deadline = setTimeout(() => {
      req.destroy();
      settle({ ttfbMs, totalMs: Date.now() - startedAt, events, timedOut: true });
    }, timeoutMs);

    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: '/api/search',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        res.on('data', (chunk) => {
          if (ttfbMs === null) ttfbMs = Date.now() - startedAt;
          buffer += chunk.toString('utf8');
          let idx;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (line.trim()) {
              try {
                events.push({ ...JSON.parse(line), atMs: Date.now() - startedAt });
              } catch {
                /* ignore a stray non-JSON line rather than crashing the load test */
              }
            }
          }
        });
        res.on('end', () => {
          settle({ statusCode: res.statusCode, ttfbMs, totalMs: Date.now() - startedAt, events, timedOut: false });
        });
        res.on('error', (err) => settle({ error: err.message, ttfbMs, events, timedOut: false }));
      }
    );
    req.on('error', (err) => settle({ error: err.message, ttfbMs, events, timedOut: false }));
    req.write(data);
    req.end();
  });
}

function analyze(result, requestIndex) {
  const finalByKey = new Map();
  for (const e of result.events) {
    if (e.key) finalByKey.set(e.key, e); // last event per key wins — matches how the real UI consumes this stream
  }
  const stuckKeys = SCRAPERS.map((s) => s.key).filter((key) => {
    const e = finalByKey.get(key);
    return !e || e.status === 'searching';
  });
  // Self-contradictory combos — the exact bug shape test-ws2-live-hardening.js's Pilot 3
  // found and fixed once already (a scraper resolving its own status:'error' without being
  // stamped completeness:'unavailable'). Worth re-checking under real concurrent load, not
  // just the single-request path that test exercises.
  const contradictory = [...finalByKey.values()].filter(
    (e) =>
      (e.status === 'error' && e.completeness === 'complete') ||
      (e.status === 'done' && e.completeness === 'unavailable')
  );
  return {
    requestIndex,
    statusCode: result.statusCode,
    error: result.error,
    timedOut: result.timedOut,
    ttfbMs: result.ttfbMs,
    totalMs: result.totalMs,
    keysReceived: finalByKey.size,
    stuckKeys,
    contradictory,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function main() {
  console.log(`WS4.4 load test: ${CONCURRENCY} concurrent POST /api/search against http://${HOST}:${PORT}`);
  console.log(`Per-request client timeout: ${PER_REQUEST_TIMEOUT_MS}ms\n`);

  const requestBodies = Array.from({ length: CONCURRENCY }, (_, i) => FIXTURES[i % FIXTURES.length]);
  const wallStart = Date.now();
  const results = await Promise.all(
    requestBodies.map((body, i) => postSearch(body, PER_REQUEST_TIMEOUT_MS).then((r) => analyze(r, i)))
  );
  const wallMs = Date.now() - wallStart;

  console.log(`Wall time for all ${CONCURRENCY} requests to settle: ${wallMs}ms\n`);

  let rateLimited = 0;
  for (const r of results) {
    if (r.statusCode === 429) rateLimited++;
    const flags = [
      r.timedOut ? 'CLIENT-TIMEOUT' : null,
      r.error ? `ERROR=${r.error}` : null,
      r.stuckKeys.length ? `stuck=${r.stuckKeys.length}` : null,
      r.contradictory.length ? `CONTRADICTORY=${r.contradictory.length}` : null,
    ]
      .filter(Boolean)
      .join(' ');
    console.log(
      `#${r.requestIndex}: status=${r.statusCode ?? '—'} ttfb=${r.ttfbMs ?? '—'}ms total=${r.totalMs ?? '—'}ms ` +
        `keys=${r.keysReceived}/${SCRAPERS.length}${flags ? '  ' + flags : ''}`
    );
    if (r.stuckKeys.length) console.log(`    stuck (never reached done/error): ${r.stuckKeys.join(', ')}`);
    if (r.contradictory.length) {
      console.log(`    !! CONTRADICTORY status/completeness — this must never happen: ${r.contradictory.map((e) => `${e.key} (${e.status}/${e.completeness})`).join(', ')}`);
    }
  }

  const ttfbs = results.map((r) => r.ttfbMs).filter((v) => v != null).sort((a, b) => a - b);
  const totals = results.map((r) => r.totalMs).filter((v) => v != null).sort((a, b) => a - b);
  console.log(`\nTTFB   p50=${percentile(ttfbs, 0.5)}ms  p90=${percentile(ttfbs, 0.9)}ms`);
  console.log(`Total  p50=${percentile(totals, 0.5)}ms  p90=${percentile(totals, 0.9)}ms`);
  if (rateLimited > 0) {
    console.log(
      `\n${rateLimited} request(s) hit HTTP 429 (searchLimiter's 20/min cap) — expected at this concurrency, not a scraper-load finding.`
    );
  }

  console.log(
    '\nReminder: a clean result here shows the request-handling path doesn\'t crash under local ' +
      'concurrency. It is not evidence against real browser-pool starvation under production load ' +
      '(see this file\'s own header) — that needs a real deploy, per WS4_IMPLEMENTATION_PLAN.md.'
  );

  const anyContradictory = results.some((r) => r.contradictory.length > 0);
  process.exit(anyContradictory ? 1 : 0);
}

main();
