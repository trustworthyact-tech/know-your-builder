'use client';

import { isStateInScope, COVERAGE_NOTE } from '@/lib/scope';

interface Props {
  /** The project's declared state/territory (EmailGate's `projectState`), if known. */
  state?: string | null;
}

// Launch scope is national registers plus NSW and ACT courts/licensing only (see
// CLAUDE.md "Launch scope"). A report for a builder based outside NSW/ACT would otherwise
// show the same confident "0 licence records found" as a genuinely-checked one, with no
// indication that state's own licence and court registers were never queried at all —
// exactly the silent-false-clean shape this codebase's other completeness work
// (CompletenessBadge, RiskSummaryPanel's incompleteCount) exists to prevent. This is a
// deliberately separate, always-visible notice rather than another completeness value,
// since it's not "this check failed" but "this check doesn't exist yet for this state."
export function CoverageNotice({ state }: Props) {
  if (isStateInScope(state)) return null;

  return (
    <div className="flex items-start gap-3 bg-info-bg rounded-xl px-4 py-3 border border-info/30 mb-6">
      <span className="text-info font-bold text-lg shrink-0" aria-hidden="true">
        ℹ
      </span>
      <p className="text-sm text-info leading-relaxed">
        {COVERAGE_NOTE}
        {state ? ` This project is listed as ${state}.` : ''}
      </p>
    </div>
  );
}
