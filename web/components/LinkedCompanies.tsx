'use client';

import { ResultItem, SearchResult } from '@/src/types';

// Other companies linked to the searched entity's people through the NSW and ACT licence
// registers (LICENCE_MATCHING_PLAN.md 2b.2 / 3.1) — derived from the `LinkedCompany` metadata the
// server stamps on each linked company's records (licences, court, FWO, ASIC EU, ACT disciplinary
// results). Shown in section 8.1 so a reader can see why those companies were searched.

interface LinkedCompany {
  name: string;
  via: string;
  confirmed: boolean;
  records: Map<string, number>;
}

const SOURCE_LABELS: Record<string, string> = {
  nswFairTrading: 'NSW licence',
  actLicences: 'ACT licence',
  actDisciplinary: 'ACT disciplinary action',
  fwo: 'FWO outcome',
  asicEnforceableUndertakings: 'ASIC enforceable undertaking',
};

function sourceLabel(key: string): string {
  return key.startsWith('courts_') ? 'court or tribunal decision' : SOURCE_LABELS[key] ?? key;
}

function collect(results: SearchResult[]): LinkedCompany[] {
  const byName = new Map<string, LinkedCompany>();
  for (const r of results) {
    for (const item of (r.results ?? []) as ResultItem[]) {
      const name = item.metadata?.['LinkedCompany'];
      if (!name) continue;
      const confirmed = item.metadata?.['MatchedBy'] !== 'Name only — verify';
      const entry = byName.get(name) ?? { name, via: item.metadata?.['LinkedVia'] ?? '', confirmed, records: new Map() };
      entry.confirmed = entry.confirmed || confirmed;
      const label = sourceLabel(r.key);
      entry.records.set(label, (entry.records.get(label) ?? 0) + 1);
      byName.set(name, entry);
    }
  }
  return [...byName.values()].sort((a, b) => Number(b.confirmed) - Number(a.confirmed));
}

interface Props {
  results: SearchResult[];
  /** Whether any people were found or typed — the "none found" line only makes sense then. */
  hadPeople: boolean;
}

export function LinkedCompanies({ results, hadPeople }: Props) {
  const companies = collect(results);
  if (companies.length === 0 && !hadPeople) return null;

  return (
    <div className="mt-5 pt-4 border-t border-border-light">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
        Companies linked through licence records
      </p>
      {companies.length === 0 ? (
        <p className="text-sm text-text-secondary">
          No other companies linked to these people were found in the NSW or ACT licence registers.
        </p>
      ) : (
        <ul className="divide-y divide-border-light">
          {companies.map((c) => (
            <li key={c.name} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{c.name}</span>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded ${
                    c.confirmed ? 'bg-info-bg text-info' : 'bg-warning-bg text-warning'
                  }`}
                >
                  {c.confirmed ? 'Linked on licence record' : 'Linked by name only — verify'}
                </span>
              </div>
              {c.via && <p className="text-xs text-text-muted mt-0.5">Via {c.via}</p>}
              <p className="text-xs text-text-secondary mt-0.5">
                {[...c.records.entries()].map(([label, n]) => `${n} ${label}${n === 1 ? '' : 's'}`).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
