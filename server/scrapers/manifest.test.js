'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SCRAPERS } = require('./manifest');

// Cross-checks the manifest against the two other places scraper keys are hand-maintained
// today: server/searchOrchestrator.js's `invocations` map (what actually runs — WS4.1
// moved this out of index.js's old `searches` array) and web's `INITIAL_SEARCHES` (what
// the UI expects to see streamed back) — CLAUDE.md already documents these as "a stable
// contract" that "must stay in sync", previously enforced by nothing but a comment.
// Regex-based rather than importing: server is CommonJS, web is a separate Next.js TS
// workspace, and this is metadata extraction, not execution.

function extractKeys(source, blockStart, closeRe) {
  const startIdx = source.indexOf(blockStart);
  if (startIdx === -1) throw new Error(`Could not find "${blockStart}" in source`);
  const closeMatch = closeRe.exec(source.slice(startIdx));
  if (!closeMatch) throw new Error(`Could not find closing bracket after "${blockStart}"`);
  const block = source.slice(startIdx, startIdx + closeMatch.index);
  const keys = [...block.matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1]);
  if (keys.length === 0) throw new Error(`No keys found in block starting "${blockStart}"`);
  return keys;
}

// searchOrchestrator.js's `invocations` map is keyed by bare identifiers
// (`abn: () => ...`), not `{ key: '...' }` object entries like the old `searches` array
// or web's INITIAL_SEARCHES — a different shape needs a different extraction regex.
function readOrchestratorKeys() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'searchOrchestrator.js'), 'utf8');
  const blockStart = 'const invocations = {';
  const startIdx = source.indexOf(blockStart);
  if (startIdx === -1) throw new Error(`Could not find "${blockStart}" in source`);
  const closeMatch = /\n {2}\};/.exec(source.slice(startIdx));
  if (!closeMatch) throw new Error(`Could not find closing bracket after "${blockStart}"`);
  const block = source.slice(startIdx, startIdx + closeMatch.index);
  const keys = [...block.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]);
  if (keys.length === 0) throw new Error('No keys found in invocations block');
  return keys;
}

function readInitialSearchesKeys() {
  const webPath = path.join(__dirname, '..', '..', 'web', 'app', 'search', 'SearchContent.tsx');
  const source = fs.readFileSync(webPath, 'utf8');
  return extractKeys(source, 'const INITIAL_SEARCHES', /\n\];/);
}

test('manifest — every key is unique', () => {
  const keys = SCRAPERS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate key in manifest');
});

test('manifest — every entry has a valid bucket, timeout, and breaker config', () => {
  for (const s of SCRAPERS) {
    assert.ok([1, 2, 3, 4].includes(s.bucket), `${s.key}: invalid bucket ${s.bucket}`);
    assert.ok(Number.isFinite(s.timeoutMs) && s.timeoutMs > 0, `${s.key}: invalid timeoutMs`);
    assert.ok(s.breaker && s.breaker.failureThreshold > 0, `${s.key}: invalid breaker config`);
    if (s.bucket !== 1) assert.equal(s.cadence, null, `${s.key}: non-dataset bucket should not set cadence`);
  }
});

test('manifest keys match server/searchOrchestrator.js invocations map exactly', () => {
  const manifestKeys = new Set(SCRAPERS.map((s) => s.key));
  const orchestratorKeys = new Set(readOrchestratorKeys());
  assert.deepEqual(
    [...manifestKeys].sort(),
    [...orchestratorKeys].sort(),
    'manifest.js and searchOrchestrator.js invocations map have drifted apart'
  );
});

test('manifest keys match web INITIAL_SEARCHES exactly', () => {
  const manifestKeys = new Set(SCRAPERS.map((s) => s.key));
  const webKeys = new Set(readInitialSearchesKeys());
  assert.deepEqual(
    [...manifestKeys].sort(),
    [...webKeys].sort(),
    'manifest.js and web/app/search/SearchContent.tsx INITIAL_SEARCHES have drifted apart'
  );
});

// DISABLED_SCRAPER_KEYS — the temporary-decommission mechanism added 2026-09-15 (see
// CLAUDE.md). Read once at module load from process.env, so exercising both states
// means deleting the require cache and re-requiring with the env var set/unset — the
// same trick this file doesn't otherwise need since SCRAPERS itself has no other
// env-dependent branching.
function loadManifestWithEnv(disabledCsv) {
  const prev = process.env.DISABLED_SCRAPER_KEYS;
  if (disabledCsv === undefined) delete process.env.DISABLED_SCRAPER_KEYS;
  else process.env.DISABLED_SCRAPER_KEYS = disabledCsv;
  delete require.cache[require.resolve('./manifest')];
  try {
    return require('./manifest').SCRAPERS;
  } finally {
    if (prev === undefined) delete process.env.DISABLED_SCRAPER_KEYS;
    else process.env.DISABLED_SCRAPER_KEYS = prev;
    delete require.cache[require.resolve('./manifest')];
  }
}

test('DISABLED_SCRAPER_KEYS unset — every entry defaults to enabled', () => {
  const scrapers = loadManifestWithEnv(undefined);
  assert.ok(scrapers.every((s) => s.enabled === true));
});

test('DISABLED_SCRAPER_KEYS — listed keys are disabled, everything else stays enabled', () => {
  const scrapers = loadManifestWithEnv('waLicenceRegister,tasLicenceRegister,courts_nt');
  const byKey = new Map(scrapers.map((s) => [s.key, s.enabled]));
  assert.equal(byKey.get('waLicenceRegister'), false);
  assert.equal(byKey.get('tasLicenceRegister'), false);
  assert.equal(byKey.get('courts_nt'), false);
  assert.equal(byKey.get('courts_federal'), true);
  assert.equal(byKey.get('asicInsolvency'), true);
});

test('DISABLED_SCRAPER_KEYS — tolerates stray whitespace and empty segments', () => {
  const scrapers = loadManifestWithEnv(' waLicenceRegister ,, tasLicenceRegister,');
  const byKey = new Map(scrapers.map((s) => [s.key, s.enabled]));
  assert.equal(byKey.get('waLicenceRegister'), false);
  assert.equal(byKey.get('tasLicenceRegister'), false);
});

// ENABLED_JURISDICTIONS — launch-scope filter (see CLAUDE.md "Launch scope"). Same
// require-cache-busting trick as loadManifestWithEnv above, for the same reason.
function loadManifestWithJurisdictions(jurisdictionsCsv) {
  const prev = process.env.ENABLED_JURISDICTIONS;
  if (jurisdictionsCsv === undefined) delete process.env.ENABLED_JURISDICTIONS;
  else process.env.ENABLED_JURISDICTIONS = jurisdictionsCsv;
  delete require.cache[require.resolve('./manifest')];
  try {
    return require('./manifest').SCRAPERS;
  } finally {
    if (prev === undefined) delete process.env.ENABLED_JURISDICTIONS;
    else process.env.ENABLED_JURISDICTIONS = prev;
    delete require.cache[require.resolve('./manifest')];
  }
}

test('ENABLED_JURISDICTIONS unset — defaults to exactly the mvpScope set', () => {
  // The launch-scope default (national/nsw/act) happens to select the same 16 keys as
  // mvpScope today, even though the two flags mean different things (see manifest.js's
  // own comment) — this test pins that coincidence so a future change to either one that
  // breaks it is caught here rather than discovered live.
  const scrapers = loadManifestWithJurisdictions(undefined);
  for (const s of scrapers) {
    assert.equal(s.inScope, s.mvpScope, `${s.key}: inScope/mvpScope default disagree`);
  }
});

test('ENABLED_JURISDICTIONS — narrows to exactly the listed jurisdictions', () => {
  const scrapers = loadManifestWithJurisdictions('national');
  const byKey = new Map(scrapers.map((s) => [s.key, s.inScope]));
  assert.equal(byKey.get('abn'), true);
  assert.equal(byKey.get('courts_nsw'), false);
  assert.equal(byKey.get('actLicences'), false);
});

test('ENABLED_JURISDICTIONS — tolerates stray whitespace and empty segments', () => {
  const scrapers = loadManifestWithJurisdictions(' national , nsw ,,act,');
  const byKey = new Map(scrapers.map((s) => [s.key, s.inScope]));
  assert.equal(byKey.get('abn'), true);
  assert.equal(byKey.get('courts_nsw'), true);
  assert.equal(byKey.get('actLicences'), true);
  assert.equal(byKey.get('courts_qld'), false);
});
