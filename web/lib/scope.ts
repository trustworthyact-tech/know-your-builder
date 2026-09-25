// Launch scope — Know Your Builder's initial release covers national registers plus NSW
// and ACT court/licensing checks only (see CLAUDE.md "Launch scope"). This is the same set
// as server/scrapers/manifest.js's `mvpScope: true` entries and its `ENABLED_JURISDICTIONS`
// env var default — keep all three in sync if scope ever changes.
//
// Every non-national jurisdiction below has real, built scraper infrastructure that is
// simply not invoked yet — nothing here implies that code was removed. Re-enabling a state
// is: add its jurisdiction here, add it to server's ENABLED_JURISDICTIONS, re-run
// server/scrapers/manifest.test.js and web's own scope tests.
export const IN_SCOPE_JURISDICTIONS = ['national', 'nsw', 'act'] as const;
export type ScopeJurisdiction = (typeof IN_SCOPE_JURISDICTIONS)[number];

export function isJurisdictionInScope(jurisdiction: string): boolean {
  return (IN_SCOPE_JURISDICTIONS as readonly string[]).includes(jurisdiction);
}

// The full 8-state list a searcher can pick for the project's location (EmailGate) — kept
// complete, same order as before this file existed, so no search is ever blocked by
// state. Anything outside IN_SCOPE_STATE_LABELS gets a coverage note rather than a silent
// gap.
export const AU_STATES = ['QLD', 'NSW', 'VIC', 'WA', 'SA', 'TAS', 'NT', 'ACT'] as const;
export const IN_SCOPE_STATE_LABELS: readonly string[] = ['NSW', 'ACT'];

export function isStateInScope(state: string | null | undefined): boolean {
  if (!state) return true; // unknown/unset — don't assert a gap that may not exist
  return IN_SCOPE_STATE_LABELS.includes(state.toUpperCase());
}

export const COVERAGE_NOTE =
  'Know Your Builder currently searches national registers plus NSW and ACT courts and licensing. Checks for other states and territories are not yet available in this release.';

// Deep check ($15 add-on) is excluded from the MVP launch UI by user decision, but the
// underlying feature (EmailGate submission, PaymentModal, server-side scrapers, report
// rendering) is untouched — flip this back to true to restore the user-facing entry points.
export const DEEP_CHECK_ENABLED = false;
