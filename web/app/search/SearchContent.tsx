'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { runDueDiligence, checkServer } from '@/lib/api';
import { SearchProgressItem } from '@/components/SearchProgressItem';
import { PersonaSelector } from '@/components/PersonaSelector';
import { EmailGate, EmailGateData } from '@/components/EmailGate';
import { BuilderInput, Persona, SearchResult } from '@/src/types';

// Base searches — must mirror the keys emitted by server/index.js exactly. Order sets display order.
const INITIAL_SEARCHES: SearchResult[] = [
  { key: 'abn',               label: 'ABR — Business Register',               status: 'idle' },
  { key: 'asic',              label: 'ASIC Connect — Company Search',          status: 'idle' },
  { key: 'asicDisqualified',  label: 'ASIC — Disqualified Persons Register',   status: 'idle' },
  { key: 'asicInsolvency',   label: 'ASIC Published Notices — Insolvency',    status: 'idle' },
  { key: 'atoDebt',          label: 'ASIC Published Notices — ATO Tax Debt',  status: 'idle' },
  { key: 'paymentTimes',      label: 'Payment Times Reporting Register',       status: 'idle' },
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
  { key: 'austlii_tas',       label: 'TAS Courts & Tribunals (AustLII)',             status: 'idle' },
  { key: 'fwo',              label: 'Fair Work Ombudsman — Enforcement Outcomes',   status: 'idle' },
  { key: 'vicBpc',           label: 'VIC Building Authority — Disciplinary Register', status: 'idle' },
  { key: 'waBuildingEnergy', label: 'WA Building and Energy — Enforcement',         status: 'idle' },
  { key: 'links',            label: 'Additional Database Links',                    status: 'idle' },
];

// Additional entries appended when isDeepCheck is true (inserted before 'links')
const DEEP_CHECK_SEARCHES: SearchResult[] = [
  { key: 'asicExtract', label: 'ASIC — Director Company History (Deep Check)',          status: 'idle' },
  { key: 'afsaNpii',    label: 'AFSA NPII — Director Personal Insolvency (Deep Check)', status: 'idle' },
];

type Step = 'persona' | 'email-gate' | 'server-check' | 'running' | 'saving' | 'done' | 'error';

function loadPersona(): Persona | null {
  try {
    const stored = localStorage.getItem('kyb_persona');
    if (stored && Object.values(Persona).includes(stored as Persona)) {
      return stored as Persona;
    }
  } catch {
    // localStorage unavailable (SSR guard)
  }
  return null;
}

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

  const entityLabel = input.companyName || input.abn || 'this builder';

  const [step, setStep] = useState<Step>('persona');
  const [persona, setPersona] = useState<Persona | null>(null);
  const [gateData, setGateData] = useState<EmailGateData | null>(null);
  const [searches, setSearches] = useState<SearchResult[]>(INITIAL_SEARCHES);
  const [errorMsg, setErrorMsg] = useState('');
  const [packBalanceInfo, setPackBalanceInfo] = useState<{
    freeChecks: number;
    deepChecks: number;
    isRecheck: boolean;
  } | null>(null);
  const resultsRef = useRef<SearchResult[]>([]);

  // Check localStorage for a saved persona on mount
  useEffect(() => {
    const saved = loadPersona();
    if (saved) {
      setPersona(saved);
      setStep('email-gate');
    }
  }, []);

  // Fetch pack balance (and re-check status) when email-gate step is active
  useEffect(() => {
    if (step !== 'email-gate') return;
    const qs = new URLSearchParams();
    const abn = params.get('abn');
    const companyName = params.get('companyName');
    if (abn) qs.set('entityAbn', abn);
    if (companyName) qs.set('entityName', companyName);
    fetch(`/api/payments/pack-balance?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setPackBalanceInfo(data); })
      .catch(() => {}); // non-fatal — no re-check gating if fetch fails
  }, [step, params]);

  const doneCount = searches.filter((s) => s.status === 'done' || s.status === 'error').length;
  const total = searches.length;
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

  const handlePersonaSelect = (selected: Persona) => {
    try {
      localStorage.setItem('kyb_persona', selected);
    } catch {
      // ignore
    }
    setPersona(selected);
    setStep('email-gate');
  };

  const handleEmailGateSubmit = (data: EmailGateData) => {
    setGateData(data);
    runSearch(data);
  };

  const runSearch = (gate: EmailGateData) => {
    setStep('server-check');
    let cancelled = false;

    async function run() {
      const serverOk = await checkServer();
      if (cancelled) return;

      if (!serverOk) {
        setStep('error');
        setErrorMsg(
          'Cannot reach the search server at localhost:3001.\n\nStart it with:\n  cd server && node index.js'
        );
        return;
      }

      setStep('running');

      // Build full search list — insert deep check items before 'links' when opted in
      if (gate.isDeepCheck) {
        setSearches([
          ...INITIAL_SEARCHES.filter((s) => s.key !== 'links'),
          ...DEEP_CHECK_SEARCHES,
          INITIAL_SEARCHES.find((s) => s.key === 'links')!,
        ].map((s) => ({ ...s, status: 'searching' as const })));
      } else {
        setSearches((prev) => prev.map((s) => ({ ...s, status: 'searching' as const })));
      }

      try {
        await runDueDiligence(input, updateSearch, { isDeepCheck: gate.isDeepCheck });
        if (cancelled) return;
        setStep('saving');
        await saveReport(gate);
      } catch (err: unknown) {
        if (!cancelled) {
          setStep('error');
          setErrorMsg(
            err instanceof Error ? err.message : 'An unexpected error occurred'
          );
        }
      }
    }

    run();
    return () => { cancelled = true; };
  };

  const saveReport = async (gate: EmailGateData) => {
    const findings: Record<string, SearchResult> = {};
    for (const r of resultsRef.current) {
      findings[r.key] = r;
    }

    const entityName =
      resultsRef.current.find((r) => r.key === 'abn')?.results?.[0]?.title ||
      input.companyName ||
      input.abn ||
      'Unknown';

    try {
      const res = await fetch('/api/reports/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityName,
          entityAbn: input.abn || undefined,
          persona,
          projectType: gate.projectType || undefined,
          projectState: gate.projectState || undefined,
          findings,
          isDeepCheck: gate.isDeepCheck,
          email: gate.email,
        }),
      });

      if (res.status === 402) {
        // Re-check payment webhook not yet processed — serve preview so user still sees results
        sessionStorage.setItem('kyb_preview_results', JSON.stringify(resultsRef.current));
        sessionStorage.setItem('kyb_preview_input', JSON.stringify(input));
        setStep('done');
        router.push('/report/preview');
        return;
      }

      if (!res.ok) throw new Error('Failed to save report');
      const { searchId } = await res.json();
      setStep('done');
      router.push(`/report/${searchId}`);
    } catch {
      // Fallback: navigate to preview using sessionStorage so the report is still viewable
      sessionStorage.setItem('kyb_preview_results', JSON.stringify(resultsRef.current));
      sessionStorage.setItem('kyb_preview_input', JSON.stringify(input));
      setStep('done');
      router.push('/report/preview');
    }
  };

  // ── Render pre-search steps ──────────────────────────────────────────────────

  if (step === 'persona') {
    return <PersonaSelector onSelect={handlePersonaSelect} />;
  }

  if (step === 'email-gate' && persona) {
    return (
      <EmailGate
        persona={persona}
        entityName={entityLabel}
        isRecheck={packBalanceInfo?.isRecheck ?? false}
        freeChecks={packBalanceInfo?.freeChecks ?? 0}
        onSubmit={handleEmailGateSubmit}
      />
    );
  }

  // ── Render search progress ───────────────────────────────────────────────────

  const statusLabel = () => {
    if (step === 'server-check') return 'Connecting to server…';
    if (step === 'error') return 'Error';
    if (step === 'saving') return 'Saving report…';
    if (step === 'done') return 'Complete — loading report…';
    return `${doneCount} of ${total} searches complete`;
  };

  const goToPreview = () => {
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
              style={{ width: `${step === 'saving' || step === 'done' ? 100 : progressPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-white/70">{statusLabel()}</p>
        </div>
      </div>

      <div className="max-w-xl mx-auto">
        {step === 'error' ? (
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

            {/* Fallback button while saving (in case navigation is slow) */}
            {(step === 'saving' || step === 'done') && gateData === null && (
              <div className="px-4 py-4">
                <button
                  onClick={goToPreview}
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
