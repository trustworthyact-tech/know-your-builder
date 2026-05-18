'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { runDueDiligence, checkServer } from '@/lib/api';
import { SearchProgressItem } from '@/components/SearchProgressItem';
import { BuilderInput, SearchResult } from '@/src/types';

// Must mirror the keys emitted by server/index.js exactly — order sets display order.
const INITIAL_SEARCHES: SearchResult[] = [
  { key: 'abn',            label: 'ABR — Business Register',                status: 'idle' },
  { key: 'paymentTimes',   label: 'Payment Times Reporting Register',        status: 'idle' },
  { key: 'modernSlavery',  label: 'Modern Slavery Statements Register',      status: 'idle' },
  { key: 'qbcc',           label: 'QBCC — Licence Register',                 status: 'idle' },
  { key: 'austlii_federal',label: 'Federal Courts (AustLII)',                status: 'idle' },
  { key: 'austlii_qld',   label: 'QLD Courts & Tribunals (AustLII)',         status: 'idle' },
  { key: 'austlii_nsw',   label: 'NSW Courts & Tribunals (AustLII)',         status: 'idle' },
  { key: 'austlii_vic',   label: 'VIC Courts & Tribunals (AustLII)',         status: 'idle' },
  { key: 'austlii_wa',    label: 'WA Courts & Tribunals (AustLII)',          status: 'idle' },
  { key: 'austlii_sa',    label: 'SA Courts & Tribunals (AustLII)',          status: 'idle' },
  { key: 'austlii_nt',    label: 'NT Courts & Tribunals (AustLII)',          status: 'idle' },
  { key: 'austlii_act',   label: 'ACT Courts & Tribunals (AustLII)',         status: 'idle' },
  { key: 'austlii_tas',   label: 'TAS Courts & Tribunals (AustLII)',         status: 'idle' },
  { key: 'links',          label: 'Additional Database Links',               status: 'idle' },
];

export function SearchContent() {
  const router = useRouter();
  const params = useSearchParams();

  const input: BuilderInput = {
    companyName:   params.get('companyName') ?? '',
    abn:           params.get('abn') ?? '',
    licenceNumber: params.get('licenceNumber') || undefined,
    acn:           '',
    tradingName:   '',
    directors:     [],
  };

  const [searches, setSearches] = useState<SearchResult[]>(INITIAL_SEARCHES);
  const [phase, setPhase] = useState<'server-check' | 'running' | 'done' | 'error'>('server-check');
  const [errorMsg, setErrorMsg] = useState('');
  const resultsRef = useRef<SearchResult[]>([]);

  const doneCount = searches.filter((s) => s.status === 'done' || s.status === 'error').length;
  const total = INITIAL_SEARCHES.length;
  const progressPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  const updateSearch = (incoming: SearchResult) => {
    setSearches((prev) =>
      prev.map((s) => (s.key === incoming.key ? { ...s, ...incoming } : s))
    );
    if (incoming.status === 'done' || incoming.status === 'error') {
      resultsRef.current = resultsRef.current
        .filter((r) => r.key !== incoming.key)
        .concat(incoming);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const serverOk = await checkServer();
      if (cancelled) return;

      if (!serverOk) {
        setPhase('error');
        setErrorMsg(
          'Cannot reach the search server at localhost:3001.\n\nStart it with:\n  cd server && node index.js'
        );
        return;
      }

      setPhase('running');
      setSearches((prev) => prev.map((s) => ({ ...s, status: 'searching' })));

      try {
        await runDueDiligence(input, updateSearch);
        if (!cancelled) setPhase('done');
      } catch (err: unknown) {
        if (!cancelled) {
          setPhase('error');
          setErrorMsg(
            err instanceof Error ? err.message : 'An unexpected error occurred'
          );
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  // Auto-navigate when done; results persisted in sessionStorage for Phase 1e/1f
  useEffect(() => {
    if (phase !== 'done') return;
    sessionStorage.setItem('kyb_preview_results', JSON.stringify(resultsRef.current));
    sessionStorage.setItem('kyb_preview_input', JSON.stringify(input));
    const timer = setTimeout(() => router.push('/report/preview'), 1200);
    return () => clearTimeout(timer);
  }, [phase]);

  const goToReport = () => {
    sessionStorage.setItem('kyb_preview_results', JSON.stringify(resultsRef.current));
    sessionStorage.setItem('kyb_preview_input', JSON.stringify(input));
    router.push('/report/preview');
  };

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-primary shadow-md">
        <div className="max-w-xl mx-auto px-5 pt-6 pb-5">
          <p className="text-xs text-white/60 uppercase tracking-wider font-semibold mb-1">
            Running Due Diligence
          </p>
          <h1 className="text-xl font-bold text-white truncate">
            {input.companyName || input.abn || 'Search'}
          </h1>

          <div className="mt-4 h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-white/70">
            {phase === 'server-check'
              ? 'Connecting to server…'
              : phase === 'error'
              ? 'Error'
              : phase === 'done'
              ? 'Complete — loading report…'
              : `${doneCount} of ${total} searches complete`}
          </p>
        </div>
      </div>

      <div className="max-w-xl mx-auto">
        {phase === 'error' ? (
          <div className="flex flex-col items-center px-8 py-16 text-center">
            <span className="text-5xl mb-4">⚠️</span>
            <h2 className="text-lg font-semibold text-danger mb-3">Server Not Running</h2>
            <p className="text-sm text-text-secondary font-mono whitespace-pre-line leading-relaxed">
              {errorMsg}
            </p>
            <button
              onClick={() => router.push('/')}
              className="mt-8 bg-primary text-white text-sm font-semibold px-6 py-3 rounded-xl shadow-md hover:bg-primary-light transition"
            >
              ← Go Back
            </button>
          </div>
        ) : (
          <>
            <div className="bg-surface rounded-b-2xl shadow-sm border-x border-b border-border">
              {searches.map((item) => (
                <SearchProgressItem key={item.key} item={item} />
              ))}
            </div>

            {phase === 'done' && (
              <div className="px-4 py-4">
                <button
                  onClick={goToReport}
                  className="w-full bg-primary text-white text-sm font-semibold py-4 rounded-xl shadow-md hover:bg-primary-light transition"
                >
                  View Report →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
