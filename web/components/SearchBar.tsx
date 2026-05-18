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

interface Errors {
  companyName?: string;
  abn?: string;
}

export function SearchBar() {
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
    const params = new URLSearchParams();
    if (companyName.trim()) params.set('companyName', companyName.trim());
    if (abn.trim()) params.set('abn', abn.replace(/\D/g, ''));
    if (licenceNumber.trim()) params.set('licenceNumber', licenceNumber.trim());
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
        <label className="block text-sm font-semibold text-text-secondary mb-1">
          Company / Business Name
        </label>
        <p className="text-xs text-text-muted mb-1.5">Registered legal name of the entity</p>
        <input
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
        <label className="block text-sm font-semibold text-text-secondary mb-1">ABN</label>
        <p className="text-xs text-text-muted mb-1.5">Australian Business Number — 11 digits</p>
        <input
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
        <label className="block text-sm font-semibold text-text-secondary mb-1">
          Licence Number
        </label>
        <p className="text-xs text-text-muted mb-1.5">
          QBCC, NSW Fair Trading, or other state licence
        </p>
        <input
          type="text"
          value={licenceNumber}
          onChange={(e) => setLicenceNumber(e.target.value)}
          placeholder="e.g. 1234567"
          className="w-full border border-border rounded-lg px-3.5 py-3 text-sm text-text-primary bg-surface placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary-light focus:border-primary-light transition"
        />
      </div>

      <button
        type="submit"
        className="w-full bg-primary hover:bg-primary-light text-white font-semibold text-sm py-4 rounded-xl transition shadow-md"
      >
        Start Due Diligence →
      </button>
    </form>
  );
}
