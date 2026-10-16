import Link from 'next/link';
import { STATES } from '@/lib/marketing/states';

// TODO(business details): add ABN and contact email once confirmed.
const COLUMNS = [
  {
    title: 'Know Your Builder',
    links: [
      { href: '/check', label: 'Check a builder' },
      { href: '/how-it-works', label: 'How it works' },
      { href: '/sample-report', label: 'Sample report' },
      { href: '/for/owner-builders', label: 'For homeowners' },
      { href: '/for/subcontractors', label: 'For subcontractors' },
      { href: '/for/developers', label: 'For developers' },
    ],
  },
  {
    title: 'Licence checks',
    links: STATES.map((s) => ({ href: `/check-builder-licence/${s.slug}`, label: `${s.code} builder licence` })),
  },
  {
    title: 'Resources',
    links: [
      { href: '/resources', label: 'All resources' },
      { href: '/resources/guides/security-of-payment-act-nsw', label: 'Security of payment (NSW)' },
      { href: '/resources/guides/builder-gone-into-liquidation-nsw', label: 'Builder in liquidation' },
      { href: '/resources/templates/builder-check-checklist', label: 'Builder checklist' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/fundsight', label: 'FundSight' },
      { href: '/retention-trust', label: 'Digital Retention Trust' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-brand-navy text-[#C9D3E0]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]">
        <div className="grid content-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG */}
          <img src="/brand/trustworthy-logo-reversed.svg" alt="Trustworthy Payments" width={166} height={36} />
          <p className="max-w-xs text-sm leading-relaxed">
            Builder checks and construction payment tools for owner-builders, subcontractors and developers.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title} className="grid content-start gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-white">{col.title}</h2>
            <ul className="grid gap-2">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="rounded text-sm transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs sm:flex-row sm:justify-between sm:px-6">
          <p>&copy; {new Date().getFullYear()} Trustworthy Payments Pty Ltd</p>
          <p>Reports summarise public register data and are not legal or financial advice.</p>
        </div>
      </div>
    </footer>
  );
}
