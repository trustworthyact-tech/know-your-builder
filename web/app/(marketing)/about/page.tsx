import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, Prose, SearchBand } from '@/components/marketing/ui';

// TODO(business details): add founder story, ABN and contact details once confirmed.
export const metadata: Metadata = {
  title: 'About Trustworthy Payments',
  description:
    'Trustworthy Payments builds tools that take the guesswork out of construction payments, starting with Know Your Builder, a free builder check for NSW and the ACT.',
  alternates: { canonical: '/about' },
};

const PRODUCTS = [
  { href: '/check', name: 'Know Your Builder', when: 'Before you sign', status: 'Available now' },
  { href: '/fundsight', name: 'FundSight', when: 'During the build', status: 'Coming soon' },
  { href: '/retention-trust', name: 'Digital Retention Trust', when: 'After completion', status: 'Coming soon' },
] as const;

export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="About us"
        title="Construction payments people can trust."
        lead="Trustworthy Payments builds tools that take the guesswork out of who you’re paying, and whether you’ll get paid, on a building project."
        crumbs={[
          { href: '/', label: 'Home' },
          { href: '/about', label: 'About' },
        ]}
      />
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6">
        <Prose>
          <h2>Why we exist</h2>
          <p>
            When a builder fails, the people left out of pocket are usually the ones with the least
            information: homeowners who paid a deposit, and subcontractors waiting on progress payments or
            retention. The warning signs are often on the public record long before the collapse, spread
            across a dozen registers that most people don’t know exist.
          </p>
          <p>
            We bring that information together, show where it came from, and make it free to check. Then we
            build tools that keep money moving fairly once the work starts.
          </p>
          <h2>What we stand by</h2>
          <ul>
            <li><strong>Official sources only.</strong> Every finding links to the register, court or tribunal it came from.</li>
            <li><strong>No overclaiming.</strong> We say what we checked and what we couldn’t, including which states we don’t cover yet.</li>
            <li><strong>Fair to the people named.</strong> We report the public record as published and correct matching errors when we’re told about them.</li>
          </ul>
        </Prose>

        <ul className="grid gap-5 md:grid-cols-3">
          {PRODUCTS.map((p) => (
            <li key={p.name}>
              <Link
                href={p.href}
                className="grid h-full content-start gap-2 rounded-2xl border border-brand-line bg-white p-6 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-ochre-text">{p.when}</span>
                <span className="text-xl font-bold text-brand-navy">{p.name}</span>
                <span className="text-sm text-brand-slate">{p.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <SearchBand />
    </>
  );
}
