'use client';

import { useEffect, useState, useCallback } from 'react';

interface PaymentEntry {
  label: string;
  date: string;
  amountCents: number;
}

interface TimelineData {
  id?: string;
  projectValue: string;
  contractSignedDate: string;
  startDate: string;
  completionDate: string;
  paymentSchedule: PaymentEntry[];
  financeArranged: boolean | null;
}

interface Props {
  searchId: string;
  readOnly?: boolean;
}

const PROJECT_VALUE_OPTIONS = [
  { value: 'under_100k', label: 'Under $100k' },
  { value: '100k_500k', label: '$100k – $500k' },
  { value: '500k_2m', label: '$500k – $2m' },
  { value: '2m_plus', label: '$2m+' },
];

const EMPTY: TimelineData = {
  projectValue: '',
  contractSignedDate: '',
  startDate: '',
  completionDate: '',
  paymentSchedule: [],
  financeArranged: null,
};

function centsToDisplay(cents: number): string {
  return cents > 0 ? String(Math.round(cents / 100)) : '';
}

function displayToCents(value: string): number {
  const n = parseFloat(value.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

export function ProjectTimeline({ searchId, readOnly = false }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TimelineData>(EMPTY);
  const [exists, setExists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [authd, setAuthd] = useState(true);

  const loadTimeline = useCallback(() => {
    fetch(`/api/timeline/${searchId}`)
      .then((res) => {
        if (res.status === 401) { setAuthd(false); return null; }
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (!data) return;
        if (data.timeline) {
          const t = data.timeline;
          setExists(true);
          setForm({
            projectValue: t.projectValue ?? '',
            contractSignedDate: t.contractSignedDate ? t.contractSignedDate.slice(0, 10) : '',
            startDate: t.startDate ? t.startDate.slice(0, 10) : '',
            completionDate: t.completionDate ? t.completionDate.slice(0, 10) : '',
            paymentSchedule: Array.isArray(t.paymentSchedule) ? t.paymentSchedule : [],
            financeArranged: t.financeArranged ?? null,
          });
        }
      })
      .catch(() => {});
  }, [searchId]);

  useEffect(() => {
    if (searchId !== 'preview') loadTimeline();
  }, [searchId, loadTimeline]);

  async function handleSave() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const payload = {
        searchId,
        projectValue: form.projectValue || null,
        contractSignedDate: form.contractSignedDate || null,
        startDate: form.startDate || null,
        completionDate: form.completionDate || null,
        paymentSchedule: form.paymentSchedule,
        financeArranged: form.financeArranged,
      };

      let res: Response;
      if (exists) {
        res = await fetch(`/api/timeline/${searchId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/timeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Save failed');
      }
      setExists(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function addPaymentEntry() {
    setForm((f) => ({
      ...f,
      paymentSchedule: [...f.paymentSchedule, { label: '', date: '', amountCents: 0 }],
    }));
  }

  function updatePaymentEntry(index: number, field: keyof PaymentEntry, value: string) {
    setForm((f) => {
      const updated = f.paymentSchedule.map((entry, i) => {
        if (i !== index) return entry;
        if (field === 'amountCents') return { ...entry, amountCents: displayToCents(value) };
        return { ...entry, [field]: value };
      });
      return { ...f, paymentSchedule: updated };
    });
  }

  function removePaymentEntry(index: number) {
    setForm((f) => ({
      ...f,
      paymentSchedule: f.paymentSchedule.filter((_, i) => i !== index),
    }));
  }

  // Hide for preview reports or unauthenticated users
  if (searchId === 'preview' || !authd) return null;

  return (
    <section className="bg-surface rounded-2xl border border-border shadow-sm mb-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-surface-alt transition"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl" aria-hidden="true">📅</span>
          <div>
            <h2 className="text-sm font-bold text-primary">About Your Project</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {exists ? 'Timeline saved — tap to edit' : 'Optional: save key dates and payment milestones'}
            </p>
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-border-light">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            {/* Project value bucket */}
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                Project value
              </label>
              <select
                value={form.projectValue}
                onChange={(e) => setForm((f) => ({ ...f, projectValue: e.target.value }))}
                disabled={readOnly}
                className="w-full text-sm border border-border-light rounded-lg px-3 py-2 bg-background text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
              >
                <option value="">Select…</option>
                {PROJECT_VALUE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Finance arranged */}
            <div className="flex items-center gap-3 sm:pt-6">
              <input
                id="financeArranged"
                type="checkbox"
                checked={form.financeArranged === true}
                onChange={(e) =>
                  setForm((f) => ({ ...f, financeArranged: e.target.checked ? true : null }))
                }
                disabled={readOnly}
                className="w-4 h-4 rounded border-border-light accent-primary disabled:opacity-50"
              />
              <label
                htmlFor="financeArranged"
                className="text-sm text-primary select-none"
              >
                Finance arranged
              </label>
            </div>

            {/* Contract signed date */}
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                Contract signed date
              </label>
              <input
                type="date"
                value={form.contractSignedDate}
                onChange={(e) => setForm((f) => ({ ...f, contractSignedDate: e.target.value }))}
                disabled={readOnly}
                className="w-full text-sm border border-border-light rounded-lg px-3 py-2 bg-background text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
              />
            </div>

            {/* Start date */}
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                Construction start date
              </label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                disabled={readOnly}
                className="w-full text-sm border border-border-light rounded-lg px-3 py-2 bg-background text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
              />
            </div>

            {/* Completion date */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">
                Estimated completion date
              </label>
              <input
                type="date"
                value={form.completionDate}
                onChange={(e) => setForm((f) => ({ ...f, completionDate: e.target.value }))}
                disabled={readOnly}
                className="w-full text-sm border border-border-light rounded-lg px-3 py-2 bg-background text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Payment schedule */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-text-secondary">Payment schedule</h3>
              {!readOnly && (
                <button
                  type="button"
                  onClick={addPaymentEntry}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  + Add milestone
                </button>
              )}
            </div>

            {form.paymentSchedule.length === 0 ? (
              <p className="text-xs text-text-muted italic">
                No milestones added. {!readOnly && 'Tap "+ Add milestone" to track payment dates.'}
              </p>
            ) : (
              <div className="space-y-2">
                {form.paymentSchedule.map((entry, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 items-start">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 col-span-1">
                      <input
                        type="text"
                        placeholder="Label (e.g. Base stage)"
                        value={entry.label}
                        onChange={(e) => updatePaymentEntry(i, 'label', e.target.value)}
                        disabled={readOnly}
                        className="text-xs border border-border-light rounded-lg px-3 py-2 bg-background text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                      />
                      <input
                        type="date"
                        value={entry.date}
                        onChange={(e) => updatePaymentEntry(i, 'date', e.target.value)}
                        disabled={readOnly}
                        className="text-xs border border-border-light rounded-lg px-3 py-2 bg-background text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                      />
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">$</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="Amount"
                          value={centsToDisplay(entry.amountCents)}
                          onChange={(e) => updatePaymentEntry(i, 'amountCents', e.target.value)}
                          disabled={readOnly}
                          className="w-full text-xs border border-border-light rounded-lg pl-6 pr-3 py-2 bg-background text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                        />
                      </div>
                    </div>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => removePaymentEntry(i)}
                        className="text-text-muted hover:text-danger mt-2 text-xs"
                        aria-label="Remove milestone"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Save controls */}
          {!readOnly && (
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="text-sm font-semibold bg-primary text-white rounded-xl px-5 py-2.5 hover:bg-primary-light transition disabled:opacity-50"
              >
                {saving ? 'Saving…' : exists ? 'Update timeline' : 'Save timeline'}
              </button>
              {saved && (
                <span className="text-xs text-success font-semibold">Saved ✓</span>
              )}
              {error && (
                <span className="text-xs text-danger">{error}</span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
