'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RiskBadge, RiskLevel } from '@/components/RiskBadge';
import { RiskGroupResult } from '@/src/types';

export interface SearchSummary {
  id: string;
  entityName: string;
  entityAbn: string | null;
  persona: string | null;
  projectType: string | null;
  projectState: string | null;
  isDeepCheck: boolean;
  riskSummary: string | null;
  createdAt: string;
}

function getRiskLevel(riskSummary: string | null): RiskLevel {
  if (!riskSummary) return 'unavailable';
  try {
    const groups: RiskGroupResult[] = JSON.parse(riskSummary);
    // riskGrouper only pushes groups that have triggers, so all items are triggered
    if (groups.some((g) => g.severity === 'significant')) return 'significant';
    if (groups.length > 0) return 'findings';
    return 'clear';
  } catch {
    return 'unavailable';
  }
}

const PERSONA_LABELS: Record<string, string> = {
  HOMEOWNER: 'Homeowner',
  SUBCONTRACTOR: 'Subcontractor',
  DEVELOPER: 'Developer',
  LENDER: 'Lender',
};

const PROJECT_TYPE_LABELS: Record<string, string> = {
  new_build: 'New build',
  renovation: 'Renovation',
  commercial: 'Commercial',
  subdivision: 'Subdivision',
  other: 'Other',
};

const STALE_DAYS = 30;

export function ReportCard({ search }: { search: SearchSummary }) {
  const [shareState, setShareState] = useState<'idle' | 'loading' | 'copied' | 'error'>('idle');

  async function handleShare() {
    setShareState('loading');
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchId: search.id }),
      });
      if (!res.ok) throw new Error('Failed to create share link');
      const { shareUrl } = await res.json();
      await navigator.clipboard.writeText(shareUrl);
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 3000);
    } catch {
      setShareState('error');
      setTimeout(() => setShareState('idle'), 3000);
    }
  }

  const createdAt = new Date(search.createdAt);
  const ageMs = Date.now() - createdAt.getTime();
  const isStale = ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

  const riskLevel = getRiskLevel(search.riskSummary);
  const dateStr = createdAt.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const metaTags = [
    search.persona ? PERSONA_LABELS[search.persona] ?? search.persona : null,
    search.projectType ? PROJECT_TYPE_LABELS[search.projectType] ?? search.projectType : null,
    search.projectState ?? null,
    search.isDeepCheck ? 'Deep check' : null,
  ].filter((v): v is string => v !== null);

  return (
    <div className="bg-surface border border-border-light rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <Link
              href={`/report/${search.id}`}
              className="text-base font-semibold text-text-primary hover:text-primary transition-colors block truncate"
            >
              {search.entityName}
            </Link>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
              {search.entityAbn && (
                <span className="text-xs text-text-muted">ABN {search.entityAbn}</span>
              )}
              <span className="text-xs text-text-muted">{dateStr}</span>
              {isStale && (
                <span className="inline-flex items-center text-xs font-medium text-warning bg-warning-bg border border-warning/30 rounded-full px-2 py-0.5">
                  {ageDays}d old — consider re-checking
                </span>
              )}
            </div>
            {metaTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {metaTags.map((label) => (
                  <span
                    key={label}
                    className="text-xs text-text-secondary bg-surface-alt border border-border-light rounded-full px-2 py-0.5"
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <RiskBadge level={riskLevel} className="shrink-0" />
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={`/report/${search.id}`}
          className="text-xs font-semibold text-primary hover:underline px-2.5 py-1"
        >
          View
        </Link>
        <button
          disabled
          title="Coming in Phase 7b"
          className="text-xs font-semibold text-text-muted border border-border-light rounded-lg px-2.5 py-1 cursor-not-allowed"
        >
          Re-check
        </button>
        <button
          onClick={handleShare}
          disabled={shareState === 'loading'}
          className={`text-xs font-semibold border rounded-lg px-2.5 py-1 transition ${
            shareState === 'copied'
              ? 'text-success border-success/40 bg-success-bg'
              : shareState === 'error'
                ? 'text-danger border-danger/40'
                : shareState === 'loading'
                  ? 'text-text-muted border-border-light cursor-wait'
                  : 'text-primary border-primary/40 hover:bg-primary/5'
          }`}
        >
          {shareState === 'loading'
            ? 'Sharing…'
            : shareState === 'copied'
              ? 'Link copied!'
              : shareState === 'error'
                ? 'Error'
                : 'Share'}
        </button>
        <a
          href={`/api/report/${search.id}/pdf`}
          download
          className="text-xs font-semibold text-primary border border-primary/40 rounded-lg px-2.5 py-1 hover:bg-primary/5 transition"
        >
          PDF
        </a>
      </div>
    </div>
  );
}
