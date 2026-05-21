'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';

export function NavBar() {
  const { data: session, status } = useSession();

  return (
    <header className="bg-surface border-b border-border-light">
      <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between">
        <Link href="/" className="text-sm font-bold text-primary tracking-tight">
          Know Your Builder
        </Link>

        <div className="flex items-center gap-4">
          {status === 'loading' ? null : session ? (
            <>
              <Link
                href="/account/reports"
                className="text-xs font-semibold text-text-secondary hover:text-primary transition-colors hidden sm:block"
              >
                Account
              </Link>
              <span className="text-xs text-text-muted hidden sm:block truncate max-w-[180px]">
                {session.user.email}
              </span>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="text-xs font-semibold text-text-secondary hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="text-xs font-semibold text-text-secondary hover:text-primary transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/auth/register"
                className="text-xs font-semibold bg-primary text-white rounded-lg px-3 py-1.5 hover:bg-primary-light transition-colors"
              >
                Register
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
