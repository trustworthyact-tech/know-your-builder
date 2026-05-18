'use client';

import { SearchResult } from '@/src/types';

interface Props {
  item: SearchResult;
}

export function SearchProgressItem({ item }: Props) {
  const resultCount =
    item.status === 'done' && item.results ? item.results.length : undefined;
  const hasResults = resultCount !== undefined && resultCount > 0;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border-light last:border-0">
      {/* Status indicator */}
      <div
        className={`w-7 h-7 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${
          item.status === 'idle'
            ? 'border-text-muted'
            : item.status === 'searching'
            ? 'border-primary'
            : item.status === 'done' && hasResults
            ? 'border-success bg-success'
            : item.status === 'done'
            ? 'border-text-muted'
            : 'border-danger'
        }`}
      >
        {item.status === 'searching' ? (
          <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        ) : item.status === 'done' && hasResults ? (
          <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        ) : item.status === 'error' ? (
          <span className="text-danger text-xs font-bold leading-none">✕</span>
        ) : (
          <span className="text-text-muted text-xs leading-none">○</span>
        )}
      </div>

      {/* Label + status text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{item.label}</p>
        {item.status === 'searching' && (
          <p className="text-xs text-primary mt-0.5">Searching…</p>
        )}
        {item.status === 'done' && (
          <p className={`text-xs mt-0.5 ${hasResults ? 'text-success' : 'text-text-muted'}`}>
            {hasResults
              ? `${resultCount} result${resultCount === 1 ? '' : 's'} found`
              : 'No results'}
          </p>
        )}
        {item.status === 'error' && (
          <p className="text-xs text-danger mt-0.5">{item.error || 'Search failed'}</p>
        )}
      </div>

      {/* Count badge */}
      {hasResults && (
        <span className="bg-primary text-white text-xs font-semibold px-2 py-0.5 rounded-full shrink-0">
          {resultCount}
        </span>
      )}
    </div>
  );
}
