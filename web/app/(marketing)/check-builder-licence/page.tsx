import type { Metadata } from 'next';
import Link from 'next/link';
import { HeroSearch } from '@/components/marketing/HeroSearch';
import { PageHeader, Prose, JsonLd, breadcrumbJsonLd } from '@/components/marketing/ui';
import { STATES } from '@/lib/marketing/states';
import { SOURCE_COUNT } from '@/lib/marketing/content';
import { SITE_URL } from '@/lib/marketing/site';

export const metadata: Metadata = {
  title: 'How to Check a Builder Licence in Australia (Every State)',
  description:
    'Where to check a builder licence in every Australian state and territory, what to look for, and a free one-report check for NSW and ACT builders.',
  alternates: { canonical: '/check-builder-licence' },
};

const crumbs = [
  { href: '/', label: 'Home' },
  { href: '/check-builder-licence', label: 'Check a builder licence' },
];

export default function LicenceHubPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(SITE_URL, crumbs)} />
      <PageHeader
        eyebrow="Builder licence checks"
        title="How to check a builder licence in Australia."
        lead={`Each state and territory runs its own builder licence register. Pick your state for a step-by-step guide. In NSW and the ACT, Know Your Builder checks the licence plus ASIC, insolvency and court records, ${SOURCE_COUNT} official sources in one free report.`}
        crumbs={crumbs}
      >
        <div className="max-w-xl pt-2">
          <HeroSearch source="hero" />
        </div>
      </PageHeader>

      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATES.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/check-builder-licence/${s.slug}`}
                className="grid h-full content-start gap-2 rounded-2xl border border-brand-line bg-white p-5 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-2xl font-extrabold text-brand-navy">{s.code}</span>
                  {s.covered && (
                    <span className="rounded-full bg-brand-ochre px-2.5 py-0.5 text-xs font-bold text-brand-navy">Free check</span>
                  )}
                </span>
                <span className="text-sm font-semibold text-brand-navy">{s.name}</span>
                <span className="text-sm text-brand-slate">{s.regulator}</span>
              </Link>
            </li>
          ))}
        </ul>

        <Prose>
          <h2>What to look for on any licence register</h2>
          <ul>
            <li><strong>The licence is current</strong>, not expired, suspended or cancelled.</li>
            <li><strong>The class covers your job.</strong> A licence for one trade doesn’t cover a whole build.</li>
            <li><strong>The name matches your contract.</strong> The licence must belong to the business you’re paying.</li>
            <li><strong>Conditions and discipline.</strong> Many registers show conditions, penalties or past disciplinary action.</li>
          </ul>
          <h2>A licence isn’t the whole story</h2>
          <p>
            A builder can hold a current licence and still be close to collapse. Check ASIC insolvency
            notices, court and tribunal decisions, and whether the directors have run failed companies
            before. In NSW and the ACT, <a href="/check">Know Your Builder</a> does all of this in one free
            report.
          </p>
        </Prose>
      </div>
    </>
  );
}
