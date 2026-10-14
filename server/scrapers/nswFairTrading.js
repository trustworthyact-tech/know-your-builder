const axios = require('axios');
const { proxiedRequest } = require('./proxyLimiter');
const {
  BUSINESS_NAME_CAP,
  NAME_ONLY,
  asIdentity,
  licenceSummary,
  classifyMatch,
  entityNames,
  makeNameMatcher,
  searchableName,
} = require('./licenceMatching');

// NSW contractor licence register via the Verify NSW public register API.
// The old OneGov SPA (www.onegov.nsw.gov.au/publicregister) has been retired —
// it now redirects straight to the Verify NSW homepage, which is why deep
// links into it landed on a landing page instead of the record. Verify NSW
// (verify.licence.nsw.gov.au) is the live replacement; its API still requires
// no auth, just Origin/Referer matching the SPA host.

const API_BASE = 'https://verify.licence.nsw.gov.au/publicregisterapi/api/v1/licence';
const SEARCH_URL = `${API_BASE}/search/advQuery`;
const REGISTER_BASE = 'https://verify.licence.nsw.gov.au';

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Origin: REGISTER_BASE,
  Referer: `${REGISTER_BASE}/`,
};

// Found live 2026-09-15: Railway's outbound network cannot reach verify.licence.nsw.gov.au
// at all — confirmed by running curl directly inside the Railway container itself (via its
// Console tab), which hung indefinitely, while the identical request from an unrelated
// network returned instantly. Same class of issue already hit and fixed for ACT/Federal
// courts in courtRecords.js (Railway's IP being blocked/degraded reaching a site that's
// otherwise perfectly healthy) — same fix: route through a proxy's URL-wrapper API. This is
// what was silently starving every scraper that depends on resolveDirectors() (which awaits
// fetchNswCompanyLookup below), not a database issue — ruled out separately by finding zero
// active queries in Postgres (pg_stat_activity) during a search where these were hanging.
//
// Originally ScraperAPI, switched to ScrapeOps' Proxy API Aggregator on 2026-09-23 after
// ScraperAPI's free-tier monthly credits were exhausted (confirmed live via SSH: every
// proxied request was getting a 403 from ScraperAPI itself) — see courtRecords.js's ACT
// fetcher comments for the full record; same identical `?api_key=X&url=Y` shape, one-line swap.
//
// `keep_headers=true` is required here specifically (courtRecords.js's plain GETs don't
// need it) — found live 2026-09-23 immediately after the swap: without it, ScrapeOps
// substitutes its own "optimized" headers for whatever you set, so fetchLicences' POST
// arrived at Verify NSW with the wrong Content-Type and got a 415 "Unsupported Media
// Type" back (wrapped in a 200 from ScrapeOps itself, so it looked like a success until
// the response body was inspected — see ScrapeOps' own POST Requests docs). With
// keep_headers=true, the real Content-Type/Origin/Referer in HEADERS below reach Verify
// NSW as sent. Falls back to a direct request when SCRAPEOPS_API_KEY isn't set (local dev).
//
// Every proxied call also goes through proxyLimiter.js's shared semaphore
// (LICENCE_MATCHING_PLAN.md Phase 1.3) — this file, courtRecords.js and fwo.js share one
// ScrapeOps account capped at 5 concurrent requests.
//
// DATA_SOURCES_PLAN.md Phase 2 (2026-10-13): Verify NSW answers Railway directly again (11/11
// search and details requests, ~200ms), so requests go through proxyLimiter's proxiedRequest —
// direct first, then the residential proxy and ScrapeOps (with keep_headers) only if the block
// returns (Phase 4). Responses must have the JSON shape
// below; anything else is a failed lookup, never an empty one.
const isSearchResponse = (data) => Array.isArray(data?.results);
const isDetailsResponse = (data) => Boolean(data?.componentData) && typeof data.componentData === 'object';

// `_http` is injectable (defaults to axios) so tests can simulate failures without the network.
async function fetchLicences(query, _http = axios) {
  const data = await proxiedRequest({
    site: 'nsw',
    method: 'post',
    url: SEARCH_URL,
    data: { licenceGroup: 'Trades', search: query, autoComplete: false, pageNumber: 0, pageSize: 20, licenceTypes: [] },
    headers: HEADERS,
    validate: isSearchResponse,
    label: 'nswFairTrading search',
    priority: 'high',
    keepHeaders: true,
    deadlineMs: 25_000,
    _http,
  });
  return data.results;
}

// A licence's current/expired status says nothing about whether it also carries compliance
// history (penalty notices, disciplinary action, etc), or who's associated with it — both
// only show up on the per-licence details endpoint, so it's fetched once per hit and shared
// by complianceFromDetails() and associatedNamesFromDetails() below, rather than fetching
// the same URL twice for two different purposes.
async function fetchLicenceDetails(licenceType, licenceId, _http = axios) {
  const url = `${API_BASE}/search/details/${encodeURIComponent(licenceType)}/${encodeURIComponent(licenceId)}`;
  try {
    const data = await proxiedRequest({
      site: 'nsw',
      url,
      headers: HEADERS,
      validate: isDetailsResponse,
      label: 'nswFairTrading details',
      priority: 'high',
      keepHeaders: true,
      deadlineMs: 25_000,
      _http,
    });
    return data.componentData;
  } catch {
    return null; // non-fatal — callers treat a null details fetch as "unknown", not "none"
  }
}

function complianceFromDetails(cd) {
  if (!cd) return null;
  const complianceSummary = Array.isArray(cd.complianceSummary) ? cd.complianceSummary : [];
  const totalEvents = complianceSummary.reduce((sum, c) => sum + (c.count || 0), 0);
  const flaggedByNotification = (cd.notifications || []).some(
    (n) => n.RelatedComponent === 'Compliance' || /compliance/i.test(n.type || '')
  );
  return { hasComplianceIssue: flaggedByNotification || totalEvents > 0, totalEvents, complianceSummary };
}

// Director / Nominated Supervisor names for this licence, straight from NSW Fair Trading's
// own register — reliability plan WS3: a free substitute for ASIC's own officer data, which
// requires DSP access currently paused until 2027 (see CLAUDE.md's WS3 entries). "Director"
// is a high-confidence signal (an actual company officer, per NSW's own labelling);
// "Nominated Supervisor" is the licence's required qualified-person role, which may or may
// not also be a company officer — both are returned, but tagged by role so downstream
// consumers/reports can tell them apart rather than treating them as equally certain.
//
// Each person is classified by their own `party.role`, not the group's label: Verify NSW names
// the group "Director" for one director but "Directors" for several, and matching the group
// label exactly silently dropped every director of a multi-director company (found 2026-10-09
// on TURNKEY CREATIONS PTY LTD — LICENCE_MATCHING_PLAN.md finding 2). The group label is only a
// fallback for a party with no role of its own. Roles are returned in canonical form.
const ROLE_LABELS = {
  director: 'Director',
  directors: 'Director',
  'nominated supervisor': 'Nominated Supervisor',
  'nominated supervisors': 'Nominated Supervisor',
};
function associatedNamesFromDetails(cd) {
  if (!cd || !Array.isArray(cd.associatedRoles)) return [];
  const names = [];
  for (const roleGroup of cd.associatedRoles) {
    for (const party of roleGroup?.parties || []) {
      const role = ROLE_LABELS[(party?.role || roleGroup.name || '').trim().toLowerCase()];
      if (role && party?.name) names.push({ name: party.name, role });
    }
  }
  return names;
}

function namesWithRole(associated, role) {
  return [...new Set(associated.filter((a) => a.role === role).map((a) => a.name))].join('; ');
}


// The licences NSW links to each person on a licence record (`parties[].licences`), split by the
// person's role on each one:
//   - `personal`: licences the person holds themselves (role "Licensee") — their own contractor
//     licence or supervisor certificate. Replaces the old per-person name search
//     (LICENCE_MATCHING_PLAN.md 2.6): NSW has already linked them.
//   - `companies`: other company licences the person is a Director / Nominated Supervisor on —
//     the person → linked company route (Phase 2b.2, e.g. Constable's personal licence 241240C
//     lists Turnkey's 259006C with him as Nominated Supervisor).
// Works on a company's record (people are its Director / Nominated Supervisor parties) and on a
// personal licence's record (the person is the "Licensee" party). `selfLicenceId` is the record's
// own licence, never returned as a link to itself.
function linksFromDetails(cd, selfLicenceId) {
  const personal = [];
  const companies = [];
  if (!cd || !Array.isArray(cd.associatedRoles)) return { personal, companies };
  const seen = new Set([selfLicenceId]);
  for (const roleGroup of cd.associatedRoles) {
    for (const party of roleGroup?.parties || []) {
      const partyRole = ROLE_LABELS[(party?.role || roleGroup.name || '').trim().toLowerCase()];
      if (!partyRole && party?.partyType !== 'Individual') continue;
      for (const lic of party.licences || []) {
        if (!lic?.licenceID || !lic.licenceType || seen.has(lic.licenceID)) continue;
        const licRole = (lic.role || '').trim().toLowerCase();
        const link = { ...lic, personName: party.name, personRole: partyRole || 'Licensee' };
        if (licRole === 'licensee' || !licRole) {
          seen.add(lic.licenceID);
          personal.push(link);
        } else if (ROLE_LABELS[licRole]) {
          seen.add(lic.licenceID);
          companies.push({ ...link, companyRole: ROLE_LABELS[licRole] });
        }
      }
    }
  }
  return { personal, companies };
}

// Per-search cap on concurrent NSW proxy requests (LICENCE_MATCHING_PLAN.md 2.3): a sub-limit
// on top of proxyLimiter.js's account-wide 5, so a many-business-name NSW search leaves slots
// for ACT courts and FWO running at the same time.
const NSW_MAX_CONCURRENT = 3;

function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

function licenceUrl(licenceType, licenceId) {
  return licenceType && licenceId
    ? `${REGISTER_BASE}/details/${encodeURIComponent(licenceType)}/${encodeURIComponent(licenceId)}`
    : `${REGISTER_BASE}/home/trades`;
}

function complianceMetadata(compliance) {
  if (!compliance) return {};
  return {
    ComplianceHistory: compliance.hasComplianceIssue
      ? `Yes (${compliance.totalEvents} recorded event(s)) — see licence record for details`
      : 'None recorded',
  };
}

// Linked companies whose licence details are fetched (1 proxy credit each, for ACN + compliance).
// Further linked companies are still listed, from what the person's record already says, without
// a fetch — a nominated supervisor can be on dozens of company licences.
const LINKED_COMPANY_DETAILS_CAP = 3;

// One search context per lookup: the entity's identity and name matchers, a shared `seen` set
// (by licence ID, so the same licence found under its ABN, ACN and name is processed once), the
// per-search concurrency limiter, and the linked-company licences collected along the way.
// Shared by fetchNswCompanyLookup (discovery) and searchNSWFairTrading (the full key), so the
// second continues where the first left off.
function createContext(identity, _http) {
  return {
    identity,
    matchers: entityNames(identity).map(makeNameMatcher),
    seen: new Set(),
    limit: createLimiter(NSW_MAX_CONCURRENT),
    http: _http,
    linkedCompanyLinks: [],
  };
}

const fetchDetails = (ctx, type, id) => ctx.limit(() => fetchLicenceDetails(type, id, ctx.http));

// How a licence reached through a person is labelled: as certain as the record it came from.
function confidenceOf(matchedBy) {
  return matchedBy === NAME_ONLY ? 'name-only' : 'confirmed';
}

// A personal licence's ResultItem (from a company record's link, or a typed person's name
// search), fetching its details for compliance history and the companies it links to.
async function buildPersonalLicenceItem(lic, { matchedBy, linkedVia, confidence }, ctx) {
  const cd = await fetchDetails(ctx, lic.licenceType, lic.licenceID);
  const c = complianceFromDetails(cd);
  for (const company of linksFromDetails(cd, lic.licenceID).companies) {
    ctx.linkedCompanyLinks.push({ ...company, confidence });
  }
  const expiry = (lic.expiry || '').slice(0, 10);
  return {
    title: lic.licensee || lic.personName,
    url: licenceUrl(lic.licenceType, lic.licenceID),
    date: expiry,
    status: lic.status || '',
    description: `${lic.licenceType} — Licence ${lic.licenceNumber || ''}${c?.hasComplianceIssue ? ' — compliance history on record' : ''}`,
    jurisdiction: 'NSW',
    metadata: {
      Source: 'NSW Fair Trading',
      LicenceNumber: lic.licenceNumber,
      LicenceType: lic.licenceType,
      Status: lic.status,
      Expiry: expiry,
      MatchedBy: matchedBy,
      ...(linkedVia ? { LinkedVia: linkedVia } : {}),
      ...complianceMetadata(c),
    },
  };
}

// Builds the ResultItem for one accepted entity licence hit, plus the people on it and the items
// for their linked personal licences. A failed details fetch leaves ComplianceHistory and the
// people unset — "unknown", never "none".
async function buildLicenceItems(hit, matchedBy, ctx) {
  const confidence = confidenceOf(matchedBy);
  const details = hit.licenceId && hit.licenceType ? await fetchDetails(ctx, hit.licenceType, hit.licenceId) : null;
  const compliance = complianceFromDetails(details);
  const associated = associatedNamesFromDetails(details).map((a) => ({ ...a, confidence }));
  const director = namesWithRole(associated, 'Director');
  const supervisor = namesWithRole(associated, 'Nominated Supervisor');
  const complianceSuffix = compliance?.hasComplianceIssue ? ' — compliance history on record' : '';

  const items = [
    {
      title: hit.licensee || '',
      url: licenceUrl(hit.licenceType, hit.licenceId),
      date: hit.expires || '',
      status: hit.status || '',
      description: `${hit.licenceTypeFriendly || 'NSW Contractor Licence'} — Licence ${hit.licenceNumber || ''}${complianceSuffix}`,
      jurisdiction: 'NSW',
      metadata: {
        Source: 'NSW Fair Trading',
        LicenceNumber: hit.licenceNumber,
        LicenceType: hit.licenceTypeFriendly,
        Status: hit.status,
        Expiry: hit.expires,
        ...(hit.ABN ? { ABN: hit.ABN } : {}),
        ...(hit.ACN ? { ACN: hit.ACN } : {}),
        MatchedBy: matchedBy,
        ...complianceMetadata(compliance),
        ...(director ? { Director: director } : {}),
        ...(supervisor ? { NominatedSupervisor: supervisor } : {}),
      },
    },
  ];

  // A personal licence is only as certain as the company licence it was linked from, so a
  // name-only parent keeps its children name-only too.
  const links = linksFromDetails(details, hit.licenceId);
  for (const company of links.companies) ctx.linkedCompanyLinks.push({ ...company, confidence });
  const personal = links.personal.filter((lic) => !ctx.seen.has(lic.licenceID));
  for (const lic of personal) ctx.seen.add(lic.licenceID);
  const personalItems = await Promise.all(
    personal.map((lic) =>
      buildPersonalLicenceItem(
        lic,
        {
          matchedBy: matchedBy === NAME_ONLY ? NAME_ONLY : 'Linked on licence record',
          linkedVia: `${lic.personRole} on licence ${hit.licenceNumber || ''}`,
          confidence,
        },
        ctx
      )
    )
  );
  items.push(...personalItems);
  return { items, associatedNames: associated };
}

// Runs one free-text search. For an entity query, every hit is classified against the entity's
// identity (licenceMatching.js): ABN/ACN matches → confirmed; a different, comparable identifier
// → rejected even when the name matches; no comparable identifier → kept only if the name
// matches, as name-only. For a person query (a name the user typed — Phase 2b.1), only an
// individual's licence whose name matches the person is kept, as name-only (could be a
// namesake), and the companies that licence links to are collected. Returns `failed: true` when
// the search request itself failed — never read as "no licence" (Phase 1.2).
async function runQuery({ query, person }, ctx) {
  let hits;
  try {
    hits = await ctx.limit(() => fetchLicences(query, ctx.http));
  } catch (err) {
    console.error(`[nswFairTrading] licence search failed for "${query}":`, err.message || err);
    return { items: [], associatedNames: [], failed: true };
  }

  if (person) {
    const matches = makeNameMatcher(person);
    const accepted = hits.filter(
      (hit) => hit.licenseeType !== 'Organisation' && matches(hit.licensee || '') && hit.licenceId && !ctx.seen.has(hit.licenceId)
    );
    for (const hit of accepted) ctx.seen.add(hit.licenceId);
    const items = await Promise.all(
      accepted.map((hit) =>
        buildPersonalLicenceItem(
          { licenceID: hit.licenceId, licenceType: hit.licenceType, licenceNumber: hit.licenceNumber, licensee: hit.licensee, status: hit.status, expiry: hit.expires, personName: person },
          { matchedBy: NAME_ONLY, linkedVia: `Searched as ${person}`, confidence: 'name-only' },
          ctx
        )
      )
    );
    return { items, associatedNames: [], failed: false };
  }

  const accepted = [];
  for (const hit of hits) {
    const key = hit.licenceId || `${hit.licenceNumber}|${hit.licensee}`;
    if (ctx.seen.has(key)) continue;
    const { match, matchedBy } = classifyMatch(
      { identifiers: [hit.ABN, hit.ACN], names: [hit.licensee, ...(hit.businessNameList || [])] },
      ctx.identity,
      ctx.matchers
    );
    if (!match) continue;
    ctx.seen.add(key);
    if (match === 'rejected') {
      console.log(`[nswFairTrading] rejected "${hit.licensee}" (${hit.licenceNumber}): name matches, identifiers differ`);
      continue;
    }
    accepted.push({ hit, matchedBy });
  }

  const built = await Promise.all(accepted.map(({ hit, matchedBy }) => buildLicenceItems(hit, matchedBy, ctx)));
  return {
    items: built.flatMap((b) => b.items),
    associatedNames: built.flatMap((b) => b.associatedNames),
    failed: false,
  };
}

async function runQueries(queries, ctx) {
  const outcomes = await Promise.all(queries.map((q) => runQuery(q, ctx)));
  return {
    items: outcomes.flatMap((o) => o.items),
    associatedNames: outcomes.flatMap((o) => o.associatedNames),
    queries: outcomes.length,
    failedQueries: outcomes.filter((o) => o.failed).length,
  };
}

// Turns the linked-company licences collected so far into result items and a linked-company
// list (Phase 2b.2). The searched entity's own licences are already in `seen` and are skipped.
// Confirmed links first; details (ACN, compliance) fetched for the first few only.
async function resolveLinkedCompanies(ctx) {
  const byLicence = new Map();
  for (const link of ctx.linkedCompanyLinks) {
    if (ctx.seen.has(link.licenceID)) continue;
    const existing = byLicence.get(link.licenceID);
    if (!existing || (existing.confidence === 'name-only' && link.confidence === 'confirmed')) byLicence.set(link.licenceID, link);
  }
  ctx.linkedCompanyLinks = [];
  const links = [...byLicence.values()].sort((a, b) => (a.confidence === 'confirmed' ? 0 : 1) - (b.confidence === 'confirmed' ? 0 : 1));
  for (const link of links) ctx.seen.add(link.licenceID);

  const built = await Promise.all(
    links.map(async (link, i) => {
      const cd = i < LINKED_COMPANY_DETAILS_CAP ? await fetchDetails(ctx, link.licenceType, link.licenceID) : null;
      const c = complianceFromDetails(cd);
      const acn = cd?.ACN || '';
      const expiry = (link.expiry || '').slice(0, 10);
      const via = `${link.personName} (${link.companyRole})`;
      const matchedBy = link.confidence === 'confirmed' ? `Linked company — via ${link.personName}` : NAME_ONLY;
      return {
        company: { name: link.licensee, acn, abn: '', licenceNumber: link.licenceNumber, person: link.personName, via, confidence: link.confidence, source: 'NSW' },
        item: {
          title: link.licensee || '',
          url: licenceUrl(link.licenceType, link.licenceID),
          date: expiry,
          status: link.status || '',
          description: `${link.licenceType} — Licence ${link.licenceNumber || ''}${c?.hasComplianceIssue ? ' — compliance history on record' : ''}`,
          jurisdiction: 'NSW',
          metadata: {
            Source: 'NSW Fair Trading',
            LicenceNumber: link.licenceNumber,
            LicenceType: link.licenceType,
            Status: link.status,
            Expiry: expiry,
            ...(acn ? { ACN: acn } : {}),
            MatchedBy: matchedBy,
            LinkedCompany: link.licensee,
            LinkedVia: via,
            ...complianceMetadata(c),
          },
        },
      };
    })
  );
  return { items: built.map((b) => b.item), linkedCompanies: built.map((b) => b.company) };
}

function uniqueQueries(names, exclude = []) {
  const seen = new Set(exclude);
  const out = [];
  for (const n of names) {
    const q = searchableName(n);
    if (!q || seen.has(q)) continue;
    seen.add(q);
    out.push(q);
  }
  return out;
}

// Discovery queries (a): ABN digits, ACN digits, the legal name (typed name when there's no ABN
// record), and any person names the user typed. Identifiers are searched digits-only — Verify NSW
// returns nothing for spaced formats — and both, because NSW records an ABN on some licences, an
// ACN on others (LICENCE_MATCHING_PLAN.md finding 3). Typed people are here, not in (b), so the
// companies their licences link to are known in time for the court searches. These must finish
// inside the orchestrator's 20s discovery bound.
function primaryQueries(identity, people) {
  const ids = [...new Set([identity.abn, identity.acn || identity.possibleAcn].filter(Boolean))];
  const personQueries = [...new Set((people || []).map((p) => (p || '').trim()).filter(Boolean))];
  return [
    ...ids.map((query) => ({ query })),
    ...uniqueQueries([identity.legalName || identity.typedName]).map((query) => ({ query })),
    ...personQueries.map((person) => ({ query: person, person })),
  ];
}

// Enrichment queries (b): the typed name when it differs, ABR business names (capped — each was
// a proxy credit, and still is if Verify NSW re-blocks Railway), the trust's own name, and the
// entity's former names (DATA_SOURCES_PLAN.md 2.4). Run by the main nswFairTrading key, inside
// its 45s.
function secondaryQueries(identity) {
  const primaryName = searchableName(identity.legalName || identity.typedName);
  return uniqueQueries(
    [identity.typedName, ...identity.businessNames.slice(0, BUSINESS_NAME_CAP), identity.trustName, ...(identity.formerNames ?? [])],
    [primaryName]
  ).map((query) => ({ query }));
}

// The discovery lookup (Phase A) — what searchOrchestrator.js hoists once and resolveDirectors()
// and the linked-company list depend on. `people` are names the user typed (never names
// discovered from a record — that would be circular, and the record already links them).
// `failed` means every discovery query failed, so the main key knows to re-run them rather than
// reuse an empty result. `identityOrName` is a licenceMatching.js identity, or a plain company
// name for standalone use.
async function fetchNswCompanyLookup(identityOrName, people = [], _http = axios) {
  const ctx = createContext(asIdentity(identityOrName), _http);
  const out = await runQueries(primaryQueries(ctx.identity, people), ctx);
  const linked = await resolveLinkedCompanies(ctx);
  return {
    ...out,
    items: [...out.items, ...linked.items],
    linkedCompanies: linked.linkedCompanies,
    ctx,
    failed: out.queries > 0 && out.failedQueries === out.queries,
  };
}

// The full nswFairTrading key: reuses the discovery lookup when it succeeded (re-runs it when it
// failed or timed out — the orchestrator's timeout fallback carries `failed: true`), then runs
// the enrichment queries. `people` are names the user typed; they're searched as part of
// discovery, so only re-searched here if discovery has to be re-run.
async function searchNSWFairTrading(identityOrName, abn, people, preFetchedPrimary, _http = axios) {
  const identity = asIdentity(identityOrName, abn);
  const reusePrimary = Boolean(preFetchedPrimary && !preFetchedPrimary.failed && preFetchedPrimary.ctx);
  const ctx = reusePrimary ? preFetchedPrimary.ctx : createContext(identity, _http);
  // Discovery ran before the former names were known, so a reused context matches records
  // against them too from here on (a former-name hit without identifiers is "verify" only).
  if (reusePrimary && identity.formerNames?.length) {
    ctx.matchers = entityNames({ ...ctx.identity, formerNames: identity.formerNames }).map(makeNameMatcher);
  }
  let primary = preFetchedPrimary;
  if (!reusePrimary) {
    primary = await runQueries(primaryQueries(identity, people), ctx);
  }
  const secondary = await runQueries(secondaryQueries(identity), ctx);
  const linked = await resolveLinkedCompanies(ctx);

  const allResults = [...primary.items, ...secondary.items, ...linked.items];
  const queries = primary.queries + secondary.queries;
  const failedQueries = primary.failedQueries + secondary.failedQueries;

  const searchUrl = `${REGISTER_BASE}/home/trades`;
  const result = {
    source: 'NSW Fair Trading — Contractor Licence Register',
    jurisdiction: 'NSW',
    category: 'license',
    results: allResults,
    searchUrl,
    summary: licenceSummary(allResults, identity, {
      found: 'NSW contractor licence record(s)',
      none: 'NSW contractor licence',
    }),
  };

  // Same split as courtRecords.js's runJurisdictionSearch: every search failed → nothing was
  // actually checked, so status 'error' / 'unavailable' (validateResult.js and the report's
  // isAllErrored() both key off status); only some failed → 'partial'. Zero queries (no name,
  // ABN or person to search under) is also nothing checked.
  if (queries === 0 || (failedQueries > 0 && failedQueries === queries)) {
    return {
      ...result,
      status: 'error',
      error: 'Search failed',
      completeness: 'unavailable',
      summary:
        queries === 0
          ? 'No name, ABN or person to search the NSW licence register under'
          : 'Could not complete the NSW licence search — try again or search the register manually',
    };
  }
  if (failedQueries > 0) {
    const failureNote = `NSW licence lookup failed for ${failedQueries} of ${queries} search(es) — verify manually`;
    result.completeness = 'partial';
    result.summary = allResults.length > 0 ? `${result.summary}; ${failureNote}` : failureNote;
  }
  return result;
}

module.exports = {
  isSearchResponse,
  isDetailsResponse,
  searchNSWFairTrading,
  fetchNswCompanyLookup,
  associatedNamesFromDetails,
  linksFromDetails,
};
