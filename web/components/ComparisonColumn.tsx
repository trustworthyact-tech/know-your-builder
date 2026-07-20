import Link from 'next/link';
import { RiskBadge, RiskLevel } from '@/components/RiskBadge';
import { RiskGroupResult } from '@/src/types';

export interface ComparisonData {
  id: string;
  entityName: string;
  entityAbn: string | null;
  createdAt: string;
  riskSummary: string | null;
  isDeepCheck: boolean;
}

const SECTION_ROWS: { label: string; anchors: string[] }[] = [
  { label: '8.1 Identity', anchors: ['#s81'] },
  { label: '8.2 Licences', anchors: ['#s82'] },
  { label: '8.3 Financial', anchors: ['#s83'] },
  { label: '8.4 Enforcement', anchors: ['#s84', '#s85'] },
];

function parseRiskGroups(riskSummary: string | null): RiskGroupResult[] {
  if (!riskSummary) return [];
  try {
    return JSON.parse(riskSummary) as RiskGroupResult[];
  } catch {
    return [];
  }
}

function deriveSectionRisk(groups: RiskGroupResult[], anchors: string[]): RiskLevel {
  const matching = groups.filter((g) => g.triggers.some((t) => anchors.includes(t.anchor)));
  if (matching.length === 0) return 'clear';
  if (matching.some((g) => g.severity === 'significant')) return 'significant';
  return 'findings';
}

function getOverallRisk(groups: RiskGroupResult[]): RiskLevel {
  if (groups.length === 0) return 'clear';
  if (groups.some((g) => g.severity === 'significant')) return 'significant';
  return 'findings';
}

function entityInitials(name: string): string {
  return (
    name
      .replace(/\b(PTY|LTD|LIMITED|TRUST|AND|THE)\b/gi, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

export function ComparisonColumn({ data }: { data: ComparisonData }) {
  const groups = parseRiskGroups(data.riskSummary);
  const overallRisk = getOverallRisk(groups);
  const initials = entityInitials(data.entityName);
  const dateStr = new Date(data.createdAt).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="bg-surface rounded-2xl border border-border shadow-sm p-5 flex flex-col gap-4 h-full">
      {/* Entity header */}
      <div>
        <div className="flex items-start gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shrink-0 shadow-sm"
            aria-hidden="true"
          >
            <span className="text-white font-extrabold text-sm tracking-tight">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-primary leading-snug break-words">
              {data.entityName}
            </h2>
            {data.entityAbn && (
              <p className="text-xs text-text-muted mt-0.5">ABN {data.entityAbn}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs text-text-muted">{dateStr}</span>
          <RiskBadge level={overallRisk} />
        </div>

        {data.isDeepCheck && (
          <span className="inline-block mt-2 text-xs font-medium text-info bg-info-bg border border-info/30 rounded-full px-2 py-0.5">
            Deep check
          </span>
        )}
      </div>

      {/* Per-section risk rows */}
      <div className="border-t border-border-light pt-4">
        <p className="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wide">
          By section
        </p>
        <div className="space-y-2">
          {SECTION_ROWS.map(({ label, anchors }) => {
            const level = deriveSectionRisk(groups, anchors);
            return (
              <div key={anchors[0]} className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-secondary">{label}</span>
                <RiskBadge level={level} className="text-[10px] px-2 py-0.5 shrink-0" />
              </div>
            );
          })}
        </div>
      </div>

      {/* Triggered risk groups */}
      {groups.length > 0 && (
        <div className="border-t border-border-light pt-4">
          <p className="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wide">
            Risk areas flagged
          </p>
          <div className="flex flex-col gap-1.5">
            {groups.map((g) => (
              <span
                key={g.id}
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border w-fit ${
                  g.severity === 'significant'
                    ? 'bg-danger-bg text-danger border-danger/30'
                    : 'bg-warning-bg text-warning border-warning/30'
                }`}
                title={g.description}
                aria-label={`Risk area: ${g.label} — ${g.severity === 'significant' ? 'Significant finding' : 'Findings — review recommended'}`}
              >
                <span aria-hidden="true">{g.severity === 'significant' ? '✗' : '⚠'}</span>
                {g.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {groups.length === 0 && (
        <div className="border-t border-border-light pt-4">
          <div className="flex items-center gap-2 text-xs text-success bg-success-bg border border-success/30 rounded-xl px-3 py-2">
            <span aria-hidden="true">✓</span>
            <span>No risk areas flagged</span>
          </div>
        </div>
      )}

      {/* View report link */}
      <div className="border-t border-border-light pt-4 mt-auto">
        <Link
          href={`/report/${data.id}`}
          className="block w-full text-center text-xs font-semibold text-primary border border-primary/40 rounded-lg px-3 py-2 hover:bg-primary/5 transition"
          aria-label={`View full report for ${data.entityName}`}
        >
          View full report →
        </Link>
      </div>
    </div>
  );
}
