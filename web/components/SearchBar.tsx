'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function formatIdentifier(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 9) {
    // ACN format: XXX XXX XXX
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  // ABN format: XX XXX XXX XXX
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)} ${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
}

export interface SearchFormData {
  companyName: string;
  abn: string;
  acn: string;
  licenceNumber: string;
}

interface Errors {
  companyName?: string;
  identifier?: string;
}

interface SearchBarProps {
  onSearch?: (data: SearchFormData) => void;
}

export function SearchBar({ onSearch }: SearchBarProps = {}) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [licenceNumber, setLicenceNumber] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const validate = (): boolean => {
    const errs: Errors = {};
    const digits = identifier.replace(/\D/g, '');
    if (!companyName.trim() && !digits) {
      errs.companyName = 'Enter a builder name, ABN, or ACN to search';
    }
    if (digits && digits.length !== 9 && digits.length !== 11) {
      errs.identifier = 'Enter an 11-digit ABN or 9-digit ACN';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const digits = identifier.replace(/\D/g, '');
    const isAcn = digits.length === 9;
    const data: SearchFormData = {
      companyName: companyName.trim(),
      abn: isAcn ? '' : digits,
      acn: isAcn ? digits : '',
      licenceNumber: licenceNumber.trim(),
    };
    if (onSearch) {
      onSearch(data);
      return;
    }
    const params = new URLSearchParams();
    if (data.companyName) params.set('companyName', data.companyName);
    if (data.abn) params.set('abn', data.abn);
    if (data.acn) params.set('acn', data.acn);
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

      {/* ABN or ACN */}
      <div className="mb-4">
        <label htmlFor="sb-identifier" className="block text-sm font-semibold text-text-secondary mb-1">ABN or ACN</label>
        <p id="sb-identifier-hint" className="text-xs text-text-muted mb-1.5">11-digit ABN or 9-digit ACN</p>
        <input
          id="sb-identifier"
          aria-describedby="sb-identifier-hint"
          type="text"
          inputMode="numeric"
          value={identifier}
          onChange={(e) => setIdentifier(formatIdentifier(e.target.value))}
          placeholder="e.g. 51 824 753 556"
          className={`w-full border rounded-lg px-3.5 py-3 text-sm text-text-primary bg-surface placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-light focus:border-primary-light transition ${
            errors.identifier ? 'border-danger' : 'border-border'
          }`}
        />
        {errors.identifier && <p className="text-xs text-danger mt-1">{errors.identifier}</p>}
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
