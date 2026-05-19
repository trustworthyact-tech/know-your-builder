'use client';

import { useState } from 'react';
import { ContractExtraction } from '@/src/types';

export interface ConfirmData {
  builderName: string;
  abn: string;
  licenceNumber: string;
  wantClauseAnalysis: boolean;
}

interface Props {
  extraction: ContractExtraction;
  onConfirm: (data: ConfirmData) => void;
  onManual: () => void;
}

export function ExtractionConfirmCard({ extraction, onConfirm, onManual }: Props) {
  const [builderName, setBuilderName] = useState(extraction.builderName);
  const [abn, setAbn] = useState(extraction.abn);
  const [licenceNumber, setLicenceNumber] = useState(extraction.licenceNumber);
  const [wantClauseAnalysis, setWantClauseAnalysis] = useState(false);

  const hasData = builderName.trim() || abn.trim() || licenceNumber.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm({
      builderName: builderName.trim(),
      abn: abn.trim(),
      licenceNumber: licenceNumber.trim(),
      wantClauseAnalysis,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-surface rounded-2xl p-6 shadow-md border border-border"
    >
      <h2 className="text-lg font-semibold text-primary mb-1">Review extracted details</h2>
      <p className="text-xs text-text-muted mb-4">
        Check the details below and edit anything that looks incorrect before continuing.
      </p>

      {extraction.confidence === 'low' && (
        <div className="mb-4 bg-warning-bg border-l-4 border-accent rounded-lg px-4 py-3">
          <p className="text-xs text-warning font-medium">
            We couldn&apos;t extract all details confidently — please review and fill in any missing
            fields.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <Field
          label="Builder / Contractor name"
          value={builderName}
          onChange={setBuilderName}
          placeholder="e.g. Smith Constructions Pty Ltd"
        />
        <Field
          label="ABN"
          value={abn}
          onChange={setAbn}
          placeholder="e.g. 51 824 753 556"
        />
        <Field
          label="Licence number"
          value={licenceNumber}
          onChange={setLicenceNumber}
          placeholder="e.g. QBCC 1234567"
        />
      </div>

      {/* Clause analysis opt-in */}
      <label className="flex items-start gap-3 mt-5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={wantClauseAnalysis}
          onChange={(e) => setWantClauseAnalysis(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
        />
        <div>
          <span className="text-sm font-medium text-text-primary">
            Flag potentially risky contract clauses
          </span>
          <span className="ml-2 text-xs bg-surface-alt text-text-muted px-1.5 py-0.5 rounded-full font-medium">
            coming soon
          </span>
          <p className="text-xs text-text-muted mt-0.5">
            We&apos;ll highlight payment, defect, and variation clauses that may not be in your
            favour.
          </p>
        </div>
      </label>

      <button
        type="submit"
        disabled={!hasData}
        className="mt-5 w-full bg-primary hover:bg-primary-light text-white font-semibold text-sm py-4 rounded-xl transition shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Looks right — Continue →
      </button>

      <button
        type="button"
        onClick={onManual}
        className="mt-2 w-full text-sm text-text-muted hover:text-text-secondary transition py-2"
      >
        Enter details manually instead
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
      />
    </div>
  );
}
