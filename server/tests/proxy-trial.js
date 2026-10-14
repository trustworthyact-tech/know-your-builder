#!/usr/bin/env node
'use strict';

/**
 * Residential proxy trial (DATA_SOURCES_PLAN.md Phase 4). First run 2026-10-14: DataImpulse and
 * Decodo both refused every government site (provider policy), so a 0% result with HTTP 403 /
 * ERR_TUNNEL_CONNECTION_FAILED means the provider blocks the domain, not that the site does.
 *
 * Sends N requests per site through each candidate provider's proxy and checks every response
 * with the same page checks production uses (a block page counts as a failure). Federal Court
 * goes through a proxied headless browser, as in production.
 *
 * Self-contained on purpose: it needs only axios, https-proxy-agent (v5 or v7) and
 * puppeteer-extra, so it runs in the Railway container whatever version of the scrapers is
 * deployed. The page checks below are copies of isSearchResponse (nswFairTrading.js),
 * isFunnelbackResultsPage / isFedcourtResultsPage (courtRecords.js) and isFwoSearchPage
 * (fwo.js); keep them in step if those change.
 *
 * Run it from inside the Railway container, since Railway's IP is the one the sites block:
 *
 *   PROXY_TRIAL_URLS="decodo=http://USER:PASS@au.decodo.com:30000,dataimpulse=http://LOGIN__cr.au:PASS@gw.dataimpulse.com:823" \
 *     node tests/proxy-trial.js --n 50
 *
 * Options: --n <requests per site> (default 50), --sites nsw,act-courts,acat,fwo,federal,
 * --concurrency <per site> (default 4, the production per-site limit).
 *
 * Pass bar per site: ≥98% valid responses. Also reports latency, error types, the exit IPs'
 * country and how many distinct IPs were seen, and bytes per response (for estimating monthly
 * bandwidth cost). Exits 1 if any provider misses the bar on any site.
 */

const axios = require('axios');
const httpsProxyAgent = require('https-proxy-agent');

const HttpsProxyAgent = httpsProxyAgent.HttpsProxyAgent || httpsProxyAgent;

const PASS_BAR = 0.98;
const REQUEST_TIMEOUT_MS = 20_000;
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const N = parseInt(arg('n', '50'), 10);
const CONCURRENCY = parseInt(arg('concurrency', '4'), 10);
const SITES = arg('sites', 'nsw,act-courts,acat,fwo,federal').split(',').map((s) => s.trim());

// ── Page checks (copied from the scrapers, see header) ──────────────────────────────────
const isSearchResponse = (data) => Array.isArray(data?.results);
const isFunnelbackResultsPage = (html) =>
  typeof html === 'string' && (/<li[^>]*class="[^"]*\bsearch-result\b/.test(html) || /did not return any results/i.test(html));
const isFwoSearchPage = (html) => typeof html === 'string' && /id="num_search_results"/.test(html);
const isFedcourtResultsPage = (html) =>
  typeof html === 'string' && /id="fb-results"/.test(html) && (/<div[^>]*class="result"/.test(html) || /id="fb-no-results"/.test(html));

// Rotating real search terms, so responses aren't served from a cache.
const TERMS = ['Geocon', 'Universal Property Group', 'Multiplex', 'Hindmarsh', 'Construction', 'Building', 'Lendlease', 'Canberra Builders', 'Doss Constructions', 'Turnkey Creations'];
const term = (i) => TERMS[i % TERMS.length];
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; know-your-builder/1.0)' };

const SITE_REQUESTS = {
  nsw: (i) => ({
    method: 'post',
    url: 'https://verify.licence.nsw.gov.au/publicregisterapi/api/v1/licence/search/advQuery',
    data: { licenceGroup: 'Trades', search: term(i), autoComplete: false, pageNumber: 0, pageSize: 20, licenceTypes: [] },
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...UA },
    validate: isSearchResponse,
  }),
  'act-courts': (i) => ({ url: `https://www.courts.act.gov.au/judgment?query=${encodeURIComponent(term(i))}`, headers: UA, validate: isFunnelbackResultsPage }),
  acat: (i) => ({ url: `https://www.acat.act.gov.au/decisions2/search-decisions?meta_partyName=${encodeURIComponent(term(i))}`, headers: UA, validate: isFunnelbackResultsPage }),
  fwo: (i) => ({
    url: `https://www.fairwork.gov.au/newsroom/news-and-media-search?keys=${encodeURIComponent(term(i))}`,
    headers: { ...UA, Accept: 'text/html,application/xhtml+xml', Referer: 'https://www.fairwork.gov.au/newsroom' },
    validate: isFwoSearchPage,
  }),
};

const federalUrl = (i) =>
  `https://search.judgments.fedcourt.gov.au/s/search.html?collection=fca~sp-judgments-internet&profile=judgments-internet&num_ranks=100&query=${encodeURIComponent(term(i))}`;

class BlockPage extends Error {}

// A fresh agent per request: no keep-alive, so each request opens a new connection to the
// gateway, which rotating residential gateways answer from a new IP (as production does).
const agentFor = (proxyUrl) => new HttpsProxyAgent(proxyUrl, { keepAlive: false });

async function httpRequest(proxyUrl, { method = 'get', url, data, headers, validate }) {
  const agent = agentFor(proxyUrl);
  const config = { headers, timeout: REQUEST_TIMEOUT_MS, httpsAgent: agent, httpAgent: agent, proxy: false };
  const res = method === 'post' ? await axios.post(url, data, config) : await axios.get(url, { ...config, maxRedirects: 5 });
  if (!validate(res.data)) throw new BlockPage('block page');
  return res.data;
}

// One browser per provider, launched with that provider's proxy, as production's proxied
// Federal Court pages are. Chromium takes no credentials in --proxy-server, so they're given
// to each page with page.authenticate().
async function launchBrowser(proxyUrl) {
  const puppeteer = require('puppeteer-extra');
  puppeteer.use(require('puppeteer-extra-plugin-stealth')());
  const u = new URL(proxyUrl);
  const browser = await puppeteer.launch({
    headless: 'shell',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', `--proxy-server=${u.protocol}//${u.host}`],
  });
  const credentials = u.username ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } : null;
  return { browser, credentials };
}

async function browserRequest({ browser, credentials }, url) {
  const page = await browser.newPage();
  try {
    if (credentials) await page.authenticate(credentials);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const title = await page.title().catch(() => '');
      if (!['Just a moment...', 'Please Wait...', 'Attention Required!', ''].includes(title)) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    const html = await page.content();
    if (!isFedcourtResultsPage(html)) throw new BlockPage('block page');
    return html;
  } finally {
    await page.close().catch(() => {});
  }
}

async function oneRequest(ctx, site, i) {
  const started = Date.now();
  try {
    const body = site === 'federal' ? await browserRequest(ctx.browser, federalUrl(i)) : await httpRequest(ctx.proxyUrl, SITE_REQUESTS[site](i));
    const bytes = typeof body === 'string' ? Buffer.byteLength(body) : Buffer.byteLength(JSON.stringify(body));
    return { ok: true, ms: Date.now() - started, bytes };
  } catch (err) {
    const kind = err instanceof BlockPage ? 'block page' : err.response?.status ? `HTTP ${err.response.status}` : err.code || String(err.message).slice(0, 60);
    return { ok: false, ms: Date.now() - started, kind };
  }
}

async function runSite(ctx, site) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < N) {
      const i = next++;
      results.push(await oneRequest(ctx, site, i));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, N) }, worker));
  return results;
}

async function exitIps(proxyUrl, samples = 8) {
  const seen = [];
  for (let i = 0; i < samples; i++) {
    try {
      const agent = agentFor(proxyUrl);
      const { data } = await axios.get('https://ipinfo.io/json', { httpsAgent: agent, proxy: false, timeout: 10_000 });
      seen.push(`${data.ip} ${data.country}`);
    } catch (err) {
      seen.push(`error: ${err.response?.status ? `HTTP ${err.response.status}` : err.code || err.message}`);
    }
  }
  return seen;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const quantile = (xs, q) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

(async () => {
  const providers = (process.env.PROXY_TRIAL_URLS || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const eq = p.indexOf('=');
      return { name: p.slice(0, eq), url: p.slice(eq + 1) };
    });
  if (providers.length === 0 || providers.some((p) => !p.name || !p.url)) {
    console.error('Set PROXY_TRIAL_URLS="name=http://user:pass@host:port,name2=..." — see the header of this file.');
    process.exit(2);
  }

  let allPass = true;
  for (const provider of providers) {
    console.log(`\n=== ${provider.name} ===`);
    const ips = await exitIps(provider.url);
    const distinct = new Set(ips.filter((s) => !s.startsWith('error')).map((s) => s.split(' ')[0]));
    console.log(`exit IPs (${distinct.size} distinct of ${ips.length}): ${ips.join(', ')}`);

    const ctx = { proxyUrl: provider.url, browser: null };
    for (const site of SITES) {
      if (site !== 'federal' && !SITE_REQUESTS[site]) {
        console.log(`${site}: unknown site, skipped`);
        continue;
      }
      if (site === 'federal' && !ctx.browser) ctx.browser = await launchBrowser(provider.url);
      const results = await runSite(ctx, site);
      const ok = results.filter((r) => r.ok);
      const rate = ok.length / results.length;
      const pass = rate >= PASS_BAR;
      if (!pass) allPass = false;
      const errors = {};
      for (const r of results.filter((x) => !x.ok)) errors[r.kind] = (errors[r.kind] || 0) + 1;
      const avgKb = ok.length ? ok.reduce((s, r) => s + r.bytes, 0) / ok.length / 1024 : 0;
      console.log(
        `${pass ? 'PASS' : 'FAIL'} ${site.padEnd(10)} ${ok.length}/${results.length} valid (${pct(rate)})` +
          `  p50 ${quantile(ok.map((r) => r.ms), 0.5) ?? '—'}ms  p90 ${quantile(ok.map((r) => r.ms), 0.9) ?? '—'}ms` +
          `  ~${avgKb.toFixed(0)}KB/response` +
          (Object.keys(errors).length ? `  errors: ${JSON.stringify(errors)}` : '')
      );
    }
    if (ctx.browser) await ctx.browser.browser.close().catch(() => {});
  }
  console.log(`\n${allPass ? 'All providers passed' : 'At least one provider missed'} the ${pct(PASS_BAR)} bar on ${SITES.join(', ')}.`);
  console.log('Bandwidth note: KB/response covers the response body only (headers and TLS add a little); the browser loads more than the HTML.');
  process.exit(allPass ? 0 : 1);
})();
