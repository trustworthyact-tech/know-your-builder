'use client';

import { useState } from 'react';
import type { WaitlistProduct } from '@/lib/marketing/waitlist';
import { trackEvent } from '@/lib/analytics';
import { STATIC_PREVIEW } from '@/lib/marketing/preview';

interface Props {
  product: WaitlistProduct;
  buttonLabel?: string;
}

type Status = 'idle' | 'sending' | 'done' | 'error';

export function WaitlistForm({ product, buttonLabel = 'Join the waitlist' }: Props) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const id = `waitlist-${product}`;

  if (STATIC_PREVIEW) {
    return (
      <p className="rounded-xl border border-brand-line bg-white px-4 py-3 text-sm text-brand-slate">
        The waitlist opens when the site launches.
      </p>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setStatus('error');
      setMessage('Enter a valid email address.');
      return;
    }
    setStatus('sending');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), product }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Please try again.');
      trackEvent('waitlist_joined', { product });
      setStatus('done');
      setMessage('You’re on the list. We’ll email you when it’s ready.');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  };

  if (status === 'done') {
    return (
      <p role="status" className="rounded-xl bg-success-bg px-4 py-3 text-sm font-semibold text-[#1B5E3B]">
        {message}
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-2">
      <label htmlFor={id} className="sr-only">
        Email address
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-invalid={status === 'error' ? true : undefined}
          aria-describedby={status === 'error' ? `${id}-msg` : undefined}
          className="min-w-0 flex-1 rounded-xl border border-brand-line bg-white px-4 py-3 text-base text-brand-navy placeholder:text-[#6B7588] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="rounded-xl bg-brand-navy px-5 py-3 text-base font-bold text-white transition-colors hover:bg-[#16365F] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
        >
          {status === 'sending' ? 'Joining…' : buttonLabel}
        </button>
      </div>
      <p id={`${id}-msg`} aria-live="polite" className="min-h-[1.25rem] text-sm text-danger">
        {status === 'error' ? message : ''}
      </p>
      <p className="text-xs text-brand-slate">We’ll only email you about this. Unsubscribe any time.</p>
    </form>
  );
}
