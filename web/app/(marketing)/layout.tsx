import { Schibsted_Grotesk } from 'next/font/google';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { SiteFooter } from '@/components/marketing/SiteFooter';

// preload: false keeps the 46 KB variable font out of the critical path. With it
// preloaded, Lighthouse's mobile simulation counts the font toward LCP and the
// page misses the 2.5s budget (2.56s simulated), even though the real paint
// happens at first paint. The hero text renders straight away in next/font's
// size-matched fallback and swaps to Schibsted when it lands, with no layout shift.
const schibsted = Schibsted_Grotesk({
  subsets: ['latin'],
  variable: '--font-schibsted',
  display: 'swap',
  preload: false,
});

// Public marketing site. Server Components only, apart from small client
// islands (the hero search) — no SessionProvider, so no next-auth session
// request on these pages. See CLAUDE.md "Marketing site".
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${schibsted.variable} font-brand flex min-h-screen flex-col bg-brand-paper text-brand-navy antialiased`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
