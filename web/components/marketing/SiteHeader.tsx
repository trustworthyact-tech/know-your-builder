import Link from 'next/link';

// "Who it's for" stays a homepage anchor: the section links out to each
// /for/* page, which keeps the nav at five items.
const NAV_LINKS = [
  { href: '/check-builder-licence', label: 'Licence checks' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/#who-its-for', label: "Who it's for" },
  { href: '/resources', label: 'Resources' },
  { href: '/about', label: 'About' },
] as const;

const linkClass =
  'rounded text-sm font-medium text-brand-slate transition-colors hover:text-brand-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2';

export function SiteHeader() {
  return (
    <header className="sticky top-[env(safe-area-inset-top,0px)] z-40 border-b border-brand-line/80 bg-brand-paper/95">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="shrink-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed */}
          <img src="/brand/trustworthy-logo.svg" alt="Trustworthy Payments" width={147} height={32} />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-7 lg:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className={linkClass}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/check"
            className="rounded-lg bg-brand-ochre px-4 py-2.5 text-sm font-bold text-brand-navy transition-colors hover:bg-brand-ochre-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2"
          >
            <span className="sm:hidden">Check a builder</span>
            <span className="hidden sm:inline">Check a builder free</span>
          </Link>

          {/* No-JS mobile menu */}
          <details className="group relative lg:hidden">
            <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg text-brand-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy [&::-webkit-details-marker]:hidden">
              <span className="sr-only">Menu</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" className="group-open:hidden" />
                <path d="M6 6l12 12M18 6L6 18" className="hidden group-open:block" />
              </svg>
            </summary>
            <nav
              aria-label="Main"
              className="absolute right-0 top-12 grid w-56 gap-1 rounded-xl border border-brand-line bg-white p-2 shadow-lg"
            >
              {NAV_LINKS.map((l) => (
                <a key={l.href} href={l.href} className={`${linkClass} block px-3 py-2.5`}>
                  {l.label}
                </a>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
