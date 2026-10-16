import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HeroSearch } from '@/components/marketing/HeroSearch';
import { PageHeader, SearchBand, JsonLd, breadcrumbJsonLd, h2Class } from '@/components/marketing/ui';
import { AUDIENCES, getAudience } from '@/lib/marketing/audiences';
import { SITE_URL } from '@/lib/marketing/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return AUDIENCES.map((a) => ({ audience: a.slug }));
}

export function generateMetadata({ params }: { params: { audience: string } }): Metadata {
  const a = getAudience(params.audience);
  if (!a) return {};
  return {
    title: a.metaTitle,
    description: a.description,
    alternates: { canonical: `/for/${a.slug}` },
  };
}

function Checklist({ items, tone }: { items: string[]; tone: 'check' | 'flag' }) {
  return (
    <ul className="grid gap-3">
      {items.map((t) => (
        <li key={t} className="flex gap-3 text-[16px] leading-relaxed text-[#2B3A4F]">
          {tone === 'check' ? (
            <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-1 h-5 w-5 shrink-0 text-brand-ochre">
              <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-1 h-5 w-5 shrink-0 text-danger">
              <path d="M10 3l8 14H2L10 3z M10 8v4 M10 14.5v.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {t}
        </li>
      ))}
    </ul>
  );
}

export default function AudiencePage({ params }: { params: { audience: string } }) {
  const a = getAudience(params.audience);
  if (!a) notFound();
  const crumbs = [
    { href: '/', label: 'Home' },
    { href: `/for/${a.slug}`, label: a.nav },
  ];

  return (
    <>
      <JsonLd data={breadcrumbJsonLd(SITE_URL, crumbs)} />
      <PageHeader eyebrow={`For ${a.nav.toLowerCase()}`} title={a.title} lead={a.lead} crumbs={crumbs}>
        <div className="max-w-xl pt-2">
          <HeroSearch source="hero" />
        </div>
      </PageHeader>

      <div className="mx-auto grid max-w-6xl gap-16 px-4 py-16 sm:px-6">
        <section aria-labelledby="when-heading" className="grid gap-6 md:grid-cols-[1fr_1.4fr] md:gap-12">
          <h2 id="when-heading" className={h2Class}>When to check</h2>
          <Checklist items={a.whenToCheck} tone="check" />
        </section>

        <section aria-labelledby="look-heading" className="grid gap-8">
          <h2 id="look-heading" className={h2Class}>What to look for in your report</h2>
          <dl className="grid gap-4 md:grid-cols-2">
            {a.lookFor.map((l) => (
              <div key={l.risk} className="grid content-start gap-2 rounded-2xl border border-brand-line bg-white p-6">
                <dt className="text-lg font-bold text-brand-navy">{l.risk}</dt>
                <dd className="leading-relaxed text-brand-slate">{l.why}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="flags-heading" className="grid gap-6 rounded-3xl bg-white p-8 md:grid-cols-[1fr_1.4fr] md:gap-12">
          <h2 id="flags-heading" className={h2Class}>Red flags</h2>
          <Checklist items={a.redFlags} tone="flag" />
        </section>

        <section aria-labelledby="also-heading" className="grid gap-6 md:grid-cols-[1fr_1.4fr] md:gap-12">
          <div className="grid content-start gap-3">
            <h2 id="also-heading" className={h2Class}>What a report won’t cover</h2>
            <p className="leading-relaxed text-brand-slate">
              A report shows what’s on the public record. Do these as well.
            </p>
          </div>
          <Checklist items={a.alsoDo} tone="check" />
        </section>
      </div>

      <SearchBand />
    </>
  );
}
