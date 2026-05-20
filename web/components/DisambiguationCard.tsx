'use client';

function formatABN(abn: string): string {
  const d = abn.replace(/\D/g, '');
  if (d.length !== 11) return abn;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
}

export interface EntityMatch {
  name: string;
  abn: string;
  type: string;
  state: string;
  status: string;
}

interface Props {
  companyName: string;
  matches: EntityMatch[];
  onSelect: (match: EntityMatch) => void;
  onSkip: () => void;
}

export function DisambiguationCard({ companyName, matches, onSelect, onSkip }: Props) {
  const isActive = (status: string) => status.toLowerCase().includes('active');

  return (
    <div className="bg-surface rounded-2xl p-6 shadow-md border border-border">
      <h2 className="text-lg font-semibold text-primary mb-1">Multiple matches found</h2>
      <p className="text-xs text-text-muted mb-5">
        We found {matches.length} entities matching &ldquo;{companyName}&rdquo;. Select the one
        you&apos;re searching for.
      </p>

      <ul className="space-y-2.5">
        {matches.map((match) => (
          <li
            key={match.abn}
            className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 hover:border-primary-light hover:bg-primary/5 transition"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary truncate">{match.name}</p>
              <p className="text-xs text-text-muted mt-0.5 flex items-center flex-wrap gap-x-1.5">
                <span>ABN {formatABN(match.abn)}</span>
                {match.state && (
                  <>
                    <span className="text-border">·</span>
                    <span>{match.state}</span>
                  </>
                )}
                {match.type && (
                  <>
                    <span className="text-border">·</span>
                    <span>{match.type}</span>
                  </>
                )}
                {match.status && (
                  <span
                    className={`inline-block px-1.5 py-px rounded-full text-[10px] font-medium ${
                      isActive(match.status)
                        ? 'bg-success-bg text-success'
                        : 'bg-surface-alt text-text-muted'
                    }`}
                  >
                    {match.status}
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSelect(match)}
              className="shrink-0 text-xs font-semibold text-primary border border-primary rounded-lg px-3 py-1.5 hover:bg-primary hover:text-white transition"
            >
              This one
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onSkip}
        className="mt-4 w-full text-sm text-text-muted hover:text-text-secondary transition py-2"
      >
        None of these — search anyway
      </button>
    </div>
  );
}
