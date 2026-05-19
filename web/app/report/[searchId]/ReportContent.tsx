'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BuilderInput, SearchResult, ResultItem, SearchStatus } from '@/src/types';
import { ReportSection } from '@/components/ReportSection';
import { RiskBadge, RiskLevel } from '@/components/RiskBadge';

interface Props {
  searchId: string;
}

const TOC_SECTIONS = [
  { id: 's81', short: '8.1 Identity' },
  { id: 's82', short: '8.2 Licences' },
  { id: 's83', short: '8.3 Financial' },
  { id: 's84', short: '8.4 Payment' },
  { id: 's85', short: '8.5 Courts' },
  { id: 's86', short: '8.6 Manual Review' },
] as const;

function sectionRisk(items: ResultItem[], statuses: SearchStatus[]): RiskLevel {
  if (statuses.length > 0 && statuses.every((s) => s === 'error')) return 'unavailable';
  return items.length > 0 ? 'findings' : 'clear';
}

function courtRisk(items: ResultItem[], statuses: SearchStatus[]): RiskLevel {
  if (statuses.length > 0 && statuses.every((s) => s === 'error')) return 'unavailable';
  if (items.length >= 6) return 'significant';
  return items.length > 0 ? 'findings' : 'clear';
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

export function ReportContent({ searchId }: Props) {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [input, setInput] = useState<BuilderInput | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (searchId === 'preview') {
      try {
        const rawResults = sessionStorage.getItem('kyb_preview_results');
        const rawInput = sessionStorage.getItem('kyb_preview_input');
        if (rawResults && rawInput) {
          setResults(JSON.parse(rawResults));
          setInput(JSON.parse(rawInput));
        } else {
          setLoadError('No report data found. Please run a new search.');
        }
      } catch {
        setLoadError('Failed to load report data.');
      }
    } else {
      fetch(`/api/reports/${searchId}`)
        .then(async (res) => {
          if (!res.ok) throw new Error('Report not found');
          return res.json();
        })
        .then((data) => {
          const findings = data.reportJson as Record<string, SearchResult>;
          setResults(Object.values(findings));
          setInput({
            companyName: data.entityName ?? '',
            abn: data.entityAbn ?? '',
            acn: '',
            tradingName: '',
            directors: [],
          });
        })
        .catch(() => {
          setLoadError('Report not found or could not be loaded. Please run a new search.');
        });
    }
  }, [searchId]);

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
  const qbcc = byKey('qbcc');
  const paymentTimes = byKey('paymentTimes');
  const modernSlavery = byKey('modernSlavery');
  const austliiResults = results.filter((r) => r.key.startsWith('austlii_'));
  const links = byKey('links');

  // Entity card data
  const entityName =
    abn?.results?.[0]?.title || input.companyName || input.abn || '—';
  const initials = entityInitials(entityName) || '?';

  const now = new Date().toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  // Stats
  const nonLinkResults = results.filter((r) => r.key !== 'links');
  const totalHits = nonLinkResults.reduce((n, r) => n + (r.results?.length ?? 0), 0);
  const courtHits = austliiResults.reduce((n, r) => n + (r.results?.length ?? 0), 0);

  // Per-section result sets
  const identityItems: ResultItem[] = abn?.results ?? [];
  const licenceItems: ResultItem[] = qbcc?.licenceResults ?? [];
  const adjItems: ResultItem[] = qbcc?.adjudicationResults ?? [];
  const financialItems: ResultItem[] = [
    ...(paymentTimes?.results ?? []),
    ...(modernSlavery?.results ?? []),
  ];
  const courtItems: ResultItem[] = austliiResults.flatMap((r) => r.results ?? []);
  const linkItems: ResultItem[] = links?.results ?? [];

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

  return (
    <main className="min-h-screen bg-background">
      {/* Sticky table of contents */}
      <nav
        className="sticky top-0 z-20 bg-primary shadow-md"
        aria-label="Report sections"
      >
        <div className="max-w-4xl mx-auto px-4 py-2 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max">
            <Link
              href="/"
              className="text-white/70 hover:text-white text-xs font-semibold py-1.5 px-2 rounded transition shrink-0"
            >
              ← New search
            </Link>
            <span className="text-white/30 text-xs px-1" aria-hidden="true">|</span>
            {TOC_SECTIONS.map(({ id, short }) => (
              <a
                key={id}
                href={`#${id}`}
                className="text-white/80 hover:text-white text-xs font-medium py-1.5 px-2 rounded hover:bg-white/10 transition whitespace-nowrap"
              >
                {short}
              </a>
            ))}
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-6">
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
              <RiskBadge level={courtRisk(courtItems, austliiResults.map((r) => r.status))} />
            </div>
          </div>

          <p className="text-xs text-text-muted text-center mt-3">
            Report generated {now}
          </p>
        </div>

        {/* 8.1 Identity & Corporate Structure */}
        <ReportSection
          id="s81"
          title="8.1 Identity & Corporate Structure"
          icon="🏢"
          searchResults={abn ? [abn] : []}
          riskLevel={sectionRisk(identityItems, [abn?.status ?? 'done'])}
          resultsOverride={identityItems}
        />

        {/* 8.2 Licences & Registrations */}
        <ReportSection
          id="s82"
          title="8.2 Licences & Registrations"
          icon="🏗"
          searchResults={qbcc ? [licenceSearch] : []}
          riskLevel={sectionRisk(licenceItems, [qbcc?.status ?? 'done'])}
          resultsOverride={licenceItems}
        />

        {/* 8.3 Financial Risk Signals */}
        <ReportSection
          id="s83"
          title="8.3 Financial Risk Signals"
          icon="💳"
          searchResults={[paymentTimes, modernSlavery].filter(Boolean) as SearchResult[]}
          riskLevel={sectionRisk(financialItems, [
            paymentTimes?.status ?? 'done',
            modernSlavery?.status ?? 'done',
          ])}
          resultsOverride={financialItems}
        />

        {/* 8.4 Payment & Subcontractor Disputes */}
        <ReportSection
          id="s84"
          title="8.4 Payment & Subcontractor Disputes"
          icon="📋"
          searchResults={qbcc ? [adjSearch] : []}
          riskLevel={sectionRisk(adjItems, [qbcc?.status ?? 'done'])}
          resultsOverride={adjItems}
        />

        {/* 8.5 Courts & Legal Proceedings */}
        <ReportSection
          id="s85"
          title="8.5 Courts & Legal Proceedings"
          icon="⚖️"
          searchResults={[courtSearch]}
          riskLevel={courtRisk(courtItems, austliiResults.map((r) => r.status))}
          resultsOverride={courtItems}
          showJurisdiction
        />

        {/* 8.6 Additional Databases — Manual Review */}
        <ReportSection
          id="s86"
          title="8.6 Additional Databases — Manual Review"
          icon="🔗"
          searchResults={links ? [links] : []}
          riskLevel="unavailable"
          isLinkSection
          resultsOverride={linkItems}
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
            Sources: ABR, AustLII, Payment Times Reporting Register, Modern Slavery Register,
            QBCC, and linked government databases. Generated {now}.
          </p>
        </div>
      </div>
    </main>
  );
}
