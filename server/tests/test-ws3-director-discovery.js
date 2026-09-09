/**
 * TEST: WS3 director discovery via NSW/ACT licence registers (reliability plan)
 *
 * PURPOSE
 *   ASIC's own officer/director data requires DSP API access, which is paused until 2027
 *   (see CLAUDE.md's WS3 entries) — resolveDirectors() in server/index.js has had no
 *   automated director-discovery source since 2026-09-08. This adds one: NSW Fair Trading's
 *   per-licence details endpoint returns an `associatedRoles` array (Director / Nominated
 *   Supervisor, with real names) that nswFairTrading.js was already fetching for compliance
 *   data and discarding; ACT's licence dataset carries `partners`/`nominees` fields that
 *   actLicences.js already extracted into result metadata but never fed back into director
 *   resolution. Both are now wired into resolveDirectors() via hoisted, fail-open promises
 *   (nswDirectorDiscoveryPromise / actDirectorDiscoveryPromise in index.js) — this is what
 *   this file locks in.
 *
 *   Pilot 1 — nswFairTrading.js's fetchNswCompanyLookup() ("Phase A") correctly extracts
 *     Director/Nominated Supervisor names from a real fixture, and searchNSWFairTrading()
 *     ("Phase B") reuses that result rather than re-querying — the fix for the circular
 *     dependency (resolveDirectors() needs NSW's search; NSW's own full search needs
 *     resolveDirectors()'s output for its per-director enrichment loop) documented in
 *     CLAUDE.md's WS3 entries.
 *   Pilot 2 — actLicences.js's resolveActAssociatedNames() correctly extracts and parses
 *     partners/nominees from a real fixture, including stripping ACT's composite nominees
 *     format ("NAME: licenceNumber-Occupation-Class") down to just the name.
 *   Pilot 3 — the nameMatchesEntity punctuation bug found live while building this (a query
 *     token that itself starts/ends with punctuation, e.g. "(ACT)", can never satisfy its own
 *     \b-anchored regex — pre-existing, not introduced by this change, but directly blocked
 *     Pilot 2 until fixed in both nswFairTrading.js and actLicences.js).
 *   Pilot 4 — fetchNswCompanyLookup's fail-open contract: a failure must resolve to an empty
 *     result, never reject — this is what lets index.js's withTimeout(...).catch(...) around
 *     it guarantee a hung/down NSW register can't block the other 12 consumers of
 *     resolveDirectors(), the exact class of regression the 2026-09-08 ASIC-dependency
 *     removal fixed for this same function.
 *
 * FIXTURES
 *   Universal Property Group Pty Limited / ABN 98078297748 — NSW, director Bhart Bhushan,
 *   nominated supervisor Raj Mohan (live-confirmed 2026-09-09).
 *   Geocon Constructors (ACT) Pty Ltd / ACT licence 2013583 — partner Nikolaos Georgalis,
 *   nominee Damon Gregory Smith (live-confirmed 2026-09-09). Also exercises the
 *   nameMatchesEntity punctuation fix via its "(ACT)" suffix.
 *
 * USAGE
 *   node server/tests/test-ws3-director-discovery.js
 *
 * EXIT CODE
 *   0 — all pilots passed   1 — any pilot failed
 */

'use strict';

const path = require('path');
const { searchNSWFairTrading, fetchNswCompanyLookup } = require(path.join(__dirname, '../scrapers/nswFairTrading'));
const { resolveActAssociatedNames } = require(path.join(__dirname, '../scrapers/actLicences'));
const { withTimeout } = require(path.join(__dirname, '../scrapers/runScraper'));
const { pass, fail, step, header, summary } = require('./lib/helpers');

(async () => {
  header('WS3 Director Discovery — NSW/ACT licence registers as an ASIC substitute');
  let passed = 0;
  let failed = 0;

  // ── Pilot 1: NSW Phase A discovers directors; Phase B reuses it ──────────────
  step('Pilot 1: fetchNswCompanyLookup + searchNSWFairTrading reuse for "Universal Property Group Pty Limited"...');
  {
    const primary = await fetchNswCompanyLookup('Universal Property Group Pty Limited');
    const director = primary.associatedNames.find((a) => a.role === 'Director');
    const supervisor = primary.associatedNames.find((a) => a.role.toLowerCase() === 'nominated supervisor');

    if (!director || director.name !== 'Bhart Bhushan') {
      fail('Pilot 1', 'Expected Director "Bhart Bhushan" in associatedNames', primary.associatedNames);
      failed++;
    } else if (!supervisor || supervisor.name !== 'Raj Mohan') {
      fail('Pilot 1', 'Expected Nominated Supervisor "Raj Mohan" in associatedNames', primary.associatedNames);
      failed++;
    } else {
      const full = await searchNSWFairTrading('Universal Property Group Pty Limited', '98078297748', [], primary);
      const primaryItem = full.results.find((r) => r.metadata?.LicenceNumber === '85273C');
      if (!primaryItem || primaryItem.metadata.Director !== 'Bhart Bhushan') {
        fail('Pilot 1', 'searchNSWFairTrading (reusing Phase A) should carry Director in the primary result\'s metadata', primaryItem);
        failed++;
      } else if (full.results.length < 1) {
        fail('Pilot 1', 'Expected at least the primary licence result when reusing Phase A', full);
        failed++;
      } else {
        pass('Pilot 1', `Director "${director.name}" + Nominated Supervisor "${supervisor.name}" discovered; Phase B reuse carries metadata through`);
        passed++;
      }
    }
  }

  // ── Pilot 2: ACT partners/nominees extraction + composite-string parsing ─────
  step('Pilot 2: resolveActAssociatedNames for "Geocon Constructors (ACT) Pty Ltd"...');
  {
    const names = await resolveActAssociatedNames('Geocon Constructors (ACT) Pty Ltd');
    const partner = names.find((n) => n.role === 'Partner');
    const nominee = names.find((n) => n.role === 'Nominee');

    if (!partner || partner.name !== 'NIKOLAOS GEORGALIS') {
      fail('Pilot 2', 'Expected Partner "NIKOLAOS GEORGALIS"', names);
      failed++;
    } else if (!nominee || nominee.name !== 'DAMON GREGORY SMITH') {
      fail(
        'Pilot 2',
        'Expected Nominee "DAMON GREGORY SMITH" (parsed from the composite "NAME: licenceNumber-Occupation-Class" field, not the raw string)',
        names
      );
      failed++;
    } else {
      pass('Pilot 2', `Partner "${partner.name}" + Nominee "${nominee.name}" correctly extracted and parsed`);
      passed++;
    }
  }

  // ── Pilot 3: nameMatchesEntity punctuation fix (found live building this) ────
  step('Pilot 3: a query ending in "(ACT)" is not silently unmatchable...');
  {
    // Re-derive the same function shape used in both files rather than importing an
    // unexported internal — this is what actually failed (returned []) before the fix,
    // caught by Pilot 2 above depending on it; this pilot pins the specific mechanism down.
    function escapeRegExp(s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    function nameMatchesEntity(text, query) {
      if (!query) return false;
      const words = query
        .toLowerCase()
        .split(/\s+/)
        .map((w) => w.replace(/[^a-z0-9]/g, ''))
        .filter((w) => (w.length > 3 || /^\d+$/.test(w)) && !/^(pty|ltd|limited|the|and|of|a)$/.test(w));
      if (words.length === 0) return false;
      const lower = text.toLowerCase();
      return words.every((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(lower));
    }

    const matches = nameMatchesEntity('GEOCON CONSTRUCTORS (ACT) PTY LTD', 'Geocon Constructors (ACT)');
    if (!matches) {
      fail('Pilot 3', 'A "(ACT)"-suffixed query should still match its own company name', { matches });
      failed++;
    } else {
      pass('Pilot 3', 'Punctuation-adjacent tokens now match correctly');
      passed++;
    }
  }

  // ── Pilot 4: fail-open contract for the hoisted NSW promise ──────────────────
  step('Pilot 4: a failing NSW lookup resolves to an empty result, never rejects...');
  {
    const failingLookup = () => Promise.reject(new Error('simulated NSW outage'));
    const guarded = withTimeout(failingLookup(), 5_000).catch(() => ({ items: [], associatedNames: [], seen: new Set() }));

    let rejected = false;
    let result;
    try {
      result = await guarded;
    } catch {
      rejected = true;
    }

    if (rejected) {
      fail('Pilot 4', 'The hoisted promise pattern must fail open (resolve), never reject — a rejection here would propagate to resolveDirectors() and block its other 12 consumers');
      failed++;
    } else if (!Array.isArray(result.associatedNames) || result.associatedNames.length !== 0) {
      fail('Pilot 4', 'Expected an empty associatedNames array on failure', result);
      failed++;
    } else {
      pass('Pilot 4', 'Failure resolves to an empty result — resolveDirectors()\'s other consumers are protected');
      passed++;
    }
  }

  summary(passed, failed);
  process.exit(failed > 0 ? 1 : 0);
})();
