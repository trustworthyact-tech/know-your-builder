'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SearchFormData } from '@/components/SearchBar';
import type { EntityMatch } from '@/components/DisambiguationCard';
import { SERVER_URL } from '@/lib/api';
import { KYB_APP_URL, STATIC_PREVIEW } from '@/lib/marketing/preview';

export type BuilderSearchView = 'search' | 'disambiguating' | 'disambiguate';

// Shared search flow for every search entry point (the /check form and the
// marketing hero): skip disambiguation when the identity is already
// unambiguous, otherwise look the name up on the ABR first and let the user
// pick when there's more than one match.
export function useBuilderSearch() {
  const router = useRouter();
  const [view, setView] = useState<BuilderSearchView>('search');
  const [pendingSearch, setPendingSearch] = useState<SearchFormData | null>(null);
  const [matches, setMatches] = useState<EntityMatch[]>([]);

  const navigateToSearch = (companyName: string, abn: string, directorName: string, acn = '') => {
    const params = new URLSearchParams();
    if (companyName) params.set('companyName', companyName);
    if (abn) params.set('abn', abn);
    if (acn) params.set('acn', acn);
    if (directorName) params.set('directorName', directorName);
    if (KYB_APP_URL) {
      window.location.assign(`${KYB_APP_URL}/search?${params.toString()}`);
      return;
    }
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
    // A static preview can't reach the search server (CORS), so hand the name
    // straight to the KYB app's search.
    if (STATIC_PREVIEW) {
      navigateToSearch(data.companyName, '', data.directorName);
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
      const found: EntityMatch[] = json.matches ?? [];
      if (found.length > 1) {
        setMatches(found);
        setView('disambiguate');
      } else if (found.length === 1) {
        navigateToSearch(found[0].name, found[0].abn, data.directorName);
      } else {
        navigateToSearch(data.companyName, '', data.directorName);
      }
    } catch {
      // disambiguation failure is non-fatal — proceed with name-only search
      navigateToSearch(data.companyName, '', data.directorName);
    }
  };

  const reset = () => setView('search');

  return { view, pendingSearch, matches, handleSearch, navigateToSearch, reset };
}
