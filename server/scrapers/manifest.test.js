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
