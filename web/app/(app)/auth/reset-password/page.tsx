'use client';

import { useState, FormEvent, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = searchParams.get('token') ?? '';
  const email = searchParams.get('email') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isInvalid = !token || !email;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
      } else {
        router.push('/auth/login?reset=1');
      }
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
          <p className="text-text-muted text-sm mt-1">Choose a new password</p>
        </div>

        <div className="bg-surface rounded-2xl shadow-md overflow-hidden">
          <div className="h-1 bg-primary" />
          <div className="p-8">
            {isInvalid ? (
              <div className="text-center">
                <p className="text-danger font-semibold mb-2">Invalid reset link</p>
                <p className="text-text-muted text-sm mb-6">
                  This reset link is missing required parameters. Please request a new one.
                </p>
                <Link
                  href="/auth/forgot-password"
                  className="text-primary text-sm font-semibold hover:underline"
                >
                  Request a new reset link →
                </Link>
              </div>
            ) : (
              <>
                {error && (
                  <div className="bg-danger-bg border border-danger rounded-xl px-4 py-3 mb-6 text-sm text-danger font-medium">
                    {error}
                    {error.toLowerCase().includes('expired') && (
                      <span>
                        {' '}
                        <Link href="/auth/forgot-password" className="underline font-semibold">
                          Request a new link
                        </Link>
                      </span>
                    )}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
                      New password
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                      placeholder="At least 8 characters"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wide">
                      Confirm new password
                    </label>
                    <input
                      type="password"
                      required
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className="w-full border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                      placeholder="Re-enter password"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-primary text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50 hover:bg-primary-light transition-colors"
                  >
                    {loading ? 'Updating…' : 'Set new password'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
