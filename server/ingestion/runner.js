'use strict';

// The shared ingestion runner for Phase 3's facts-only copies (DATA_SOURCES_PLAN.md Phase 3; the
// generic runner WS0.6 called for). Each source registers one job; the runner gives every job the
// same behaviour, closing the plan's architecture gaps:
//
// - Single flight: a job never overlaps itself. A run that is still going when the next interval
//   fires is simply not started again.
// - Polite and low priority: jobs make one request at a time (`ctx.pace()` between requests) and
//   pause while a user search is running (`ctx.yieldToSearches()`), since they share the process
//   and network with live searches (gap 3).
// - Resumable: a job keeps its own progress (`ctx.progress`, saved after every run and on
//   `ctx.checkpoint()`), so a large first copy spreads over many runs and survives restarts.
// - Honest health: last success, last error, consecutive failures and the job's own progress are
//   stored in ingestion_state and shown on /admin/scraper-health (gap 4). A job's index is stale
//   once its last success is older than `freshnessSlaMs`, and its checks say so (`stale` + asOf).
// - Scope-gated: a job starts only if one of its manifest keys is in launch scope (gap 6).
// - Proxy jobs are opt-in: a job that crawls through the proxy (`needsProxy`) starts only if
//   it's named in PROXY_INGESTION_JOBS (or that is "all"), because its first copy spends proxy
//   credits — about 2,350 ScrapeOps credits for FWO — that the live checks also depend on.
//
// A job's `run(ctx)` throws to signal failure; anything it wants to keep (rows) is its own
// business, written through ctx.db. It must refuse to replace good data with bad (page-marker and
// count checks), as every dataset job here already does.

const localIndex = require('./localIndex');

const jobs = new Map();
const running = new Map();
const timers = [];
let activeSearches = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Called by searchOrchestrator around every search, so jobs can back off while one is running.
function searchStarted() {
  activeSearches++;
}
function searchEnded() {
  activeSearches = Math.max(0, activeSearches - 1);
}

function registerJob(job) {
  for (const field of ['key', 'run', 'intervalMs', 'freshnessSlaMs']) {
    if (job[field] == null) throw new Error(`ingestion job is missing ${field}`);
  }
  jobs.set(job.key, { scraperKeys: [], firstRunDelayMs: 30_000, label: job.key, ...job });
}

function makeContext(job, state, { _sleep = sleep } = {}) {
  const database = localIndex.getDb();
  return {
    db: database,
    progress: state.progress,
    log: (msg) => console.log(`[ingestion:${job.key}] ${msg}`),
    pace: (ms) => _sleep(ms),
    // Waits while a user search is in progress, up to `maxMs`, so a crawl never competes with one.
    async yieldToSearches(maxMs = 60_000) {
      const until = Date.now() + maxMs;
      while (activeSearches > 0 && Date.now() < until) await _sleep(500);
    },
    checkpoint() {
      localIndex.saveState(database, state);
    },
  };
}

// Retries one request inside a job: a slow or failed page through the proxy shouldn't fail a
// whole run, since a failed run only retries at the job's next interval (found 2026-10-15: FWO's
// listing through ScrapeOps hit a single 60s timeout every ten pages or so, failing each run).
// Pauses through ctx.pace, so tests don't wait.
async function retrying(ctx, fn, { attempts = 3, delayMs = 10_000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts) throw err;
      ctx.log(`request failed (${err?.response?.status || err?.code || err?.message}), retry ${attempt} of ${attempts - 1}`);
      await ctx.pace(delayMs * attempt);
    }
  }
}

// Runs a job once. Resolves with { ok, error? }; never throws, so a failing job can't crash the
// long-lived server process.
async function runJobOnce(key, options = {}) {
  const job = jobs.get(key);
  if (!job) throw new Error(`unknown ingestion job ${key}`);
  if (running.has(key)) return running.get(key);
  const database = localIndex.getDb();
  if (!database) return { ok: false, error: 'local index store unavailable' };

  const run = (async () => {
    const state = localIndex.getState(database, key);
    state.lastAttemptAt = new Date().toISOString();
    try {
      await job.run(makeContext(job, state, options));
      state.lastSuccessAt = new Date().toISOString();
      state.lastError = null;
      state.consecutiveFailures = 0;
      return { ok: true };
    } catch (err) {
      state.lastError = String(err?.message ?? err).slice(0, 500);
      state.consecutiveFailures++;
      console.error(`[ingestion:${key}] run failed (${state.consecutiveFailures} in a row): ${state.lastError}`);
      return { ok: false, error: state.lastError };
    } finally {
      try {
        localIndex.saveState(database, state);
      } catch (err) {
        console.error(`[ingestion:${key}] could not save state: ${err.message}`);
      }
    }
  })().finally(() => running.delete(key));
  running.set(key, run);
  return run;
}

// Starts every registered job whose manifest keys include one in launch scope.
function startIngestionJobs(scrapers, { _setTimeout = setTimeout, _setInterval = setInterval } = {}) {
  if (!localIndex.available()) {
    console.warn('[ingestion] local index store unavailable (node:sqlite not loaded?) — no ingestion jobs started; checks use their live scrapers');
    return;
  }
  for (const job of jobs.values()) {
    const inScope = job.scraperKeys.length === 0 || job.scraperKeys.some((k) => scrapers.find((s) => s.key === k)?.inScope);
    if (!inScope) continue;
    if (job.needsProxy && !proxyJobsEnabled().has(job.key)) {
      console.log(`[ingestion] ${job.key} not started: it crawls through the proxy — add it to PROXY_INGESTION_JOBS to start it`);
      continue;
    }
    timers.push(_setTimeout(() => runJobOnce(job.key), job.firstRunDelayMs));
    const interval = _setInterval(() => runJobOnce(job.key), job.intervalMs);
    interval.unref?.();
    timers.push(interval);
    console.log(`[ingestion] ${job.key} scheduled every ${Math.round(job.intervalMs / 60_000)} min`);
  }
}

// Freshness of a job's index for its checks: `stale` once the last success is older than the
// job's SLA. `asOf` is the last successful run.
function freshness(key) {
  const job = jobs.get(key);
  const database = localIndex.getDb();
  if (!job || !database) return { stale: true, asOf: null };
  const { lastSuccessAt } = localIndex.getState(database, key);
  const age = lastSuccessAt ? Date.now() - new Date(lastSuccessAt).getTime() : Infinity;
  return { stale: age > job.freshnessSlaMs, asOf: lastSuccessAt };
}

function isReady(key) {
  const job = jobs.get(key);
  const database = localIndex.getDb();
  if (!job || !database) return false;
  if (disabledIndexes().has(key)) return false;
  try {
    return Boolean(job.isReady ? job.isReady(database) : localIndex.getState(database, key).lastSuccessAt);
  } catch {
    return false;
  }
}

function proxyJobsEnabled() {
  const raw = (process.env.PROXY_INGESTION_JOBS || '').trim();
  if (raw === 'all') return new Set([...jobs.values()].map((j) => j.key));
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

// LOCAL_INDEX_DISABLED=asicNotices,fwoReleases forces those checks back onto their live scrapers
// without a deploy (the counterpart to DISABLED_SCRAPER_KEYS).
function disabledIndexes() {
  return new Set((process.env.LOCAL_INDEX_DISABLED || '').split(',').map((s) => s.trim()).filter(Boolean));
}

function getIngestionHealth() {
  const database = localIndex.getDb();
  return [...jobs.values()].map((job) => {
    if (!database) return { job: job.key, label: job.label, available: false };
    const state = localIndex.getState(database, job.key);
    const { stale } = freshness(job.key);
    return {
      job: job.key,
      label: job.label,
      available: true,
      started: !job.needsProxy || proxyJobsEnabled().has(job.key),
      ready: isReady(job.key),
      running: running.has(job.key),
      stale,
      lastSuccessAt: state.lastSuccessAt,
      lastAttemptAt: state.lastAttemptAt,
      lastError: state.lastError,
      consecutiveFailures: state.consecutiveFailures,
      summary: job.describe ? safeDescribe(job, database) : null,
    };
  });
}

function safeDescribe(job, database) {
  try {
    return job.describe(database);
  } catch (err) {
    return `could not describe: ${err.message}`;
  }
}

function _resetForTests() {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  jobs.clear();
  running.clear();
  activeSearches = 0;
}

module.exports = {
  registerJob,
  retrying,
  runJobOnce,
  startIngestionJobs,
  freshness,
  isReady,
  getIngestionHealth,
  searchStarted,
  searchEnded,
  _resetForTests,
};
