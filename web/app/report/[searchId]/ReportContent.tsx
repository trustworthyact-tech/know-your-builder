'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BuilderInput, SearchResult, ResultItem, SearchStatus, RiskGroupResult } from '@/src/types';
import { ReportSection } from '@/components/ReportSection';
import { RiskBadge, RiskLevel } from '@/components/RiskBadge';
import { RiskSummaryPanel } from '@/components/RiskSummaryPanel';
import { ProjectTimeline } from '@/components/ProjectTimeline';
import { riskGrouper } from '@/lib/riskGrouper';

interface Props {
  searchId: string;
  shareToken?: string;
  readOnly?: boolean;
}

const TOC_SECTIONS = [
  { id: 's81', short: '8.1 Identity' },
  { id: 's82', short: '8.2 Licences' },
  { id: 's83', short: '8.3 Financial' },
  { id: 's84', short: '8.4 Payment' },
  { id: 's85', short: '8.5 Enforcement' },
] as const;

function isAllErrored(statuses: SearchStatus[]): boolean {
  return statuses.length > 0 && statuses.every((s) => s === 'error');
}

// Returns the highest risk level triggered by any group with a trigger pointing to sectionAnchor,
// falling back to the baseline when no group applies.
function deriveRiskLevel(
  groups: RiskGroupResult[],
  sectionAnchor: string,
  baseline: RiskLevel
): RiskLevel {
  if (baseline === 'unavailable') return 'unavailable';
  const matching = groups.filter((g) => g.triggers.some((t) => t.anchor === sectionAnchor));
  if (matching.length === 0) return baseline;
  if (matching.some((g) => g.severity === 'significant')) return 'significant';
  return 'findings';
}

function entityInitials(name: string): string {
  return name
    .replace(/\b(PTY|LTD|LIMITED|TRUST|AND|THE)\b/gi, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function ReportContent({ searchId, shareToken, readOnly = false }: Props) {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [input, setInput] = useState<BuilderInput | null>(null);
  const [riskGroups, setRiskGroups] = useState<RiskGroupResult[]>([]);
  const [loadError, setLoadError] = useState('');
  const [reportCreatedAt, setReportCreatedAt] = useState<string | null>(null);
  const [watchlisted, setWatchlisted] = useState(false);
  const [watchlistEnabled, setWatchlistEnabled] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);

  useEffect(() => {
    const fetchUrl = shareToken
      ? `/api/share/${shareToken}`
      : searchId === 'preview'
        ? null
        : `/api/reports/${searchId}`;

    if (!fetchUrl) {
      // Preview path: read from sessionStorage
      try {
        const rawResults = sessionStorage.getItem('kyb_preview_results');
        const rawInput = sessionStorage.getItem('kyb_preview_input');
        if (rawResults && rawInput) {
          const parsed: SearchResult[] = JSON.parse(rawResults);
          setResults(parsed);
          setInput(JSON.parse(rawInput));
          const findingsMap: Record<string, SearchResult> = {};
          for (const r of parsed) findingsMap[r.key] = r;
          setRiskGroups(riskGrouper(findingsMap));
        } else {
          setLoadError('No report data found. Please run a new search.');
        }
      } catch {
        setLoadError('Failed to load report data.');
      }
      return;
    }

    fetch(fetchUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error('Report not found');
        return res.json();
      })
      .then((data) => {
        const findings = data.reportJson as Record<string, SearchResult>;
        setResults(Object.values(findings));
        if (data.createdAt) setReportCreatedAt(data.createdAt);
        setInput({
          companyName: data.entityName ?? '',
          abn: data.entityAbn ?? '',
          acn: '',
          tradingName: '',
          directors: [],
        });
        if (data.riskSummary) {
          try {
            setRiskGroups(JSON.parse(data.riskSummary) as RiskGroupResult[]);
          } catch {
            setRiskGroups(riskGrouper(findings));
          }
        } else {
          setRiskGroups(riskGrouper(findings));
        }
      })
      .catch(() => {
        setLoadError(
          shareToken
            ? 'This report link has expired or is no longer available.'
            : 'Report not found or could not be loaded. Please run a new search.'
        );
      });
  }, [searchId, shareToken]);

  // Check watchlist status once entity ABN is known (authenticated, non-preview, non-readonly)
  useEffect(() => {
    if (!input?.abn || readOnly || searchId === 'preview') return;
    fetch('/api/watchlist')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.items) {
          setWatchlistEnabled(true);
          setWatchlisted(
            data.items.some((i: { entityAbn: string }) => i.entityAbn === input.abn)
          );
        }
      })
      .catch(() => {});
  }, [input?.abn, readOnly, searchId]);

  async function handleWatchlistToggle() {
    if (!input?.abn || watchlistLoading) return;
    setWatchlistLoading(true);
    try {
      if (watchlisted) {
        const res = await fetch('/api/watchlist', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityAbn: input.abn }),
        });
        if (res.ok) setWatchlisted(false);
      } else {
        const res = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entityName,
            entityAbn: input.abn,
            lastSearchId: searchId,
          }),
        });
        if (res.ok || res.status === 201) setWatchlisted(true);
      }
    } catch {
      // Non-critical — silently ignore
    } finally {
      setWatchlistLoading(false);
    }
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <span className="text-4xl mb-4 block" aria-hidden="true">📋</span>
          <p className="text-text-secondary mb-6">{loadError}</p>
          <Link
            href="/"
            className="inline-block bg-primary text-white text-sm font-semibold px-6 py-3 rounded-xl hover:bg-primary-light transition"
          >
            ← New Search
          </Link>
        </div>
      </main>
    );
  }

  if (!results || !input) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div
          className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"
          role="status"
          aria-label="Loading report"
        />
      </main>
    );
  }

  // Helpers
  const byKey = (key: string) => results.find((r) => r.key === key);

  const abn = byKey('abn');
  const asic = byKey('asic');
  const asicDisqualified = byKey('asicDisqualified');
  const asicInsolvency = byKey('asicInsolvency');
  const atoDebt = byKey('atoDebt');
  const qbcc = byKey('qbcc');
  const paymentTimes = byKey('paymentTimes');
  const modernSlavery = byKey('modernSlavery');
  const austliiResults = results.filter((r) => r.key.startsWith('austlii_'));
  const fwo = byKey('fwo');
  const vicBpc = byKey('vicBpc');
  const waBuildingEnergy = byKey('waBuildingEnergy');
  const asicExtract = byKey('asicExtract');
  const afsaNpii = byKey('afsaNpii');
  const links = byKey('links');
  const allLinkItems: ResultItem[] = links?.results ?? [];
  const licenceLinks = allLinkItems.filter((r) => r.category === 'license');
  const fwcLinks = allLinkItems.filter((r) => r.category === 'fwc');
  const enforcementLinks = allLinkItems.filter(
    (r) => r.category !== 'license' && r.category !== 'fwc'
  );

  // Entity card data
  const entityName =
    abn?.results?.[0]?.title || input.companyName || input.abn || '—';
  const initials = entityInitials(entityName) || '?';

  const now = new Date().toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const STALE_DAYS = 30;
  const reportAgeMs = reportCreatedAt ? Date.now() - new Date(reportCreatedAt).getTime() : 0;
  const isStale = reportAgeMs > STALE_DAYS * 24 * 60 * 60 * 1000;
  const reportAgeDays = Math.floor(reportAgeMs / (24 * 60 * 60 * 1000));

  const recheckUrl = (() => {
    const p = new URLSearchParams();
    p.set('companyName', input.companyName || entityName);
    if (input.abn) p.set('abn', input.abn);
    return `/search?${p}`;
  })();

  const deepCheckUrl = (() => {
    const p = new URLSearchParams();
    p.set('companyName', input.companyName || entityName);
    if (input.abn) p.set('abn', input.abn);
    p.set('deepCheck', '1');
    return `/search?${p}`;
  })();

  // Stats
  const totalHits = results
    .filter((r) => r.key !== 'links')
    .reduce((n, r) => n + (r.results?.length ?? 0), 0);
  const courtHits = austliiResults.reduce((n, r) => n + (r.results?.length ?? 0), 0);

  // Per-section result sets
  const asicCompanyItems: ResultItem[] = (asic?.results ?? []).filter(
    (r) => r.metadata?.Role !== 'Director'
  );
  const asicDirectorItems: ResultItem[] = (asic?.results ?? []).filter(
    (r) => r.metadata?.Role === 'Director'
  );
  const disqualifiedItems: ResultItem[] = asicDisqualified?.results ?? [];
  const asicExtractItems: ResultItem[] = asicExtract?.results ?? [];
  const identityItems: ResultItem[] = [
    ...(abn?.results ?? []),
    ...asicCompanyItems,
    ...asicDirectorItems,
    ...disqualifiedItems,
    ...asicExtractItems,
  ];
  const licenceItems: ResultItem[] = qbcc?.licenceResults ?? [];
  const adjItems: ResultItem[] = qbcc?.adjudicationResults ?? [];
  const insolvencyItems: ResultItem[] = asicInsolvency?.results ?? [];
  const atoDebtItems: ResultItem[] = atoDebt?.results ?? [];
  const afsaNpiiItems: ResultItem[] = afsaNpii?.results ?? [];
  const financialItems: ResultItem[] = [
    ...insolvencyItems,
    ...atoDebtItems,
    ...afsaNpiiItems,
    ...(paymentTimes?.results ?? []),
    ...(modernSlavery?.results ?? []),
  ];
  const fwoItems: ResultItem[] = fwo?.results ?? [];
  const vicBpcItems: ResultItem[] = vicBpc?.results ?? [];
  const waBuildingEnergyItems: ResultItem[] = waBuildingEnergy?.results ?? [];
  const courtItems: ResultItem[] = [
    ...austliiResults.flatMap((r) => r.results ?? []),
    ...fwoItems,
    ...vicBpcItems,
    ...waBuildingEnergyItems,
  ];

  // Section risk levels — derived from risk groups, falling back to scraper-status baseline
  const s81Risk = deriveRiskLevel(
    riskGroups,
    '#s81',
    isAllErrored([
      abn?.status ?? 'done',
      asic?.status ?? 'done',
      asicDisqualified?.status ?? 'done',
      ...(asicExtract ? [asicExtract.status] : []),
    ])
      ? 'unavailable'
      : 'clear'
  );
  const s82Risk = deriveRiskLevel(
    riskGroups,
    '#s82',
    isAllErrored([qbcc?.status ?? 'done']) ? 'unavailable' : 'clear'
  );
  const s83Risk = deriveRiskLevel(
    riskGroups,
    '#s83',
    isAllErrored([
      asicInsolvency?.status ?? 'done',
      atoDebt?.status ?? 'done',
      paymentTimes?.status ?? 'done',
      modernSlavery?.status ?? 'done',
      ...(afsaNpii ? [afsaNpii.status] : []),
    ])
      ? 'unavailable'
      : 'clear'
  );
  const s84Risk = deriveRiskLevel(
    riskGroups,
    '#s84',
    isAllErrored([qbcc?.status ?? 'done']) ? 'unavailable' : 'clear'
  );
  const s85Risk = deriveRiskLevel(
    riskGroups,
    '#s85',
    isAllErrored([
      ...austliiResults.map((r) => r.status),
      fwo?.status ?? 'done',
      vicBpc?.status ?? 'done',
      waBuildingEnergy?.status ?? 'done',
    ])
      ? 'unavailable'
      : 'clear'
  );

  // Synthetic SearchResult objects for sections that split one source across sections
  const licenceSearch: SearchResult = {
    key: 'qbcc_licence',
    label: 'QBCC Licence Register',
    status: qbcc?.status ?? 'done',
    source: 'QBCC — Queensland Building & Construction Commission',
    jurisdiction: 'QLD',
    category: 'license',
    searchUrl: qbcc?.searchUrl,
    summary:
      licenceItems.length > 0
        ? `${licenceItems.length} licence record(s) found`
        : 'No QBCC licence records found',
  };

  const adjSearch: SearchResult = {
    key: 'qbcc_adjudication',
    label: 'QBCC Adjudication Decisions',
    status: qbcc?.status ?? 'done',
    source: 'QBCC — Adjudication Decisions',
    jurisdiction: 'QLD',
    category: 'payment',
    searchUrl: qbcc?.adjudicationSearchUrl,
    summary:
      adjItems.length > 0
        ? `${adjItems.length} adjudication decision(s) found`
        : 'No QBCC adjudication decisions found',
  };

  const courtJurisdictionsFound = austliiResults.filter(
    (r) => (r.results?.length ?? 0) > 0
  ).length;
  const courtSearch: SearchResult = {
    key: 'austlii',
    label: 'Australian Courts & Tribunals (AustLII)',
    status: austliiResults.some((r) => r.status === 'done') ? 'done' : 'error',
    source: 'AustLII — Australasian Legal Information Institute',
    searchUrl: `https://www.austlii.edu.au`,
    summary:
      courtHits > 0
        ? `${courtHits} decision(s) found across ${courtJurisdictionsFound} jurisdiction(s)`
        : 'No court or tribunal decisions found',
  };

  const fwoSearch: SearchResult = {
    key: 'fwo',
    label: 'Fair Work Ombudsman — Enforcement Outcomes',
    status: fwo?.status ?? 'done',
    source: 'Fair Work Ombudsman',
    jurisdiction: 'Federal',
    category: 'payment',
    searchUrl: fwo?.searchUrl,
    summary: fwo?.summary ?? 'No Fair Work Ombudsman enforcement outcomes found',
  };

  const vicBpcSearch: SearchResult = {
    key: 'vicBpc',
    label: 'VIC Building Authority — Disciplinary Register',
    status: vicBpc?.status ?? 'done',
    source: 'Victorian Building Authority',
    jurisdiction: 'VIC',
    category: 'regulatory',
    searchUrl: vicBpc?.searchUrl,
    summary: vicBpc?.summary ?? 'No VBA disciplinary proceedings found',
  };

  const waBuildingEnergySearch: SearchResult = {
    key: 'waBuildingEnergy',
    label: 'WA Building and Energy — Enforcement',
    status: waBuildingEnergy?.status ?? 'done',
    source: 'WA Building and Energy',
    jurisdiction: 'WA',
    category: 'regulatory',
    searchUrl: waBuildingEnergy?.searchUrl,
    summary: waBuildingEnergy?.summary ?? 'No WA Building and Energy enforcement actions found',
  };

  // Deep check synthetic sources — only included when present in results
  const asicExtractSearch: SearchResult | null = asicExtract
    ? {
        key: 'asicExtract',
        label: 'ASIC — Director Company History',
        status: asicExtract.status,
        source: 'ASIC Connect — Officer Search',
        jurisdiction: 'Federal',
        category: 'identity',
        searchUrl: asicExtract.searchUrl,
        summary: asicExtract.summary,
      }
    : null;

  const afsaNpiiSearch: SearchResult | null = afsaNpii
    ? {
        key: 'afsaNpii',
        label: 'AFSA NPII — Director Personal Insolvency (Deep Check)',
        status: afsaNpii.status,
        source: 'AFSA — National Personal Insolvency Index (Deep Check)',
        jurisdiction: 'Federal',
        category: 'financial',
        searchUrl: afsaNpii.searchUrl,
        summary: afsaNpii.summary,
      }
    : null;

  return (
    <main className="min-h-screen bg-background">
      {/* Sticky table of contents */}
      <nav
        className="sticky top-0 z-20 bg-primary shadow-md"
        aria-label="Report sections"
      >
        <div className="max-w-4xl mx-auto px-4 py-2 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max">
            {readOnly ? (
              <span className="text-white/60 text-xs font-semibold py-1.5 px-2 shrink-0 border border-white/20 rounded">
                Shared report
              </span>
            ) : (
              <Link
                href="/"
                className="text-white/70 hover:text-white text-xs font-semibold py-1.5 px-2 rounded transition shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-primary"
              >
                ← New search
              </Link>
            )}
            <span className="text-white/30 text-xs px-1" aria-hidden="true">|</span>
            {TOC_SECTIONS.map(({ id, short }) => (
              <a
                key={id}
                href={`#${id}`}
                className="text-white/80 hover:text-white text-xs font-medium py-1.5 px-2 rounded hover:bg-white/10 transition whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-primary"
              >
                {short}
              </a>
            ))}
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {isStale && !readOnly && searchId !== 'preview' && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-warning-bg border border-warning/30 rounded-xl px-4 py-3 mb-5">
            <p className="flex-1 text-sm text-warning font-medium">
              This report is {reportAgeDays} day{reportAgeDays !== 1 ? 's' : ''} old — a lot can change.
            </p>
            <div className="flex items-center gap-3 shrink-0">
              <Link
                href={recheckUrl}
                className="text-xs font-semibold text-warning border border-warning/40 rounded-lg px-3 py-1.5 hover:bg-warning/10 transition-colors"
              >
                Re-run $3
              </Link>
              <Link
                href={deepCheckUrl}
                className="text-xs font-semibold text-white bg-warning rounded-lg px-3 py-1.5 hover:opacity-90 transition-opacity"
              >
                Deep check $15
              </Link>
            </div>
          </div>
        )}

        {/* Entity card */}
        <div className="bg-surface rounded-2xl border border-border shadow-sm p-5 mb-6">
          <div className="flex items-start gap-4 mb-5">
            <div
              className="w-14 h-14 rounded-full bg-primary flex items-center justify-center shrink-0 shadow"
              aria-hidden="true"
            >
              <span className="text-white font-extrabold text-lg tracking-tight">
                {initials}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-primary leading-tight">{entityName}</h1>
              <div className="flex flex-wrap gap-2 mt-2">
                {input.abn && (
                  <span className="text-xs text-text-secondary bg-surface-alt rounded px-2 py-0.5">
                    ABN {input.abn}
                  </span>
                )}
                {input.acn && (
                  <span className="text-xs text-text-secondary bg-surface-alt rounded px-2 py-0.5">
                    ACN {input.acn}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center divide-x divide-border-light border-t border-border-light pt-4">
            <div className="flex-1 text-center px-3">
              <p className="text-2xl font-bold text-primary">{totalHits}</p>
              <p className="text-xs text-text-muted mt-0.5">Records found</p>
            </div>
            <div className="flex-1 text-center px-3">
              <p className="text-2xl font-bold text-primary">{courtHits}</p>
              <p className="text-xs text-text-muted mt-0.5">Court/tribunal</p>
            </div>
            <div className="flex-1 text-center px-3">
              <p className="text-xs text-text-muted mb-1">Risk indicator</p>
              <RiskBadge level={s85Risk} />
            </div>
          </div>

          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-text-muted">Report generated {now}</p>
            {watchlistEnabled && (
              <button
                onClick={handleWatchlistToggle}
                disabled={watchlistLoading}
                className={`text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  watchlisted
                    ? 'text-primary bg-primary/10 hover:bg-primary/20'
                    : 'text-text-secondary border border-border-light hover:bg-surface-alt'
                }`}
              >
                {watchlistLoading ? '…' : watchlisted ? '★ On watchlist' : '☆ Add to watchlist'}
              </button>
            )}
          </div>
        </div>

        {/* Risk Summary panel */}
        <RiskSummaryPanel groups={riskGroups} />

        {/* 8.1 Identity & Corporate Structure */}
        <ReportSection
          id="s81"
          title="8.1 Identity & Corporate Structure"
          icon="🏢"
          searchResults={[abn, asic, asicDisqualified, asicExtractSearch].filter(Boolean) as SearchResult[]}
          riskLevel={s81Risk}
          resultsOverride={identityItems}
          criticalBanner={
            disqualifiedItems.length > 0
              ? `${disqualifiedItems.length} director(s) found on the ASIC Disqualified Persons Register. These individuals are legally prohibited from managing corporations.`
              : undefined
          }
        />

        {/* 8.2 Licences & Registrations */}
        <ReportSection
          id="s82"
          title="8.2 Licences & Registrations"
          icon="🏗"
          searchResults={qbcc ? [licenceSearch] : []}
          riskLevel={s82Risk}
          resultsOverride={licenceItems}
          supplementalLinks={licenceLinks}
        />

        {/* 8.3 Financial Risk Signals */}
        <ReportSection
          id="s83"
          title="8.3 Financial Risk Signals"
          icon="💳"
          searchResults={[asicInsolvency, atoDebt, afsaNpiiSearch, paymentTimes, modernSlavery].filter(Boolean) as SearchResult[]}
          riskLevel={s83Risk}
          resultsOverride={financialItems}
          supplementalLinks={fwcLinks}
          criticalBanner={
            insolvencyItems.length > 0
              ? (() => {
                  const entityNames = [...new Set(insolvencyItems.map((r) => r.metadata?.Entity).filter(Boolean))];
                  const entityStr = entityNames.length > 0 ? ` relating to ${entityNames.join(', ')}` : '';
                  return `${insolvencyItems.length} ASIC insolvency notice(s) found${entityStr}. This entity may be subject to external administration, winding up, or liquidation proceedings. Verify current status before proceeding.`;
                })()
              : atoDebtItems.length > 0
              ? `${atoDebtItems.length} ATO tax debt notice(s) found. The Australian Taxation Office has published a listed tax debt for this entity with ASIC.`
              : undefined
          }
        />

        {/* 8.4 Payment & Subcontractor Disputes */}
        <ReportSection
          id="s84"
          title="8.4 Payment & Subcontractor Disputes"
          icon="📋"
          searchResults={qbcc ? [adjSearch] : []}
          riskLevel={s84Risk}
          resultsOverride={adjItems}
        />

        {/* 8.5 Courts, Enforcement & Disciplinary */}
        <ReportSection
          id="s85"
          title="8.5 Courts, Enforcement & Disciplinary"
          icon="⚖️"
          searchResults={[courtSearch, fwoSearch, vicBpcSearch, waBuildingEnergySearch]}
          riskLevel={s85Risk}
          resultsOverride={courtItems}
          showJurisdiction
          supplementalLinks={enforcementLinks}
        />

        {/* Disclaimer */}
        <div className="mt-6 bg-surface-alt rounded-xl border-l-4 border-border px-5 py-4">
          <p className="text-xs font-semibold text-text-secondary mb-2">Important Notice</p>
          <p className="text-xs text-text-muted leading-relaxed mb-2">
            This report is based on publicly available information sourced automatically from
            government databases. It is provided for informational purposes only and does not
            constitute legal, financial or professional advice. The absence of records does not
            guarantee a clean history. You should independently verify all material information
            before making any commercial decision.
          </p>
          <p className="text-xs text-text-muted leading-relaxed">
            Sources: ABR, ASIC Connect, AustLII, Payment Times Reporting Register, Modern Slavery
            Register, QBCC, and linked government databases. Generated {now}.
          </p>
        </div>

        {/* About Your Project — project timeline panel */}
        <div className="mt-4">
          <ProjectTimeline searchId={searchId} readOnly={readOnly} />
        </div>
      </div>
    </main>
  );
}
