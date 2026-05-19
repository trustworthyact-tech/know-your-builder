'use client';

import { useState } from 'react';
import { SearchBar } from '@/components/SearchBar';
import { ContractUpload, UploadResult } from '@/components/ContractUpload';

type View = 'search' | 'upload';

export function HomeSearch() {
  const [view, setView] = useState<View>('search');

  // Phase 4b will wire this result into the extraction flow
  const handleUploadComplete = (_result: UploadResult) => {
    // Placeholder: extraction + confirmation card wired in Phase 4b
  };

  if (view === 'upload') {
    return (
      <ContractUpload
        onComplete={handleUploadComplete}
        onCancel={() => setView('search')}
      />
    );
  }

  return (
    <>
      <SearchBar />
      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={() => setView('upload')}
          className="text-sm text-primary-light font-medium underline underline-offset-2 hover:text-primary transition"
          aria-label="Upload a building contract to extract builder details automatically"
        >
          Or upload your contract to auto-fill →
        </button>
      </div>
    </>
  );
}
