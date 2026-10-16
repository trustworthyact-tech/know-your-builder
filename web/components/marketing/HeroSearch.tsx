'use client';

import { useState } from 'react';
import { DisambiguationCard } from '@/components/DisambiguationCard';
import { useBuilderSearch } from '@/lib/useBuilderSearch';
import { trackEvent } from '@/lib/analytics';

interface Props {
  // Which instance on the page — keeps input ids unique and tags the event.
  source: 'hero' | 'closing';
  tone?: 'light' | 'dark';
}

// One-box entry point for the marketing site: a builder name, ABN or ACN.
// Director-name searches stay on the full /check form.
export function HeroSearch({ source, tone = 'light' }: Props) {
  const { view, pendingSearch, matches, handleSearch, navigateToSearch } = useBuilderSearch();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const inputId = `builder-search-${source}`;
  const errorId = `${inputId}-error`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = query.trim();
    if (!value) {
      setError("Enter the builder's business name, ABN or ACN.");
      return;
    }
    const digits = value.replace(/\D/g, '');
    const looksNumeric = /^[\d\s-]+$/.test(value);
    if (looksNumeric && digits.length !== 11 && digits.length !== 9) {
      setError('An ABN has 11 digits and an ACN has 9. Check the number, or search by name.');
      return;
    }
    setError('');
    const kind = looksNumeric ? (digits.length === 11 ? 'abn' : 'acn') : 'name';
    trackEvent('marketing_search_started', { source, kind });
    handleSearch({
      companyName: looksNumeric ? '' : value,
      abn: kind === 'abn' ? digits : '',
      acn: kind === 'acn' ? digits : '',
      directorName: '',
    });
  };

  if (view === 'disambiguate' && pendingSearch) {
    return (
      <div className="text-left text-text-primary">
        <DisambiguationCard
          companyName={pendingSearch.companyName}
          matches={matches}
          onSelect={(match) => navigateToSearch(match.name, match.abn, '')}
          onSkip={() => navigateToSearch(pendingSearch.companyName, '', '')}
        />
      </div>
    );
  }

  const busy = view === 'disambiguating';
  const hintClass = tone === 'dark' ? 'text-[#C9D3E0]' : 'text-brand-slate';

  return (
    <form onSubmit={submit} noValidate className="w-full">
      <label htmlFor={inputId} className="sr-only">
        Builder business name, ABN or ACN
      </label>
      <div className="flex flex-col gap-2 rounded-2xl border border-brand-line bg-white p-2 shadow-[0_8px_30px_-12px_rgba(11,37,69,0.25)] sm:flex-row">
        <input
          id={inputId}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Builder name or ABN"
          autoComplete="off"
          enterKeyHint="search"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          disabled={busy}
          className="min-w-0 flex-1 rounded-xl px-4 py-3.5 text-base text-brand-navy placeholder:text-[#6B7588] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-ochre px-6 py-3.5 text-base font-bold text-brand-navy transition-colors hover:bg-brand-ochre-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2 disabled:cursor-wait"
        >
          {busy ? (
            <>
              <svg className="h-4 w-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
              </svg>
              Looking up…
            </>
          ) : (
            'Run free check'
          )}
        </button>
      </div>
      <div aria-live="polite" className="min-h-[1.5rem] pt-2 text-sm">
        {error ? (
          <p id={errorId} className={tone === 'dark' ? 'text-[#FFC9C2]' : 'text-danger'}>
            {error}
          </p>
        ) : busy ? (
          <p className={hintClass}>Looking the business up on the Australian Business Register…</p>
        ) : (
          <p className={hintClass}>
            Know a director&apos;s name instead?{' '}
            <a
              href="/check"
              className={`font-semibold underline underline-offset-2 ${tone === 'dark' ? 'text-white' : 'text-brand-navy'}`}
            >
              Use the full search
            </a>
          </p>
        )}
      </div>
    </form>
  );
}
