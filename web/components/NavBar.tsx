'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import Image from 'next/image';

export function NavBar() {
  const { data: session, status } = useSession();

  return (
    <header className="bg-surface border-b border-border-light">
      <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a
            href="https://trustworthypayments.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 shrink-0"
            aria-label="Trustworthy"
          >
            <Image src="/trustworthy-mark.png" alt="" width={20} height={20} />
            <span className="text-xs font-semibold text-text-muted hidden sm:block">
              Trustworthy
            </span>
          </a>
          <span className="bg-border w-px h-4" aria-hidden="true" />
          <Link href="/" className="text-sm font-bold text-primary tracking-tight">
            Know Your Builder
          </Link>
        </div>

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
