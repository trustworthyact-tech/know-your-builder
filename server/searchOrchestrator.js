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
const {
  resolveEntityIdentity,
  COURT_FWO_BUSINESS_NAME_CAP,
  LINKED_COMPANY_CAP,
  buildTermProvenance,
  labelResultsByTerm,
  normaliseDigits,
  normaliseEntityName,
} = require('./scrapers/licenceMatching');
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
const {
  searchACTLicences,
  searchACTDisciplinary,
  resolveActAssociatedNames,
  resolveActLinkedCompanies,
} = require('./scrapers/actLicences');
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

  // Who the entity is (LICENCE_MATCHING_PLAN.md 2.2): legal name, ABN, ACN, entity type,
  // business names and trust name, resolved once from the ABN lookup and shared by the NSW and
  // ACT licence checks and people discovery — so a search typed as a trading name still searches
  // the registers under the legal name and identifiers. abnPromise has no overall timeout of its
  // own (several 15s ABR calls), so it's bounded here and fails open to the typed name/ABN: a
  // slow ABR must not eat the 20s discovery window below. With no ABN typed there is nothing to
  // wait for.
  const identityPromise = abn
    ? withTimeout(abnPromise, 8_000)
        .then((abnResult) => resolveEntityIdentity({ abn, acn, companyName }, abnResult))
        .catch(() => resolveEntityIdentity({ abn, acn, companyName }, null))
    : Promise.resolve(resolveEntityIdentity({ abn, acn, companyName }, null));

  // WS3 (reliability plan) — director discovery via NSW/ACT's own licence registers, a free
  // substitute for ASIC's own officer data (its DSP application path is paused until 2027 —
  // see CLAUDE.md's WS3 entries; the ASIC-backed path resolveDirectors() used to attempt is
  // still broken/unavailable, not just deprioritised). Hoisted once here, same pattern as
  // abnPromise/asicPromise above, so every one of resolveDirectors()'s consumers shares a
  // single lookup instead of each triggering its own. NSW is a live HTTP call, so it's bounded
  // by withTimeout and fails open (empty result, not a rejection) — a slow or down NSW
  // register must never block the other scrapers, which is exactly the class of problem
  // the 2026-09-08 ASIC-dependency removal fixed for this same function; reintroducing an
  // unbounded network dependency here would undo that fix. ACT reads an already-local dataset
  // cache (WS1), so resolveActAssociatedNames only needs a fail-open catch, not a timeout.
  // The 20s bound covers the identity lookup above, proxy queueing and NSW's discovery queries.
  //
  // The raw lookup is kept separately: when discovery's 20s bound fires, the underlying request
  // is still running (withTimeout doesn't cancel it), so the nswFairTrading key awaits that same
  // request inside its own 45s budget instead of paying for a second set of proxied queries. The
  // discovery fallback carries `failed: true` so it can never be mistaken for "no licence".
  // .catch(() => {}) mirrors abnPromise/asicPromise: nothing may be left without a handler.
  // Names the user typed into the search (a director-only search has nothing else). NSW searches
  // these as part of discovery (Phase 2b.1); names discovered from licence records are not
  // searched there, since the record already links their licences.
  const typedPeople = [...new Set((directors ?? []).map((d) => (d || '').trim()).filter(Boolean))];
  const nswCompanyLookupPromise = identityPromise.then((identity) => fetchNswCompanyLookup(identity, typedPeople));
  nswCompanyLookupPromise.catch(() => {});
  const nswDirectorDiscoveryPromise = withTimeout(nswCompanyLookupPromise, 20_000).catch(
    () => ({ items: [], associatedNames: [], linkedCompanies: [], failed: true })
  );
  const actDirectorDiscoveryPromise = identityPromise
    .then((identity) => resolveActAssociatedNames(identity))
    .catch(() => []);

  // Returns the best available ABN: request-supplied first, then first ABN scraper result.
  // Safe to call concurrently — all callers await the same promise.
  async function resolveAbn() {
    if (abn) return abn;
    const abnResult = await abnPromise;
    return (abnResult.results ?? [])[0]?.metadata?.ABN?.replace(/\s/g, '') ?? '';
  }

  // Returns ABR-registered business/trading names for this ABN — a sole trader's
  // licence or QBCC adjudication decision is often filed under a business name
  // rather than their personal name. `cap` limits how many are returned for proxy-backed
  // per-name searches, which spend a ScrapeOps credit per name (see licenceMatching.js).
  async function resolveAlternateNames(cap = Infinity) {
    const abnResult = await abnPromise;
    return [...new Set([...(abnResult.businessNames ?? []), ...(abnResult.tradingNames ?? [])])].slice(0, cap);
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
    // Deduped case-insensitively: NSW writes "Frank Walmsley", ACT "FRANK WALMSLEY" — the same
    // person must not be searched (and spend proxy credits) twice. First spelling wins, typed
    // names first.
    const seen = new Set();
    return [...(directors ?? []), ...discovered].filter((name) => {
      const key = normaliseEntityName(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Other companies the searched entity's people (typed or discovered) are linked to in the
  // licence registers (LICENCE_MATCHING_PLAN.md Phase 2b.2): NSW via a personal licence's own
  // record, ACT via partner/nominee lists. The searched entity itself is excluded. Confirmed
  // links first, then capped — each linked company adds proxy-backed court/FWO searches.
  // Never rejects: an empty list just means nothing extra is searched.
  let linkedCompaniesPromise;
  function resolveLinkedCompanies() {
    linkedCompaniesPromise ??= (async () => {
      const [identity, nsw, people] = await Promise.all([
        identityPromise,
        nswDirectorDiscoveryPromise,
        resolveDirectors(),
      ]);
      const act = await resolveActLinkedCompanies(identity, people).catch(() => []);
      const isSelf = (c) =>
        [c.abn, c.acn].some((d) => d && [identity.abn, identity.acn, identity.possibleAcn].includes(normaliseDigits(d))) ||
        normaliseEntityName(c.name) === normaliseEntityName(identity.legalName || identity.typedName);
      const byKey = new Map();
      for (const c of [...(nsw.linkedCompanies ?? []), ...act]) {
        if (!c.name || isSelf(c)) continue;
        const key = normaliseDigits(c.acn) || normaliseDigits(c.abn).slice(2) || normaliseEntityName(c.name);
        const existing = byKey.get(key);
        if (!existing || (existing.confidence !== 'confirmed' && c.confidence === 'confirmed')) byKey.set(key, c);
      }
      return [...byKey.values()]
        .sort((a, b) => (a.confidence === 'confirmed' ? 0 : 1) - (b.confidence === 'confirmed' ? 0 : 1))
        .slice(0, LINKED_COMPANY_CAP);
    })().catch(() => []);
    return linkedCompaniesPromise;
  }

  // Directors + ABR trading/business names, combined — for scrapers that treat their
  // "extra terms" parameter generically as more names to search under (courtRecords, FWO),
  // not just directors. resolveDirectors/resolveAlternateNames depend on different
  // upstream promises (asicPromise vs abnPromise), so run them concurrently rather than
  // awaiting serially. `businessNameCap` applies to the business names only, never to people.
  //
  // Also the entity's legal name when it differs from the typed name (a search typed as a trading
  // name still searches both — Phase 2b.5; the cap applies only to the remaining business names),
  // and the legal names of linked companies (Phase 2b.3, at most LINKED_COMPANY_CAP).
  async function resolveExtraSearchTerms(businessNameCap = Infinity) {
    const [identity, directorNames, alternateNames, linked] = await Promise.all([
      identityPromise,
      resolveDirectors(),
      resolveAlternateNames(businessNameCap),
      resolveLinkedCompanies(),
    ]);
    const typedKey = normaliseEntityName(companyName);
    const names = [identity.legalName, ...directorNames, ...alternateNames, ...linked.map((c) => c.name)];
    const seen = new Set([typedKey]);
    return names.filter((n) => {
      const key = normaliseEntityName(n);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Who each search name belongs to, and the labelling of court/FWO/ASIC EU results by the name
  // that found them (LICENCE_MATCHING_PLAN.md 3.1/3.3) — see licenceMatching.js's
  // buildTermProvenance/labelResultsByTerm.
  let termProvenancePromise;
  function resolveTermProvenance() {
    termProvenancePromise ??= (async () => {
      const [identity, nsw, act, linked] = await Promise.all([
        identityPromise,
        nswDirectorDiscoveryPromise,
        actDirectorDiscoveryPromise,
        resolveLinkedCompanies(),
      ]);
      return buildTermProvenance({
        companyName,
        identity,
        typedPeople,
        discoveredPeople: [...(nsw.associatedNames ?? []), ...act],
        linkedCompanies: linked,
      });
    })().catch(() => new Map());
    return termProvenancePromise;
  }

  async function withTermProvenance(result) {
    if (!Array.isArray(result?.results) || !result.results.some((r) => r.matchedTerm)) return result;
    return labelResultsByTerm(result, await resolveTermProvenance());
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

  // Business-level checks keyed on a company name or ABN. A director-only search has neither, and
  // sending these a blank name matched unrelated companies — found 2026-10-11: a search for one
  // person showed 10 ASIC insolvency notices for random companies, and the risk summary flagged
  // them. Reported as not searched instead.
  const hasEntity = Boolean((companyName || '').trim() || (abn || '').trim() || (acn || '').trim());
  function notSearchedWithoutEntity(source) {
    // status 'error' + 'unavailable', the pairing validateResult.js and the WS4 load test expect
    // for "nothing was checked" — never a 'done' that reads as a clean result.
    return {
      source,
      status: 'error',
      error: 'Not searched',
      results: [],
      completeness: 'unavailable',
      summary: 'Not searched — no company name or ABN was given (person-only search)',
    };
  }

  // One invocation closure per manifest key — bespoke per-scraper argument wiring
  // (companyName/abn/acn/directors/alternateNames in varying combinations) lives here.
  // Every key in server/scrapers/manifest.js's SCRAPERS list must have an entry.
  const invocations = {
    abn: () => abnPromise,
    asic: () => asicPromise,
    asicDisqualified: async () => searchASICDisqualifiedFromDataset(await resolveDirectors()),
    asicInsolvency: async () =>
      hasEntity ? searchAsicInsolvency(companyName, abn, acn) : notSearchedWithoutEntity('ASIC Published Notices — Insolvency'),
    atoDebt: async () =>
      hasEntity ? searchAtoDebt(companyName, abn, acn) : notSearchedWithoutEntity('ASIC Published Notices — ATO tax debt'),
    courts_federal: async () => {
      const [dirs, terms] = await Promise.all([resolveDirectors(), resolveExtraSearchTerms()]);
      return markPartialIfNoDirectors(await withTermProvenance(await searchCourtRecords(companyName, terms, 'federal')), dirs.length);
    },
    courts_qld: async () => withTermProvenance(await searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'qld')),
    courts_nsw: async () => {
      const [dirs, terms] = await Promise.all([resolveDirectors(), resolveExtraSearchTerms()]);
      return markPartialIfNoDirectors(await withTermProvenance(await searchCourtRecords(companyName, terms, 'nsw')), dirs.length);
    },
    courts_vic: async () => withTermProvenance(await searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'vic')),
    courts_wa: async () => withTermProvenance(await searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'wa')),
    courts_sa: async () => withTermProvenance(await searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'sa')),
    courts_nt: async () => withTermProvenance(await searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'nt')),
    courts_act: async () => {
      const [dirs, terms] = await Promise.all([
        resolveDirectors(),
        resolveExtraSearchTerms(COURT_FWO_BUSINESS_NAME_CAP),
      ]);
      return markPartialIfNoDirectors(await withTermProvenance(await searchCourtRecords(companyName, terms, 'act')), dirs.length);
    },
    courts_tas: async () => withTermProvenance(await searchCourtRecords(companyName, await resolveExtraSearchTerms(), 'tas')),
    paymentTimes: async () =>
      hasEntity ? searchPaymentTimes(companyName, await resolveAbn(), acn) : notSearchedWithoutEntity('Payment Times Reporting Register'),
    modernSlavery: async () =>
      hasEntity ? searchModernSlavery(companyName, abn) : notSearchedWithoutEntity('Modern Slavery Statements Register'),
    qbcc: async () => searchQBCC(companyName, abn, await resolveDirectors(), await resolveAlternateNames()),
    fwo: async () =>
      withTermProvenance(await searchFWO(companyName, abn, await resolveExtraSearchTerms(COURT_FWO_BUSINESS_NAME_CAP))),
    vicBpc: async () => searchVicBpc(companyName, abn, await resolveDirectors()),
    vicVbaLicence: async () => searchVicVbaLicence(companyName, abn, await resolveDirectors()),
    waBuildingEnergy: async () => searchWABuildingEnergy(companyName, abn, await resolveDirectors()),
    nswFairTrading: async () => {
      // Reuses the discovery lookup already started (see nswCompanyLookupPromise above) and adds
      // the business-name and trust-name queries. If discovery itself failed, searchNSWFairTrading
      // re-runs it once. A rejection (not expected — every query catches its own errors) becomes a
      // failed primary, so it's re-queried rather than read as "no licence". No longer waits for
      // resolveDirectors() or gets markPartialIfNoDirectors(): NSW doesn't search under person
      // names any more (LICENCE_MATCHING_PLAN.md 2.6), so a missing person list doesn't make it
      // partial.
      const identity = await identityPromise;
      const primary = await nswCompanyLookupPromise.catch(() => ({ failed: true }));
      return searchNSWFairTrading(identity, abn, typedPeople, primary);
    },
    ntBuildingPractitioners: async () => searchNTBuildingPractitioners(companyName, abn, await resolveDirectors()),
    actLicences: async () => {
      const [identity, dirs] = await Promise.all([identityPromise, resolveDirectors()]);
      return markPartialIfNoDirectors(await searchACTLicences(identity, abn, dirs), dirs.length);
    },
    actDisciplinary: async () => {
      const [identity, dirs, linked] = await Promise.all([identityPromise, resolveDirectors(), resolveLinkedCompanies()]);
      return markPartialIfNoDirectors(await searchACTDisciplinary(identity, abn, dirs, undefined, linked), dirs.length);
    },
    waLicenceRegister: async () => searchWALicenceRegister(companyName, abn, await resolveDirectors()),
    tasLicenceRegister: async () =>
      searchTASLicenceRegister(companyName, abn, await resolveDirectors(), process.env.CAPTCHA_API_KEY),
    asicExtract: async () =>
      searchAsicExtract(companyName, abn, acn, await resolveDirectors(), process.env.CAPTCHA_API_KEY),
    asicEnforceableUndertakings: async () => {
      const [identity, dirs, linked] = await Promise.all([identityPromise, resolveDirectors(), resolveLinkedCompanies()]);
      const extra = [identity.legalName, ...dirs, ...linked.map((c) => c.name)].filter(Boolean);
      return withTermProvenance(await searchAsicEnforceableUndertakings(companyName, [...new Set(extra)]));
    },
  };

  // Launch scope (see manifest.js's ENABLED_JURISDICTIONS / CLAUDE.md "Launch scope") is
  // applied first, before the mvpScope split below — an out-of-scope key is filtered out
  // entirely here and never reaches either Promise.all loop, so it's never invoked, never
  // holds a resource (Puppeteer page slot, etc.), and — deliberately, unlike a
  // DISABLED_SCRAPER_KEYS entry — never gets a `send()` call at all. The web UI's own
  // scope filter (web/lib/scope.ts) must match this set, or the progress bar will hang
  // waiting for a result that will never arrive.
  const inScopeEntries = SCRAPERS.filter((s) => s.inScope);
  const mvpEntries = inScopeEntries.filter((s) => s.mvpScope);
  const nonMvpEntries = inScopeEntries.filter((s) => !s.mvpScope);

  // A key disabled via DISABLED_SCRAPER_KEYS (manifest.js) never gets invoked at all —
  // not run-and-ignored, genuinely skipped, so it can't hold a Puppeteer page slot or any
  // other resource. Reported honestly as unavailable rather than a silent empty "clean"
  // result, same convention as buildManualFallback below.
  function disabledResult(label) {
    return {
      status: 'error',
      completeness: 'unavailable',
      results: [],
      error: 'Temporarily disabled',
      summary: `${label} is temporarily disabled — see CLAUDE.md for why`,
    };
  }

  await Promise.all([
    ...mvpEntries.map(async (entry) => {
      const { key, label } = entry;
      if (!entry.enabled) {
        send({ key, label, ...disabledResult(label) });
        return;
      }
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
      if (!entry.enabled) {
        send({ key, label, status: 'error', ...disabledResult(label) });
        return;
      }
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
