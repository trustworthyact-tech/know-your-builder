'use strict';

// Identifier-first entity matching for licence and disciplinary registers
// (LICENCE_MATCHING_PLAN.md Phase 2.1; the rules are CLAUDE.md "Scraper conventions" →
// "Licence-register entity matching"). Every licence register scraper uses this module rather
// than its own copy of the matching logic — a deliberate exception to this codebase's
// file-local-helper habit, because these rules decide whether a licence belongs to the
// searched entity and must not drift between registers.
//
// In short: work out who the entity is once, from the ABN lookup (legal name, ABN, ACN, entity
// type, business names, trust name). Then classify every register hit: identifiers match →
// confirmed; identifiers comparable but different → rejected, even if the name matches; no
// comparable identifiers + name matches → name-only ("verify"), which is shown but must never
// drive a risk finding.

// Proxy-backed per-name searches spend ScrapeOps credits per name (free plan, 1,000/month,
// shared by NSW licences, ACT courts and FWO). NSW licence searches take up to 10 business
// names. ACT courts (2 credits per name) and FWO take 3 — decided 2026-10-09 after one
// 11-business-name search used 55 credits (CLAUDE.md "ScrapeOps proxy credits run out").
// Local, free matching (ACT licence registers) is uncapped.
const BUSINESS_NAME_CAP = 10;
const COURT_FWO_BUSINESS_NAME_CAP = 3;
// Linked companies (other companies a person is on, found in the licence registers) whose legal
// names are added to the court/FWO/other name-based searches — legal name only, not their own
// business names, which fans out quickly (decided 2026-10-11).
const LINKED_COMPANY_CAP = 3;
// Former company names (ASIC Company Dataset, confirmed by ACN) added to the court/FWO/other
// name-based searches. Capped while courts and FWO are still live proxy-backed searches
// (DATA_SOURCES_PLAN.md 1.4); the dataset doesn't date each former name, so it's the first 3.
const FORMER_NAME_CAP = 3;

function normaliseDigits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

// "P/L", "Pty. Ltd.", "Pty Limited", "Proprietary Limited" → "pty ltd"; bracketed words such as
// "(Aust)" or "(ACT)" dropped; "&" → "and"; punctuation and repeated whitespace collapsed.
// Zero-width and soft-hyphen characters are removed, not turned into spaces: found in register
// data (VIC BPC, 2026-10-12 — "\u200B\u200BImam Holdings Pty Ltd"), and one inside a word would
// otherwise split it in two and break the match (DATA_SOURCES_PLAN.md Phase 0).
const INVISIBLE_CHARS = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;

function normaliseEntityName(name) {
  return String(name ?? '')
    .replace(INVISIBLE_CHARS, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bp\s*\/\s*l\b/g, ' pty ltd ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\bproprietary\b/g, 'pty')
    .replace(/\blimited\b/g, 'ltd')
    .replace(/\s+/g, ' ')
    .trim();
}

// The name to type into a register's free-text search: normalised, minus the company suffix
// (registers phrase-match, and "PTY LIMITED" vs "PTY LTD" breaks that — see CLAUDE.md's
// 2026-08-31 "Pty Limited" entry).
function searchableName(name) {
  return normaliseEntityName(name).replace(/\s*\bpty ltd$/, '').replace(/\s*\bltd$/, '').trim();
}

const STOPWORDS = new Set(['pty', 'ltd', 'the', 'and', 'of', 'a', 'as', 'for']);

function significantWords(name) {
  return normaliseEntityName(name)
    .split(' ')
    .filter((w) => (w.length > 2 || /^\d+$/.test(w)) && !STOPWORDS.has(w));
}

// Builds a matcher for one query name: true when every significant word of the query appears
// as a whole word in the (normalised) record text. Compiled once per query, since ACT matching
// runs every query against ~32k rows.
function makeNameMatcher(query) {
  const words = significantWords(query);
  if (words.length === 0) return () => false;
  const patterns = words.map((w) => new RegExp(`\\b${w}\\b`));
  return (text) => {
    const norm = normaliseEntityName(text);
    return patterns.every((p) => p.test(norm));
  };
}

// "The Trustee for the Smith Family Trust" → "Smith Family Trust"; anything else → ''.
function parseTrustName(legalName) {
  const m = /^\s*the\s+trustee\s+for\s+(?:the\s+)?(.+?)\s*$/i.exec(legalName || '');
  return m ? m[1] : '';
}

function isCompanyEntityType(entityType) {
  return /company/i.test(entityType || '');
}

// True only when the ABR says the entity is something other than a company (a trust, sole
// trader, partnership…). Unknown entity type (no ABR record) is not "known non-company".
function isKnownNonCompany(identity) {
  return Boolean(identity?.entityType) && !isCompanyEntityType(identity.entityType);
}

// Who the searched entity is, resolved once per search from the ABN lookup (searchABN's
// result). Without an ABN the typed name is all there is. The ACN is the user's, or — only when
// the ABR says the entity is a company — the last 9 digits of its ABN (a company's ABN is two
// check digits plus its ACN; for a trust or sole trader those 9 digits are not an ACN).
function resolveEntityIdentity({ abn, acn, companyName } = {}, abnResult = null) {
  const typedName = (companyName || '').trim();
  const abnDigits = normaliseDigits(abn);
  const typedAcn = normaliseDigits(acn);
  const abr = abn && abnResult ? (abnResult.results ?? [])[0] : null;
  const fields = abr?.metadata ?? {};

  const legalName = (abr && (fields['Entity name'] || abr.title)) || '';
  const entityType = fields['Entity type'] || '';
  const recordAbn = normaliseDigits(fields.ABN);
  const resolvedAbn = abnDigits.length === 11 ? abnDigits : recordAbn.length === 11 ? recordAbn : '';
  let resolvedAcn = typedAcn.length === 9 ? typedAcn : '';
  if (!resolvedAcn && resolvedAbn && isCompanyEntityType(entityType)) resolvedAcn = resolvedAbn.slice(2);
  // Entity type unknown (no ABR record — a timed-out lookup or a standalone caller): the ABN's
  // last 9 digits may be an ACN. Good enough to confirm a match, never to reject one.
  const possibleAcn = !resolvedAcn && resolvedAbn && !entityType ? resolvedAbn.slice(2) : '';

  const primaryName = legalName || typedName;
  const seen = new Set([normaliseEntityName(primaryName)]);
  const businessNames = [];
  for (const n of [...(abnResult?.businessNames ?? []), ...(abnResult?.tradingNames ?? [])]) {
    const key = normaliseEntityName(n);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    businessNames.push(n);
  }

  return {
    legalName,
    abn: resolvedAbn,
    acn: resolvedAcn,
    possibleAcn,
    entityType,
    businessNames,
    trustName: parseTrustName(legalName),
    typedName,
  };
}

// When the ABR lookup returned nothing (an outage — DATA_SOURCES_PLAN.md 1.4 — or a timeout), a
// company's legal name and ACN can still come from ASIC's Company Dataset, looked up by ABN.
// Business names still need the ABR, so they stay empty. `company` is asic.js's
// lookupAsicCompany() result; a non-company or no ASIC record leaves the identity unchanged.
function withAsicIdentityFallback(identity, company) {
  if (identity.legalName || !company?.current) return identity;
  const current = company.current;
  const legalName = current['Company Name'] || '';
  return {
    ...identity,
    legalName,
    acn: identity.acn || normaliseDigits(current.ACN),
    possibleAcn: '',
    entityType: identity.entityType || 'Company (from ASIC; ABR unavailable)',
    trustName: parseTrustName(legalName),
    identitySource: 'ASIC Company Dataset (ABR unavailable)',
  };
}

// Scrapers accept either a resolved identity or, for standalone/live-test callers, a plain
// company name plus optional ABN (no ABR record, so no legal name, business names or derived
// ACN — just the typed name and ABN digits).
function asIdentity(identityOrName, abn = '') {
  if (identityOrName && typeof identityOrName === 'object') return identityOrName;
  return resolveEntityIdentity({ companyName: identityOrName || '', abn });
}

// Every name the entity might be registered under, primary first: legal name (or the typed name
// when there's no ABR record), the typed name when it differs (often one of the business names
// anyway — deduped), business names, the trust's own name, then former names when the caller
// has them (`identity.formerNames`, set by the orchestrator — DATA_SOURCES_PLAN.md 2.4).
function entityNames(identity) {
  const out = [];
  const seen = new Set();
  for (const n of [identity.legalName || identity.typedName, identity.typedName, ...identity.businessNames, identity.trustName, ...(identity.formerNames ?? [])]) {
    const key = normaliseEntityName(n);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

// Registers put ABNs in ACN fields and vice versa, so every 9- or 11-digit value a record
// carries is compared against both the ABN and the ACN, whichever field it came from.
// `comparable` is false when the record has no value of a kind the identity also has (e.g. a
// trust identity with only an ABN, against a record carrying only its trustee company's ACN) —
// then a mismatch says nothing and the record falls back to name matching instead of being
// rejected.
function compareIdentifiers(recordValues, identity) {
  let comparable = false;
  for (const raw of recordValues || []) {
    const d = normaliseDigits(raw);
    if (d.length === 11) {
      if (identity.abn && d === identity.abn) return { matched: 'ABN', comparable: true };
      if (identity.acn && d.slice(2) === identity.acn) return { matched: 'ABN', comparable: true };
      if (identity.abn) comparable = true;
    } else if (d.length === 9) {
      if (identity.acn && d === identity.acn) return { matched: 'ACN', comparable: true };
      if (identity.possibleAcn && d === identity.possibleAcn) return { matched: 'ACN', comparable: true };
      if (identity.acn) comparable = true;
    }
  }
  return { matched: null, comparable };
}

function identifiersMatch(recordValues, identity) {
  return compareIdentifiers(recordValues, identity).matched !== null;
}

// `record` is { identifiers: [...raw values], names: [...names on the record] }. `nameMatchers`
// is makeNameMatcher() over entityNames(identity), built once per search by the caller.
// Returns { match: 'confirmed' | 'rejected' | 'name-only' | null, matchedBy } — null means the
// record has nothing to do with this entity (usually free-text search noise).
function classifyMatch(record, identity, nameMatchers) {
  const ids = compareIdentifiers(record.identifiers, identity);
  if (ids.matched) return { match: 'confirmed', matchedBy: ids.matched };
  const nameHit = (record.names || []).some((n) => n && nameMatchers.some((m) => m(n)));
  if (!nameHit) return { match: null, matchedBy: null };
  if (ids.comparable) return { match: 'rejected', matchedBy: null };
  return { match: 'name-only', matchedBy: NAME_ONLY };
}

const NAME_ONLY = 'Name only — verify';

// Who each search name belongs to (LICENCE_MATCHING_PLAN.md 3.1/3.3), keyed by searchableName()
// — courtRecords.js strips company suffixes from its terms, so keys are compared the same way.
// Priority: the entity's own names, then typed people, then people from confirmed licences, then
// people from name-only licences, then linked companies.
function buildTermProvenance({ companyName, identity, typedPeople = [], discoveredPeople = [], linkedCompanies = [], formerNames = [] }) {
  const map = new Map();
  const set = (name, info) => {
    const key = searchableName(name);
    if (key && !map.has(key)) map.set(key, info);
  };
  for (const n of [companyName, identity.legalName, ...identity.businessNames, identity.trustName, ...formerNames]) set(n, { kind: 'entity' });
  for (const n of typedPeople) set(n, { kind: 'person', confidence: 'typed' });
  for (const p of discoveredPeople) if (p.confidence !== 'name-only') set(p.name, { kind: 'person', confidence: 'confirmed' });
  for (const p of discoveredPeople) set(p.name, { kind: 'person', confidence: 'name-only', name: p.name });
  for (const c of linkedCompanies) set(c.name, { kind: 'linked', company: c });
  return map;
}

// Labels each court/FWO/ASIC EU result by the name that found it (`matchedTerm`, set by those
// scrapers): `FoundBySearching` always; a linked company's hit carries `LinkedCompany` and
// `Linked company — via <person>` (confirmed link) or `Name only — verify`; a hit found only
// under a person discovered from a name-only licence is `Name only — verify`. The report's
// riskGrouper keys off these: verify-only hits never drive a finding, and linked-company hits
// raise a separate "associated company" finding instead.
function labelResultsByTerm(result, provenance) {
  if (!Array.isArray(result?.results) || !result.results.some((r) => r.matchedTerm)) return result;
  return {
    ...result,
    results: result.results.map((item) => {
      if (!item.matchedTerm) return item;
      const info = provenance.get(searchableName(item.matchedTerm));
      const metadata = { ...(item.metadata ?? {}), FoundBySearching: item.matchedTerm };
      if (info?.kind === 'linked') {
        const confirmed = info.company.confidence === 'confirmed';
        metadata.MatchedBy = confirmed ? `Linked company — via ${info.company.person}` : NAME_ONLY;
        metadata.LinkedCompany = info.company.name;
        metadata.LinkedVia = info.company.via;
      } else if (info?.kind === 'person' && info.confidence === 'name-only') {
        metadata.MatchedBy = NAME_ONLY;
        metadata.LinkedVia = `${info.name} — found on a licence matched by name only`;
      }
      return { ...item, metadata };
    }),
  };
}

// Summary wording shared by the licence registers (LICENCE_MATCHING_PLAN.md 3.2). A clean result
// says what was searched — "linked to this ABN" only when there was an ABN — and is never worded
// as a pass. A found result says how many are name-only matches to verify.
function licenceSummary(results, identity, { found, none }) {
  if (results.length > 0) {
    const verify = results.filter((r) => r.metadata?.MatchedBy === NAME_ONLY).length;
    return `${results.length} ${found} found${verify > 0 ? ` (${verify} matched by name only — verify)` : ''}`;
  }
  if (identity.abn) return `No ${none} linked to this ABN found (searched by ABN, ACN and name)`;
  return `No ${none} found under this name`;
}

module.exports = {
  BUSINESS_NAME_CAP,
  COURT_FWO_BUSINESS_NAME_CAP,
  LINKED_COMPANY_CAP,
  FORMER_NAME_CAP,
  NAME_ONLY,
  buildTermProvenance,
  labelResultsByTerm,
  licenceSummary,
  normaliseDigits,
  normaliseEntityName,
  searchableName,
  significantWords,
  makeNameMatcher,
  parseTrustName,
  resolveEntityIdentity,
  withAsicIdentityFallback,
  isKnownNonCompany,
  asIdentity,
  entityNames,
  identifiersMatch,
  classifyMatch,
};
