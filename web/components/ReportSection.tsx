'use client';

import { useState } from 'react';
import { SearchResult, ResultItem } from '@/src/types';
import { ResultCard } from './ResultCard';
import { RiskBadge, RiskLevel } from './RiskBadge';
import { trackEvent } from '@/lib/analytics';

interface Props {
  id: string;
  title: string;
  icon: string;
  searchResults: SearchResult[];
  riskLevel?: RiskLevel;
  isLinkSection?: boolean;
  /** Overrides the results derived from searchResults[].results */
  resultsOverride?: ResultItem[];
  /** Show jurisdiction badge on each ResultCard */
  showJurisdiction?: boolean;
  /** Red critical banner shown at the top of the section body */
  criticalBanner?: string;
}

export function ReportSection({
  id,
  title,
  icon,
  searchResults,
  riskLevel,
  isLinkSection,
  resultsOverride,
  showJurisdiction,
  criticalBanner,
}: Props) {
  const [open, setOpen] = useState(true);

  const allResults: ResultItem[] =
    resultsOverride ?? searchResults.flatMap((sr) => sr.results || []);

  const summaryTexts = searchResults
    .filter((sr) => sr.summary)
    .map((sr) => sr.summary as string);

  const directSources = searchResults
    .filter((sr) => sr.searchUrl)
    .map((sr) => ({ label: sr.source || sr.label, url: sr.searchUrl as string }));

  return (
    <section
      id={id}
      className="bg-surface rounded-2xl border border-border shadow-sm mb-4 overflow-hidden scroll-mt-12"
    >
      {/* Section header — tappable on mobile to collapse */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-5 py-4 bg-primary text-white hover:bg-primary-light transition md:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-inset"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`${id}-body`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span aria-hidden="true" className="text-lg shrink-0">{icon}</span>
          <h2 className="text-sm font-semibold text-left truncate">{title}</h2>
          {allResults.length > 0 && (
            <span className="bg-accent text-primary text-xs font-bold px-2 py-0.5 rounded-full shrink-0">
              {allResults.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          {riskLevel && <RiskBadge level={riskLevel} />}
          <span className="text-white/60 text-xs md:hidden" aria-hidden="true">
            {open ? '▲' : '▼'}
          </span>
        </div>
      </button>

      {/* Section body */}
      <div id={`${id}-body`} className={open ? 'block' : 'hidden md:block'}>
        <div className="p-5">
          {criticalBanner && (
            <div className="bg-danger-bg border border-danger/30 rounded-lg px-4 py-3 mb-4 flex items-start gap-3">
              <span className="text-lg shrink-0" aria-hidden="true">⚠️</span>
              <p className="text-sm font-semibold text-danger">{criticalBanner}</p>
            </div>
          )}
          {summaryTexts.map((s, i) => (
            <p
              key={i}
              className="text-sm text-text-secondary bg-surface-alt rounded-lg px-4 py-3 mb-4"
            >
              {s}
            </p>
          ))}

          {isLinkSection ? (
            <div className="divide-y divide-border-light">
              {allResults.map((item, i) => (
                <a
                  key={i}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${item.title} (opens in new tab)`}
                  onClick={() => trackEvent('partner_link_clicked', { title: item.title, url: item.url })}
                  className="flex items-center justify-between py-3 px-1 gap-3 hover:bg-surface-alt/50 transition group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                >
                  <div className="min-w-0">
                    {item.jurisdiction && (
                      <span className="inline-block bg-info-bg text-info text-xs font-semibold px-2 py-0.5 rounded mb-1">
                        {item.jurisdiction}
                      </span>
                    )}
                    <p className="text-sm font-medium text-primary group-hover:text-primary-light transition truncate">
                      {item.title}
                    </p>
                    {item.description && (
                      <p className="text-xs text-text-muted mt-0.5 line-clamp-1">
                        {item.description}
                      </p>
                    )}
                  </div>
                  <span className="text-primary-light shrink-0" aria-hidden="true">
                    →
                  </span>
                </a>
              ))}
            </div>
          ) : allResults.length > 0 ? (
            allResults.map((item, i) => (
              <ResultCard key={i} item={item} showJurisdiction={showJurisdiction} />
            ))
          ) : (
            <p className="text-sm text-text-muted italic">
              No records found in automated search
            </p>
          )}

          {!isLinkSection && directSources.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border-light">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                Verify directly:
              </p>
              <div className="flex flex-wrap gap-3">
                {directSources.map((src, i) => (
                  <a
                    key={i}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${src.label} (opens in new tab)`}
                    className="text-xs font-semibold text-primary-light hover:text-primary transition"
                  >
                    {src.label} →
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
