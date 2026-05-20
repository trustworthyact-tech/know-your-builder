'use client';

import { useEffect, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import type { PaymentType } from '@prisma/client';
import { PAYMENT_AMOUNTS, PAYMENT_LABELS } from '@/lib/stripe';

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

interface PaymentFormProps {
  amountCents: number;
  label: string;
  onSuccess: () => void;
  onClose: () => void;
}

function PaymentForm({ amountCents, label, onSuccess, onClose }: PaymentFormProps) {
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

  const dollars = (amountCents / 100).toFixed(2);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="rounded-lg bg-surface-alt border border-border px-4 py-3 flex justify-between items-center">
        <span className="text-sm font-medium text-text-primary">{label}</span>
        <span className="text-lg font-bold text-primary">${dollars} AUD</span>
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
          {submitting ? 'Processing…' : `Pay $${dollars}`}
        </button>
      </div>
    </form>
  );
}

export interface PaymentModalProps {
  paymentType: PaymentType;
  metadata?: Record<string, string>;
  onSuccess: () => void;
  onClose: () => void;
}

export function PaymentModal({ paymentType, metadata, onSuccess, onClose }: PaymentModalProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const amountCents = PAYMENT_AMOUNTS[paymentType] ?? 0;
  const label = PAYMENT_LABELS[paymentType] ?? paymentType;

  useEffect(() => {
    fetch('/api/payments/create-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentType, metadata }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
        } else {
          setLoadError(data.error ?? 'Failed to initialise payment');
        }
      })
      .catch(() => setLoadError('Failed to initialise payment'));
  }, [paymentType, metadata]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-text-primary">Complete payment</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {loadError && (
          <p className="text-sm text-danger bg-danger-bg rounded px-3 py-2">{loadError}</p>
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
              amountCents={amountCents}
              label={label}
              onSuccess={onSuccess}
              onClose={onClose}
            />
          </Elements>
        )}
      </div>
    </div>
  );
}
