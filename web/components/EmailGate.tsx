'use client';

import { useState } from 'react';
import { Persona } from '@/src/types';

const AU_STATES = ['QLD', 'NSW', 'VIC', 'WA', 'SA', 'TAS', 'NT', 'ACT'] as const;

const PROJECT_TYPES = [
  { value: 'new_build', label: 'New build' },
  { value: 'renovation', label: 'Renovation' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'subdivision', label: 'Subdivision' },
  { value: 'other', label: 'Other' },
] as const;

export interface EmailGateData {
  email: string;
  projectState: string;
  projectType: string;
  isDeepCheck: boolean;
}

interface Props {
  persona: Persona;
  entityName: string;
  onSubmit: (data: EmailGateData) => void;
}

const PERSONA_LABELS: Record<Persona, string> = {
  [Persona.HOMEOWNER]: 'Homeowner',
  [Persona.SUBCONTRACTOR]: 'Subcontractor',
  [Persona.DEVELOPER]: 'Developer',
  [Persona.LENDER]: 'Lender',
};

export function EmailGate({ persona, entityName, onSubmit }: Props) {
  const [email, setEmail] = useState('');
  const [projectState, setProjectState] = useState('');
  const [projectType, setProjectType] = useState('');
  const [isDeepCheck, setIsDeepCheck] = useState(false);
  const [emailError, setEmailError] = useState('');

  const validate = (): boolean => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Enter a valid email address');
      return false;
    }
    setEmailError('');
    return true;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onSubmit({
      email: email.trim(),
      projectState,
      projectType,
      isDeepCheck,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 pt-10 pb-16">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center mx-auto mb-4 shadow-md">
            <span className="text-white font-extrabold text-lg tracking-tight">KYB</span>
          </div>
          <h1 className="text-2xl font-bold text-primary mb-1">Run your free builder check</h1>
          <p className="text-sm text-text-muted">
            Checking{' '}
            <span className="font-semibold text-text-secondary">{entityName}</span>
            {' · '}
            <span className="text-text-muted">{PERSONA_LABELS[persona]}</span>
          </p>
        </div>

        <form
          onSubmit={submit}
          className="bg-surface rounded-2xl p-6 shadow-md border border-border"
        >
          {/* Email */}
          <div className="mb-5">
            <label className="block text-sm font-semibold text-text-secondary mb-1">
              Email <span className="text-danger">*</span>
            </label>
            <p className="text-xs text-text-muted mb-1.5">
              We'll send your report here
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
              placeholder="you@example.com"
              autoComplete="email"
              className={`w-full border rounded-lg px-3.5 py-3 text-sm text-text-primary bg-surface placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-light focus:border-primary-light transition ${
                emailError ? 'border-danger' : 'border-border'
              }`}
            />
            {emailError && (
              <p className="text-xs text-danger mt-1">{emailError}</p>
            )}
          </div>

          {/* State + Project type */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-semibold text-text-secondary mb-1">
                State
              </label>
              <select
                value={projectState}
                onChange={(e) => setProjectState(e.target.value)}
                className="w-full border border-border rounded-lg px-3.5 py-3 text-sm text-text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-primary-light focus:border-primary-light transition appearance-none"
              >
                <option value="">Select…</option>
                {AU_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-text-secondary mb-1">
                Project type
              </label>
              <select
                value={projectType}
                onChange={(e) => setProjectType(e.target.value)}
                className="w-full border border-border rounded-lg px-3.5 py-3 text-sm text-text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-primary-light focus:border-primary-light transition appearance-none"
              >
                <option value="">Select…</option>
                {PROJECT_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* CTA */}
          <button
            type="submit"
            className="w-full bg-primary hover:bg-primary-light text-white font-semibold text-sm py-4 rounded-xl transition shadow-md"
          >
            Run search →
          </button>

          <p className="text-center text-xs text-text-muted mt-3">
            Free, instant, no credit card.{' '}
            <span className="text-text-muted">Privacy policy · Unsubscribe any time</span>
          </p>

          {/* Deep check opt-in */}
          <div className="mt-5 border-t border-border-light pt-5">
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={isDeepCheck}
                  onChange={(e) => setIsDeepCheck(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="w-4 h-4 border-2 border-border rounded transition peer-checked:bg-primary peer-checked:border-primary group-hover:border-primary-light" />
                {isDeepCheck && (
                  <svg
                    className="absolute inset-0 w-4 h-4 text-white pointer-events-none"
                    viewBox="0 0 16 16"
                    fill="none"
                  >
                    <path
                      d="M3 8l3.5 3.5L13 5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  Include deep check{' '}
                  <span className="text-accent font-bold">$15</span>
                </p>
                <p className="text-xs text-text-muted leading-snug mt-0.5">
                  Adds full historical director list + personal insolvency check via ASIC Data API
                  and AFSA NPII. Recommended for high-value contracts.
                </p>
              </div>
            </label>
          </div>
        </form>
      </div>
    </div>
  );
}
