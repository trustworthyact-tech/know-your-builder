'use client';

import { SearchBar } from '@/components/SearchBar';
import { DisambiguationCard } from '@/components/DisambiguationCard';
import { useBuilderSearch } from '@/lib/useBuilderSearch';

export function HomeSearch() {
  const { view, pendingSearch, matches, handleSearch, navigateToSearch } = useBuilderSearch();

  if (view === 'disambiguating') {
    return (
      <div className="bg-surface rounded-2xl p-8 shadow-md border border-border text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
          <svg
            className="w-6 h-6 text-primary animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-primary mb-1">Looking up entity…</h2>
        <p className="text-xs text-text-muted">
          Searching the Australian Business Register — this takes a moment.
        </p>
      </div>
    );
  }

  if (view === 'disambiguate' && pendingSearch) {
    return (
      <DisambiguationCard
        companyName={pendingSearch.companyName}
        matches={matches}
        onSelect={(match) =>
          navigateToSearch(match.name, match.abn, pendingSearch.directorName)
        }
        onSkip={() =>
          navigateToSearch(pendingSearch.companyName, '', pendingSearch.directorName)
        }
      />
    );
  }

  return <SearchBar onSearch={handleSearch} />;
}
