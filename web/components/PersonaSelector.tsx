'use client';

import { Persona } from '@/src/types';

interface PersonaOption {
  value: Persona;
  icon: string;
  label: string;
  description: string;
}

const OPTIONS: PersonaOption[] = [
  {
    value: Persona.HOMEOWNER,
    icon: '🏠',
    label: 'Homeowner',
    description: 'Building or renovating my home',
  },
  {
    value: Persona.SUBCONTRACTOR,
    icon: '🔨',
    label: 'Subcontractor',
    description: 'Checking a head contractor I work for',
  },
  {
    value: Persona.DEVELOPER,
    icon: '🏗️',
    label: 'Developer',
    description: 'Commercial or residential development',
  },
  {
    value: Persona.LENDER,
    icon: '🏦',
    label: 'Lender',
    description: 'Financing a construction project',
  },
];

interface Props {
  onSelect: (persona: Persona) => void;
}

export function PersonaSelector({ onSelect }: Props) {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 pt-12 pb-16">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center mx-auto mb-4 shadow-md">
            <span className="text-white font-extrabold text-lg tracking-tight">KYB</span>
          </div>
          <h1 className="text-2xl font-bold text-primary mb-2">What best describes you?</h1>
          <p className="text-sm text-text-muted">
            This helps us tailor the report to what matters most for you.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {OPTIONS.map(({ value, icon, label, description }) => (
            <button
              key={value}
              type="button"
              onClick={() => onSelect(value)}
              className="bg-surface rounded-2xl border border-border p-5 text-left hover:border-primary hover:shadow-md transition-all group focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              <span className="text-3xl block mb-3">{icon}</span>
              <p className="text-sm font-semibold text-primary mb-1 group-hover:text-primary-light transition-colors">
                {label}
              </p>
              <p className="text-xs text-text-muted leading-snug">{description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
