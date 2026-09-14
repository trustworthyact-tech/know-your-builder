'use client';

import { useState } from 'react';
import { SearchResult, ResultItem } from '@/src/types';
import { ResultCard } from './ResultCard';
import { RiskBadge, RiskLevel } from './RiskBadge';
import { CompletenessBadge, worstCompleteness } from './CompletenessBadge';
import { trackEvent } from '@/lib/analytics';

function formatAsOf(asOf?: string): string | null {
  if (!asOf) return null;
  const d = new Date(asOf);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

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
  /** Additional manual-check databases appended below automated results */
  supplementalLinks?: ResultItem[];
  /** When true, "Verify directly" links are only shown for sources that returned results */
  linksRequireResults?: boolean;
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
  supplementalLinks,
  linksRequireResults = false,
}: Props) {
  const [open, setOpen] = useState(true);

  const allResults: ResultItem[] =
    resultsOverride ?? searchResults.flatMap((sr) => sr.results || []);

  // WS0.5 (reliability plan) — each summary line keeps its own source result's
  // completeness/asOf, so a partial/stale/unavailable check reads differently from a
  // normal "checked, found nothing" summary rather than blending in with it.
  const summaries = searchResults
    .filter((sr) => sr.summary)
    .map((sr) => ({ text: sr.summary as string, completeness: sr.completeness, asOf: sr.asOf }));

  // Section-level badge — the worst completeness across every contributing result,
  // shown next to RiskBadge. Suppressed when riskLevel is already 'unavailable': that
  // badge already means "every check in this section failed," so a second badge saying
  // much the same thing would be redundant, not additive.
  const sectionCompleteness =
    riskLevel === 'unavailable' ? null : worstCompleteness(searchResults.map((sr) => sr.completeness));

  const directSources = searchResults
    .filter((sr) => sr.searchUrl && (!linksRequireResults || (sr.results?.length ?? 0) > 0))
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
          {sectionCompleteness && <CompletenessBadge level={sectionCompleteness} />}
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
          {summaries.map(({ text, completeness, asOf }, i) => {
            const isCaveat = completeness === 'partial' || completeness === 'stale' || completeness === 'unavailable';
            const asOfLabel = completeness === 'stale' ? formatAsOf(asOf) : null;
            return (
              <p
                key={i}
                className={`text-sm rounded-lg px-4 py-3 mb-4 ${
                  isCaveat ? 'text-info bg-info-bg' : 'text-text-secondary bg-surface-alt'
                }`}
              >
                {text}
                {asOfLabel && <span className="block text-xs mt-1 opacity-80">Cached data as of {asOfLabel}</span>}
              </p>
            );
          })}

          {isLinkSection ? (
            <div className="divide-y divide-border-light">
              {allResults.map((item, i) => (
                <a
                  key={i}
                  href={item.url}
                  aria-label={item.title}
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

          {!isLinkSection && supplementalLinks && supplementalLinks.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border-light">
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                Check manually:
              </p>
              <div className="divide-y divide-border-light">
                {supplementalLinks.map((item, i) => (
                  <a
                    key={i}
                    href={item.url}
                    aria-label={item.title}
                    onClick={() => trackEvent('partner_link_clicked', { title: item.title, url: item.url })}
                    className="flex items-center justify-between py-2.5 px-1 gap-3 hover:bg-surface-alt/50 transition group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
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
                    <span className="text-primary-light shrink-0" aria-hidden="true">→</span>
                  </a>
                ))}
              </div>
            </div>
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
                    aria-label={src.label}
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
