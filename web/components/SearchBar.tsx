'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function formatABN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)} ${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
}

export interface SearchFormData {
  companyName: string;
  abn: string;
  licenceNumber: string;
}

interface Errors {
  companyName?: string;
  abn?: string;
}

interface SearchBarProps {
  onSearch?: (data: SearchFormData) => void;
}

export function SearchBar({ onSearch }: SearchBarProps = {}) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [abn, setAbn] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const validate = (): boolean => {
    const errs: Errors = {};
    if (!companyName.trim() && !abn.trim()) {
      errs.companyName = 'Enter a builder name or ABN to search';
    }
    if (abn.trim() && abn.replace(/\D/g, '').length !== 11) {
      errs.abn = 'ABN must be 11 digits';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const data: SearchFormData = {
      companyName: companyName.trim(),
      abn: abn.replace(/\D/g, ''),
      licenceNumber: licenceNumber.trim(),
    };
    if (onSearch) {
      onSearch(data);
      return;
    }
    const params = new URLSearchParams();
    if (data.companyName) params.set('companyName', data.companyName);
    if (data.abn) params.set('abn', data.abn);
    if (data.licenceNumber) params.set('licenceNumber', data.licenceNumber);
    router.push(`/search?${params.toString()}`);
  };

  return (
    <form
      onSubmit={submit}
      className="bg-surface rounded-2xl p-6 shadow-md border border-border text-left"
    >
      <h2 className="text-lg font-semibold text-primary mb-1">Builder Details</h2>
      <p className="text-xs text-text-muted mb-5">
        Enter as much as you have — more detail means more accurate results.
      </p>

      {/* Company name */}
      <div className="mb-4">
        <label htmlFor="sb-company-name" className="block text-sm font-semibold text-text-secondary mb-1">
          Company / Business Name
        </label>
        <p id="sb-company-name-hint" className="text-xs text-text-muted mb-1.5">Registered legal name of the entity</p>
        <input
          id="sb-company-name"
          aria-describedby="sb-company-name-hint"
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="e.g. Acme Building Group Pty Ltd"
          autoCapitalize="words"
          className={`w-full border rounded-lg px-3.5 py-3 text-sm text-text-primary bg-surface placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-light focus:border-primary-light transition ${
            errors.companyName ? 'border-danger' : 'border-border'
          }`}
        />
        {errors.companyName && (
          <p className="text-xs text-danger mt-1">{errors.companyName}</p>
        )}
      </div>

      {/* ABN */}
      <div className="mb-4">
        <label htmlFor="sb-abn" className="block text-sm font-semibold text-text-secondary mb-1">ABN</label>
        <p id="sb-abn-hint" className="text-xs text-text-muted mb-1.5">Australian Business Number — 11 digits</p>
        <input
          id="sb-abn"
          aria-describedby="sb-abn-hint"
          type="text"
          inputMode="numeric"
          value={abn}
          onChange={(e) => setAbn(formatABN(e.target.value))}
          placeholder="e.g. 51 824 753 556"
          className={`w-full border rounded-lg px-3.5 py-3 text-sm text-text-primary bg-surface placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-light focus:border-primary-light transition ${
            errors.abn ? 'border-danger' : 'border-border'
          }`}
        />
        {errors.abn && <p className="text-xs text-danger mt-1">{errors.abn}</p>}
      </div>

      {/* Licence number */}
      <div className="mb-6">
        <label htmlFor="sb-licence" className="block text-sm font-semibold text-text-secondary mb-1">
          Licence Number
        </label>
        <p id="sb-licence-hint" className="text-xs text-text-muted mb-1.5">
          QBCC, NSW Fair Trading, or other state licence
        </p>
        <input
          id="sb-licence"
          aria-describedby="sb-licence-hint"
          type="text"
          value={licenceNumber}
          onChange={(e) => setLicenceNumber(e.target.value)}
          placeholder="e.g. 1234567"
          className="w-full border border-border rounded-lg px-3.5 py-3 text-sm text-text-primary bg-surface placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-light focus:border-primary-light transition"
        />
      </div>

      <button
        type="submit"
        className="w-full bg-primary hover:bg-primary-light text-white font-semibold text-sm py-4 rounded-xl transition shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        Start Due Diligence →
      </button>
    </form>
  );
}
