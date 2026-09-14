'use client';

import { RiskGroupResult, SearchResult } from '@/src/types';

interface Props {
  groups: RiskGroupResult[];
  searchResults: SearchResult[];
}

// WS0.5 (reliability plan) — this panel's "No significant findings" banner is the single
// most prominent, first-read element of the report, and the one place the plan's own
// framing ("a falsely-clean report is worse than an honest 'could not check'") matters
// most: a report with several unavailable/partial checks and zero triggers would
// otherwise show the exact same confident green checkmark as a report that was genuinely
// fully verified. This computes an honest count so that distinction is visible here, not
// just on the individual section badges further down the page.
function countIncomplete(searchResults: SearchResult[]): number {
  return searchResults.filter(
    (sr) => sr.completeness === 'partial' || sr.completeness === 'stale' || sr.completeness === 'unavailable'
  ).length;
}

const SEVERITY_CONFIG = {
  significant: {
    badge: 'bg-danger-bg text-danger border-danger/30',
    label: 'Significant finding',
    icon: '✗',
    headerBg: 'bg-danger-bg border-l-4 border-danger',
  },
  findings: {
    badge: 'bg-warning-bg text-warning border-warning/30',
    label: 'Findings — review recommended',
    icon: '⚠',
    headerBg: 'bg-warning-bg border-l-4 border-warning',
  },
} as const;

export function RiskSummaryPanel({ groups, searchResults }: Props) {
  const incompleteCount = countIncomplete(searchResults);

  if (groups.length === 0) {
    return (
      <div className="bg-surface rounded-2xl border border-border shadow-sm p-5 mb-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xl shrink-0" aria-hidden="true">🛡</span>
          <h2 className="text-base font-bold text-primary">Risk Summary</h2>
        </div>
        <div className="flex items-center gap-3 bg-success-bg rounded-xl px-4 py-3 border border-success/30">
          <span className="text-success font-bold text-lg shrink-0" aria-hidden="true">✓</span>
          <p className="text-sm font-semibold text-success">
            No significant findings — automated checks returned no material risk signals.
          </p>
        </div>
        {incompleteCount > 0 && (
          <div className="flex items-center gap-3 bg-info-bg rounded-xl px-4 py-3 border border-info/30 mt-3">
            <span className="text-info font-bold text-lg shrink-0" aria-hidden="true">◐</span>
            <p className="text-sm text-info">
              {incompleteCount} check{incompleteCount !== 1 ? 's' : ''} could not be fully completed — this is
              not confirmation those areas are clear, only that nothing was found in what could be checked. See
              the coverage badges in the sections below for which ones.
            </p>
          </div>
        )}
        <p className="text-xs text-text-muted mt-3 leading-relaxed">
          Review the sections below and the additional databases listed in section 8.6 before making any final decision.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-2xl border border-border shadow-sm p-5 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xl shrink-0" aria-hidden="true">⚠️</span>
        <h2 className="text-base font-bold text-primary">Risk Summary</h2>
        <span className="ml-auto text-xs text-text-muted shrink-0">
          {groups.length} risk area{groups.length !== 1 ? 's' : ''} flagged
        </span>
      </div>

      {incompleteCount > 0 && (
        <div className="flex items-center gap-3 bg-info-bg rounded-xl px-4 py-3 border border-info/30 mb-4">
          <span className="text-info font-bold text-lg shrink-0" aria-hidden="true">◐</span>
          <p className="text-xs text-info">
            {incompleteCount} other check{incompleteCount !== 1 ? 's' : ''} could not be fully completed —
            see the coverage badges in the sections below for which ones.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {groups.map((group) => {
          const cfg = SEVERITY_CONFIG[group.severity];
          return (
            <div
              key={group.id}
              className="rounded-xl overflow-hidden border border-border"
            >
              <div className={`px-4 py-3 ${cfg.headerBg}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-sm font-bold text-text-primary">{group.label}</p>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border shrink-0 ${cfg.badge}`}
                    aria-label={`Severity: ${cfg.label}`}
                  >
                    <span aria-hidden="true">{cfg.icon}</span>
                    {cfg.label}
                  </span>
                </div>
              </div>

              <div className="px-4 py-3 bg-surface">
                <p className="text-xs text-text-secondary leading-relaxed mb-3">
                  {group.description}
                </p>
                <ul className="space-y-1.5" aria-label={`Evidence for ${group.label}`}>
                  {group.triggers.map((trigger, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-text-muted mt-0.5 shrink-0" aria-hidden="true">→</span>
                      <a
                        href={trigger.anchor}
                        className="text-xs text-primary-light hover:text-primary font-medium hover:underline transition"
                      >
                        {trigger.finding}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-text-muted mt-4 leading-relaxed">
        Each finding above links to the relevant report section. Review all source material and consult a professional before making any commercial decision based on this report.
      </p>
    </div>
  );
}
