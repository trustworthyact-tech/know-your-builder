// WS0.5 (reliability plan) — makes the Completeness type (src/types/index.ts, stamped on
// every SearchResult by server/scrapers/validateResult.js) a real, visible UI state,
// distinct from RiskBadge's risk-severity badge. The two are orthogonal: a section can
// have a confirmed significant finding from the checks that DID run, while a different
// check in the same section is only partially covered or served from a stale cache —
// this badge surfaces that second dimension without overriding or hiding the first.
//
// Deliberately does not reuse the word "Unavailable" (RiskBadge already owns that term for
// "every check in this section failed, nothing to show at all") — this badge's own
// 'unavailable' level means "at least one check in this section couldn't run, but others
// did," a materially different and less severe situation that still deserves its own
// signal rather than silently reading as fully clean.

export type CompletenessLevel = 'partial' | 'stale' | 'unavailable';

interface Props {
  level: CompletenessLevel;
  className?: string;
}

const CONFIG: Record<CompletenessLevel, { icon: string; label: string; classes: string }> = {
  partial: {
    icon: '◐',
    label: 'Partial coverage',
    classes: 'bg-info-bg text-info border-info/30',
  },
  stale: {
    icon: '⏱',
    label: 'May be outdated',
    classes: 'bg-info-bg text-info border-info/30',
  },
  unavailable: {
    icon: '◐',
    label: 'Some checks unavailable',
    classes: 'bg-surface-alt text-text-muted border-border',
  },
};

export function CompletenessBadge({ level, className = '' }: Props) {
  const { icon, label, classes } = CONFIG[level];
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${classes} ${className}`}
      aria-label={`Coverage: ${label}`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

// Precedence when a section's searchResults carry more than one non-complete
// completeness value: unavailable (a check flat-out couldn't run) is worse than stale
// (it ran, but against aging data) is worse than partial (it ran, but against a narrower
// input than ideal, e.g. no director names to search under). Missing `completeness`
// defaults to 'complete' — matches validateResult.js's own default, so an older/synthetic
// SearchResult with no completeness field reads as complete rather than triggering a
// spurious badge.
const PRECEDENCE: CompletenessLevel[] = ['unavailable', 'stale', 'partial'];

export function worstCompleteness(
  completenessValues: (string | undefined)[]
): CompletenessLevel | null {
  for (const level of PRECEDENCE) {
    if (completenessValues.includes(level)) return level;
  }
  return null;
}
