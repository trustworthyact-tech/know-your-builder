'use client';

import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

const STRIPE_APPEARANCE = {
  theme: 'stripe' as const,
  variables: {
    colorPrimary: '#1A3A5C',
    colorBackground: '#ffffff',
    colorText: '#0F1C2E',
    colorDanger: '#C0392B',
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: '6px',
  },
};

// ─── Entity form (step 1 when no pre-fill) ────────────────────────────────────

interface EntityFormProps {
  initialName: string;
  initialAbn: string;
  loading: boolean;
  error: string | null;
  onSubmit: (name: string, abn: string) => void;
  onClose: () => void;
}

function EntityForm({ initialName, initialAbn, loading, error, onSubmit, onClose }: EntityFormProps) {
  const [name, setName] = useState(initialName);
  const [abn, setAbn] = useState(initialAbn);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim(), abn.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        We run daily, weekly, and monthly checks and alert you to any changes in licence, court, or insolvency status.
      </p>

      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">
          Builder / company name <span className="text-danger">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Smith Constructions Pty Ltd"
          required
          className="w-full rounded-lg border border-border px-3 py-2 text-sm text-text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">ABN (optional)</label>
        <input
          type="text"
          value={abn}
          onChange={(e) => setAbn(e.target.value)}
          placeholder="e.g. 12 345 678 901"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm text-text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {error && (
        <p className="text-sm text-danger bg-danger-bg rounded px-3 py-2">{error}</p>
      )}

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-light transition-colors disabled:opacity-50"
        >
          {loading ? 'Setting up…' : 'Continue →'}
        </button>
      </div>
    </form>
  );
}

// ─── Stripe payment form (step 2) ────────────────────────────────────────────

interface PaymentFormProps {
  entityName: string;
  onSuccess: () => void;
  onClose: () => void;
}

function PaymentForm({ entityName, onSuccess, onClose }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? 'Payment failed');
      setSubmitting(false);
      return;
    }

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message ?? 'Payment failed');
      setSubmitting(false);
      return;
    }

    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="rounded-lg bg-surface-alt border border-border px-4 py-3">
        <p className="text-xs text-text-muted mb-0.5">Monitoring</p>
        <p className="text-sm font-medium text-text-primary truncate">{entityName}</p>
        <p className="text-lg font-bold text-primary mt-1">$18.00 AUD / month</p>
      </div>

      <PaymentElement />

      {error && (
        <p className="text-sm text-danger bg-danger-bg rounded px-3 py-2">{error}</p>
      )}

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !stripe}
          className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-light transition-colors disabled:opacity-50"
        >
          {submitting ? 'Processing…' : 'Pay $18.00'}
        </button>
      </div>
    </form>
  );
}

// ─── Modal shell ──────────────────────────────────────────────────────────────

export interface MonitoringSubscribeModalProps {
  /** Pre-fill the entity name and skip the entity form. */
  initialEntityName?: string;
  initialEntityAbn?: string;
  onSuccess: () => void;
  onClose: () => void;
}

export function MonitoringSubscribeModal({
  initialEntityName,
  initialEntityAbn,
  onSuccess,
  onClose,
}: MonitoringSubscribeModalProps) {
  const prefilled = Boolean(initialEntityName);

  const [step, setStep] = useState<'entity' | 'payment'>(prefilled ? 'payment' : 'entity');
  const [entityName, setEntityName] = useState(initialEntityName ?? '');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingPayment, setLoadingPayment] = useState(false);

  // When pre-filled, initiate the subscription on mount
  useEffect(() => {
    if (prefilled && initialEntityName) {
      initSubscription(initialEntityName, initialEntityAbn ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function initSubscription(name: string, abn: string) {
    setLoadingPayment(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/monitoring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityName: name, entityAbn: abn }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error ?? 'Failed to set up monitoring');
        setLoadingPayment(false);
        return;
      }
      setEntityName(name);
      setClientSecret(data.clientSecret);
      setStep('payment');
    } catch {
      setLoadError('Failed to set up monitoring');
    }
    setLoadingPayment(false);
  }

  const title = step === 'entity' ? 'Monitor a builder' : 'Complete payment';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {step === 'entity' && (
          <EntityForm
            initialName={initialEntityName ?? ''}
            initialAbn={initialEntityAbn ?? ''}
            loading={loadingPayment}
            error={loadError}
            onSubmit={initSubscription}
            onClose={onClose}
          />
        )}

        {step === 'payment' && (
          <>
            {loadError && (
              <p className="text-sm text-danger bg-danger-bg rounded px-3 py-2 mb-4">{loadError}</p>
            )}

            {!loadError && !clientSecret && (
              <div className="flex justify-center py-8">
                <svg className="animate-spin h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
            )}

            {clientSecret && (
              <Elements
                stripe={stripePromise}
                options={{ clientSecret, appearance: STRIPE_APPEARANCE }}
              >
                <PaymentForm
                  entityName={entityName}
                  onSuccess={onSuccess}
                  onClose={onClose}
                />
              </Elements>
            )}
          </>
        )}
      </div>
    </div>
  );
}
