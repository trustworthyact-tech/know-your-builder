'use client';

import { useState, FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const verified = searchParams.get('verified') === '1';
  const reset = searchParams.get('reset') === '1';
  const errorParam = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    errorParam === 'invalid-token' ? 'Verification link is invalid or expired.' : null
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError('Invalid email or password.');
    } else {
      router.push('/');
    }
  }

  async function handleGoogle() {
    await signIn('google', { callbackUrl: '/' });
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-primary">Know Your Builder</h1>
          <p className="text-text-muted text-sm mt-1">Sign in to your account</p>
        </div>

        <div className="bg-surface rounded-2xl shadow-md overflow-hidden">
          <div className="h-1 bg-primary" />
          <div className="p-8">
            {verified && (
              <div className="bg-success-bg border border-success rounded-xl px-4 py-3 mb-6 text-sm text-success font-medium">
                Email verified — you can now sign in.
              </div>
            )}

            {reset && (
              <div className="bg-success-bg border border-success rounded-xl px-4 py-3 mb-6 text-sm text-success font-medium">
                Password updated — you can now sign in with your new password.
              </div>
            )}

            {error && (
              <div className="bg-danger-bg border border-danger rounded-xl px-4 py-3 mb-6 text-sm text-danger font-medium">
                {error}
              </div>
            )}

            {/* Google */}
            <button
              onClick={handleGoogle}
              className="w-full flex items-center justify-center gap-3 border border-border rounded-xl py-3 text-sm font-medium text-text-primary hover:bg-surface-alt transition-colors mb-6"
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <div className="flex items-center gap-3 mb-6">
              <hr className="flex-1 border-border-light" />
              <span className="text-text-muted text-xs">or</span>
              <hr className="flex-1 border-border-light" />
            </div>

            {/* Credentials form */}
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

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wide">
                    Password
                  </label>
                  <Link
                    href="/auth/forgot-password"
                    className="text-xs text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50 hover:bg-primary-light transition-colors"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <p className="text-center text-text-muted text-sm mt-6">
              Don&apos;t have an account?{' '}
              <Link href="/auth/register" className="text-primary font-semibold hover:underline">
                Create one
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
