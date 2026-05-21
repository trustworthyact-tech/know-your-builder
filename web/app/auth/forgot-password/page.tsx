'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary">Know Your Builder</h1>
          <p className="text-text-muted text-sm mt-1">Reset your password</p>
        </div>

        <div className="bg-surface rounded-2xl shadow-md overflow-hidden">
          <div className="h-1 bg-primary" />
          <div className="p-8">
            {sent ? (
              <div className="text-center">
                <div className="text-4xl mb-4">✉️</div>
                <p className="text-text-primary font-semibold mb-2">Check your inbox</p>
                <p className="text-text-muted text-sm">
                  If an account exists for <span className="font-medium">{email}</span>, we&apos;ve
                  sent a reset link. It expires in 1 hour.
                </p>
                <Link
                  href="/auth/login"
                  className="mt-6 inline-block text-primary text-sm font-semibold hover:underline"
                >
                  ← Back to sign in
                </Link>
              </div>
            ) : (
              <>
                <p className="text-text-secondary text-sm mb-6">
                  Enter your email address and we&apos;ll send you a link to reset your password.
                </p>

                {error && (
                  <div className="bg-danger-bg border border-danger rounded-xl px-4 py-3 mb-6 text-sm text-danger font-medium">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
                      Email
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                      placeholder="you@example.com"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-primary text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50 hover:bg-primary-light transition-colors"
                  >
                    {loading ? 'Sending…' : 'Send reset link'}
                  </button>
                </form>

                <p className="text-center text-text-muted text-sm mt-6">
                  <Link href="/auth/login" className="text-primary font-semibold hover:underline">
                    ← Back to sign in
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
