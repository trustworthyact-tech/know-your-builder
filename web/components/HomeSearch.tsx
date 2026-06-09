'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchBar, SearchFormData } from '@/components/SearchBar';
import { ContractUpload, UploadResult } from '@/components/ContractUpload';
import { ExtractionConfirmCard, ConfirmData } from '@/components/ExtractionConfirmCard';
import { DisambiguationCard, EntityMatch } from '@/components/DisambiguationCard';
import { ContractExtraction } from '@/src/types';
import { SERVER_URL } from '@/lib/api';

type View = 'search' | 'upload' | 'extracting' | 'confirm' | 'disambiguating' | 'disambiguate';

export function HomeSearch() {
  const router = useRouter();
  const [view, setView] = useState<View>('search');
  const [extraction, setExtraction] = useState<ContractExtraction | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [pendingSearch, setPendingSearch] = useState<SearchFormData | null>(null);
  const [disambigMatches, setDisambigMatches] = useState<EntityMatch[]>([]);

  const navigateToSearch = (companyName: string, abn: string, directorName: string, acn = '') => {
    const params = new URLSearchParams();
    if (companyName) params.set('companyName', companyName);
    if (abn) params.set('abn', abn);
    if (acn) params.set('acn', acn);
    if (directorName) params.set('directorName', directorName);
    router.push(`/search?${params.toString()}`);
  };

  const handleSearch = async (data: SearchFormData) => {
    // ABN or ACN provided — identity is unambiguous, skip disambiguation
    if (data.abn || data.acn) {
      navigateToSearch(data.companyName, data.abn, data.directorName, data.acn);
      return;
    }
    // Director-only search bypasses disambiguation (no company to disambiguate)
    if (!data.companyName && data.directorName) {
      navigateToSearch('', '', data.directorName);
      return;
    }
    setPendingSearch(data);
    setView('disambiguating');
    try {
      const res = await fetch(`${SERVER_URL}/api/search/disambiguate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: data.companyName }),
      });
      const json = res.ok ? await res.json() : { matches: [] };
      const matches: EntityMatch[] = json.matches ?? [];
      if (matches.length > 1) {
        setDisambigMatches(matches);
        setView('disambiguate');
      } else if (matches.length === 1) {
        navigateToSearch(matches[0].name, matches[0].abn, data.directorName);
      } else {
        navigateToSearch(data.companyName, '', data.directorName);
      }
    } catch {
      // disambiguation failure is non-fatal — proceed with name-only search
      navigateToSearch(data.companyName, '', data.directorName);
    }
  };

  const handleUploadComplete = async (result: UploadResult) => {
    setView('extracting');
    setExtractError(null);
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r2Key: result.r2Key, fileType: result.fileType }),
      });
      if (!res.ok) throw new Error('Extraction failed');
      const data: ContractExtraction = await res.json();
      setExtraction(data);
      setView('confirm');
    } catch {
      setExtractError("We couldn't read your contract — please enter details manually.");
      setView('search');
    }
  };

  const handleConfirm = (data: ConfirmData) => {
    const params = new URLSearchParams();
    if (data.builderName) params.set('companyName', data.builderName);
    if (data.abn) params.set('abn', data.abn.replace(/\s/g, ''));
    router.push(`/search?${params.toString()}`);
  };

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
        matches={disambigMatches}
        onSelect={(match) =>
          navigateToSearch(match.name, match.abn, pendingSearch.directorName)
        }
        onSkip={() =>
          navigateToSearch(pendingSearch.companyName, '', pendingSearch.directorName)
        }
      />
    );
  }

  if (view === 'upload') {
    return (
      <ContractUpload
        onComplete={handleUploadComplete}
        onCancel={() => setView('search')}
      />
    );
  }

  if (view === 'extracting') {
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
        <h2 className="text-base font-semibold text-primary mb-1">Reading your contract…</h2>
        <p className="text-xs text-text-muted">
          Extracting builder details — this usually takes 10–20 seconds.
        </p>
      </div>
    );
  }

  if (view === 'confirm' && extraction) {
    return (
      <ExtractionConfirmCard
        extraction={extraction}
        onConfirm={handleConfirm}
        onManual={() => {
          setExtraction(null);
          setView('search');
        }}
      />
    );
  }

  return (
    <>
      <SearchBar onSearch={handleSearch} />
      {extractError && (
        <p className="mt-2 text-xs text-danger text-center">{extractError}</p>
      )}
      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() => setView('upload')}
          className="text-sm text-primary-light font-medium underline underline-offset-2 hover:text-primary transition"
        >
          Or upload your contract to auto-fill →
        </button>
      </div>
    </>
  );
}
