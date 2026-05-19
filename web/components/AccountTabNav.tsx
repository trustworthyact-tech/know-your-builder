'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { label: 'Reports', href: '/account/reports' },
  { label: 'Watchlist', href: '/account/watchlist' },
  { label: 'Monitoring', href: '/account/monitoring' },
  { label: 'Alerts', href: '/account/alerts' },
  { label: 'Billing', href: '/account/billing' },
];

export function AccountTabNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border-light bg-surface">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex overflow-x-auto">
          {TABS.map(({ label, href }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={`whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
