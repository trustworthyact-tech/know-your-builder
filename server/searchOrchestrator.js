'use strict';

// The full /api/search request pipeline, extracted out of index.js's route handler
// (WS4.1, reliability plan — see WS4_IMPLEMENTATION_PLAN.md). Two reasons to have this as
// its own callable function rather than inline in app.post(...):
//   1. Fault-injection tests can call runSearchRequest() directly with a fake `send`
//      collector, no live HTTP server needed — test-ws2-live-hardening.js already flagged
//      this exact gap ("the actual branch lives inline in index.js's route handler, which
//      isn't yet extracted into a directly-callable function — that's WS4.1's job").
//   2. It's what makes manifest.js's `mvpScope` flag the actual source of truth for which
//      keys get the circuit breaker, instead of a second hand-maintained list.

const { searchABN } = require('./scrapers/abn');
const { searchCourtRecords, buildManualFallback } = require('./scrapers/courtRecords');
const { SCRAPERS } = require('./scrapers/manifest');
const { runScraper, withTimeout } = require('./scrapers/runScraper');
const scraperHealth = require('./scrapers/scraperHealth');
const { searchPaymentTimes } = require('./scrapers/paymentTimes');
const { searchModernSlavery } = require('./scrapers/modernSlavery');
const { searchQBCC } = require('./scrapers/qbcc');
const { searchASIC } = require('./scrapers/asic');
const { searchASICDisqualifiedFromDataset } = require('./scrapers/asicDpnMatch');
const { searchAsicInsolvency } = require('./scrapers/asicInsolvency');
const { searchAtoDebt } = require('./scrapers/atoDebt');
const { searchFWO } = require('./scrapers/fwo');
const { searchVicBpc } = require('./scrapers/vicBpc');
const { searchVicVbaLicence } = require('./scrapers/vicVbaLicence');
const { searchWABuildingEnergy } = require('./scrapers/waBuildingEnergy');
const { searchNSWFairTrading, fetchNswCompanyLookup } = require('./scrapers/nswFairTrading');
const { searchNTBuildingPractitioners } = require('./scrapers/ntBuildingPractitioners');
const { searchACTLicences, searchACTDisciplinary, resolveActAssociatedNames } = require('./scrapers/actLicences');
const { searchWALicenceRegister } = require('./scrapers/waLicenceRegister');
const { searchTASLicenceRegister } = require('./scrapers/tasLicenceRegister');
const { searchAsicExtract } = require('./scrapers/asicExtract');
const { searchAsicEnforceableUndertakings } = require('./scrapers/asicEnforceableUndertakings');

/**
 * Runs one full search: every scraper in server/scrapers/manifest.js's SCRAPERS list is
 * invoked, MVP-scope keys (`mvpScope: true`) through runScraper()'s hard timeout + circuit
 * breaker, the rest through a plain try/catch (unchanged from pre-WS4.1 behaviour — see
 * WS4_IMPLEMENTATION_PLAN.md's 4.1 scope decision). Each result is streamed via `send` as it
 * resolves, exactly as the inline handler did before this extraction.
 */
async function runSearchRequest({ abn, acn, companyName, tradingName, directors }, { send }) {
  // Shared promises so scrapers can reuse results without duplicate HTTP calls. Both fire
  // eagerly and unconditionally, before either key's circuit-breaker state is checked —
  // when a breaker is open, runScraper() returns early and never calls invocations.abn()/
  // invocations.asic() (never awaits these), so nothing would otherwise ever attach a
  // rejection handler to them. Found live by WS4.2's fault-injection test: forcing asic's
  // breaker open and running a real request crashed the whole Node process on the
  // resulting unhandled rejection — a real, pre-existing bug (asic was already
  // runScraper-wrapped before WS4.1's cutover), not something this refactor introduced.
  // The no-op .catch() below only registers an additional listener — it doesn't change
  // what `await abnPromise`/`await asicPromise` resolves to for runScraper's own try/catch
  // elsewhere, since every .then/.catch/await attaches independently to the same promise.
  const abnPromise = searchABN(abn, companyName, acn);
  abnPromise.catch(() => {});
  const asicPromise = searchASIC(companyName, abn, acn, process.env.CAPTCHA_API_KEY);
  asicPromise.catch(() => {});

  // WS3 (reliability plan) — director discovery via NSW/ACT's own licence registers, a free
  // substitute for ASIC's own officer data (its DSP application path is paused until 2027 —
  // see CLAUDE.md's WS3 entries; the ASIC-backed path resolveDirectors() used to attempt is
  // still broken/unavailable, not just deprioritised). Hoisted once here, same pattern as
  // abnPromise/asicPromise above, so every one of resolveDirectors()'s 13 consumers shares a
  // single lookup instead of each triggering its own. NSW is a live HTTP call, so it's bounded
  // by withTimeout and fails open (empty result, not a rejection) — a slow or down NSW
  // register must never block the other 12 scrapers, which is exactly the class of problem
  // the 2026-09-08 ASIC-dependency removal fixed for this same function; reintroducing an
  // unbounded network dependency here would undo that fix. ACT reads an already-local dataset
  // cache (WS1), so resolveActAssociatedNames only needs a fail-open catch, not a timeout.
  const nswDirectorDiscoveryPromise = withTimeout(fetchNswCompanyLookup(companyName), 20_000).catch(
    () => ({ items: [], associatedNames: [], seen: new Set() })
  );
  const actDirectorDiscoveryPromise = resolveActAssociatedNames(companyName).catch(() => []);

  // Returns the best available ABN: request-supplied first, then first ABN scraper result.
  // Safe to call concurrently — all callers await the same promise.
  async function resolveAbn() {
    if (abn) return abn;
    const abnResult = await abnPromise;
    return (abnResult.results ?? [])[0]?.metadata?.ABN?.replace(/\s/g, '') ?? '';
  }

  // Returns ABR-registered business/trading names for this ABN — a sole trader's
  // licence or QBCC adjudication decision is often filed under a business name
  // rather than their personal name.
  async function resolveAlternateNames() {
    const abnResult = await abnPromise;
    return [...new Set([...(abnResult.businessNames ?? []), ...(abnResult.tradingNames ?? [])])];
  }

  // Merges request-supplied director names with what NSW/ACT's own licence registers surface
  // for this company (see nswDirectorDiscoveryPromise/actDirectorDiscoveryPromise above).
  // Deliberately still a flat string[] — the 13 consumers of this function are unchanged by
  // WS3, only what feeds them got richer. Source/role (Director vs Nominated Supervisor vs
  // Partner vs Nominee — not all equally confident) is preserved separately in each
  // discovering scraper's own result metadata (nswFairTrading.js, actLicences.js) rather than
  // threaded through here, so a report can show provenance without a wider signature change.
  //
  // History: this was a pure ASIC pass-through until 2026-08-13, deprecated to a bare
  // request-supplied-only stub on 2026-09-08 after ASIC Connect's director extraction was
  // confirmed broken and was serializing 13+ scrapers behind its captcha-gated flow for a
  // lookup that reliably returned nothing anyway (see CLAUDE.md's "resolveDirectors() is
  // currently starved" entries). NSW/ACT licence data reopens automated discovery without
  // reintroducing that dependency — see CLAUDE.md's WS3 entries for the full record.
  async function resolveDirectors() {
    const [nswPrimary, actAssociated] = await Promise.all([
      nswDirectorDiscoveryPromise,
      actDirectorDiscoveryPromise,
    ]);
    const discovered = [
      ...nswPrimary.associatedNames.map((a) => a.name),
      ...actAssociated.map((a) => a.name),
    ];
    return [...new Set([...(directors ?? []), ...discovered])];
  }

  // Directors + ABR trading/business names, combined — for scrapers that treat their
  // "extra terms" parameter generically as more names to search under (courtRecords, FWO),
  // not just directors. resolveDirectors/resolveAlternateNames depend on different
  // upstream promises (asicPromise vs abnPromise), so run them concurrently rather than
  // awaiting serially.
  async function resolveExtraSearchTerms() {
    const [directorNames, alternateNames] = await Promise.all([resolveDirectors(), resolveAlternateNames()]);
    return [...new Set([...directorNames, ...alternateNames])];
  }

  // WS3 (reliability plan) — marks a director-dependent result as completeness: 'partial'
  // when resolveDirectors() found nothing at all (neither typed nor NSW/ACT-discovered) to
  // search under, so a report can tell "checked the company name only" apart from "also
  // searched under N director name(s)" instead of both rendering identically as a complete
  // check. Never downgrades a result that already set its own more specific completeness
  // (e.g. courtRecords.js's own 'unavailable'/'partial' from a failed/retried live search,
  // or buildManualFallback's 'unavailable') — this only fills in the case that would
  // otherwise default to 'complete' with no signal that director coverage was actually zero.
  function markPartialIfNoDirectors(result, directorCount) {
    if (directorCount > 0) return result;
    if (result.completeness && result.completeness !== 'complete') return result;
    return {
      ...result,
      completeness: 'partial',
      summary: `${result.summary} (no director names available to search under)`,
    };
  }

  // One invocation closure per manifest key — bespoke per-scraper argument wiring
  // (companyName/abn/acn/directors/alternateNames in varying combinations) lives here.
  // Every key in server/scrapers/manifest.js's SCRAPERS list must have an entry.
  const invocations = {
    abn: () => abnPromise,
    asic: () => asicPromise,
    asicDisqualified: async () => searchASICDisqualifiedFromDataset(await resolveDirectors()),
    asicInsolvency: () => searchAsicInsolvency(companyName, abn, acn),
    atoDebt: () => searchAtoDebt(companyName, abn, acn),
    courts_federal: async () => {
      const [dirs, terms] = await Promise.all([resolveDirectors(), resolveExtraSearchTerms()]);
      return markPartialIfNoDirectors(await searchCourtRecords(companyName, terms, 'federal'), dirs.length);
    },
    courts_qld: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'qld'),
    courts_nsw: async () => {
      const [dirs, terms] = await Promise.all([resolveDirectors(), resolveExtraSearchTerms()]);
      return markPartialIfNoDirectors(await searchCourtRecords(companyName, terms, 'nsw'), dirs.length);
    },
    courts_vic: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'vic'),
    courts_wa: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'wa'),
    courts_sa: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'sa'),
    courts_nt: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'nt'),
    courts_act: async () => {
      const [dirs, terms] = await Promise.all([resolveDirectors(), resolveExtraSearchTerms()]);
      return markPartialIfNoDirectors(await searchCourtRecords(companyName, terms, 'act'), dirs.length);
    },
    courts_tas: async () => searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'tas'),
    paymentTimes: async () => searchPaymentTimes(companyName, await resolveAbn(), acn),
    modernSlavery: () => searchModernSlavery(companyName, abn),
    qbcc: async () => searchQBCC(companyName, abn, await resolveDirectors(), await resolveAlternateNames()),
    fwo: async () => searchFWO(companyName, abn, await resolveExtraSearchTerms()),
    vicBpc: async () => searchVicBpc(companyName, abn, await resolveDirectors()),
    vicVbaLicence: async () => searchVicVbaLicence(companyName, abn, await resolveDirectors()),
    waBuildingEnergy: async () => searchWABuildingEnergy(companyName, abn, await resolveDirectors()),
    nswFairTrading: async () => {
      // Reuses nswDirectorDiscoveryPromise's already-fetched company-name query instead of
      // re-running it — see fetchNswCompanyLookup's doc comment in nswFairTrading.js.
      const dirs = await resolveDirectors();
      const result = await searchNSWFairTrading(companyName, abn, dirs, await nswDirectorDiscoveryPromise);
      return markPartialIfNoDirectors(result, dirs.length);
    },
    ntBuildingPractitioners: async () => searchNTBuildingPractitioners(companyName, abn, await resolveDirectors()),
    actLicences: async () => {
      const dirs = await resolveDirectors();
      return markPartialIfNoDirectors(await searchACTLicences(companyName, abn, dirs), dirs.length);
    },
    actDisciplinary: async () => {
      const dirs = await resolveDirectors();
      return markPartialIfNoDirectors(await searchACTDisciplinary(companyName, abn, dirs), dirs.length);
    },
    waLicenceRegister: async () => searchWALicenceRegister(companyName, abn, await resolveDirectors()),
    tasLicenceRegister: async () =>
      searchTASLicenceRegister(companyName, abn, await resolveDirectors(), process.env.CAPTCHA_API_KEY),
    asicExtract: async () =>
      searchAsicExtract(companyName, abn, acn, await resolveDirectors(), process.env.CAPTCHA_API_KEY),
    asicEnforceableUndertakings: async () => searchAsicEnforceableUndertakings(companyName, await resolveDirectors()),
  };

  const mvpEntries = SCRAPERS.filter((s) => s.mvpScope);
  const nonMvpEntries = SCRAPERS.filter((s) => !s.mvpScope);

  await Promise.all([
    ...mvpEntries.map(async (entry) => {
      const { key, label } = entry;
      // ACT Courts is the one live check with a real manual-link fallback (see
      // courtRecords.js's buildManualFallback) — on an open circuit, degrade to that
      // instead of runScraper's generic "unavailable" message, so a homeowner always
      // has a usable path for this jurisdiction (reliability plan Constraint 1).
      // The half-open trial call (isOpen() false right after cooldown) is intentionally
      // not intercepted here — it goes through runScraper like a normal call so recovery
      // can actually be detected.
      if (key === 'courts_act' && scraperHealth.isOpen(key)) {
        send({ key, label, completeness: 'unavailable', ...buildManualFallback('act') });
        return;
      }
      await runScraper(entry, invocations[key], { send });
    }),
    ...nonMvpEntries.map(async (entry) => {
      const { key, label } = entry;
      send({ key, label, status: 'searching' });
      try {
        const result = await invocations[key]();
        send({ key, label, status: 'done', ...result });
      } catch (err) {
        console.error(`[${key}]`, err);
        send({ key, label, status: 'error', error: 'Search failed', results: [] });
      }
    }),
  ]);
}

module.exports = { runSearchRequest };
