import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HeroSearch } from '@/components/marketing/HeroSearch';
import { WaitlistForm } from '@/components/marketing/WaitlistForm';
import { PageHeader, Prose, Callout, SearchBand, JsonLd, breadcrumbJsonLd } from '@/components/marketing/ui';
import { NATIONAL_CHECKS, STATES, getState } from '@/lib/marketing/states';
import { CONTENT_REVIEWED, SITE_URL } from '@/lib/marketing/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return STATES.map((s) => ({ state: s.slug }));
}

export function generateMetadata({ params }: { params: { state: string } }): Metadata {
  const s = getState(params.state);
  if (!s) return {};
  return {
    title: s.covered
      ? `Check a Builder Licence in ${s.code}: Free Report`
      : `How to Check a Builder Licence in ${s.code}`,
    description: s.covered
      ? `Check a ${s.code} builder’s licence for free, plus ASIC, insolvency and court records in one report. Step-by-step guide to the ${s.regulator} register.`
      : `How to check a builder licence in ${s.name}: the ${s.regulator} register, step by step, plus home building insurance and national checks.`,
    alternates: { canonical: `/check-builder-licence/${s.slug}` },
  };
}

const reviewed = new Date(CONTENT_REVIEWED).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

export default function StatePage({ params }: { params: { state: string } }) {
  const s = getState(params.state);
  if (!s) notFound();

  const crumbs = [
    { href: '/', label: 'Home' },
    { href: '/check-builder-licence', label: 'Check a builder licence' },
    { href: `/check-builder-licence/${s.slug}`, label: s.code },
  ];
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: s.faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };

  return (
    <>
      <JsonLd data={breadcrumbJsonLd(SITE_URL, crumbs)} />
      <JsonLd data={faqLd} />
      <PageHeader
        eyebrow={s.covered ? `${s.name} · Covered by Know Your Builder` : s.name}
        title={`Check a builder licence in ${s.code}`}
        lead={
          s.covered
            ? `Run a free Know Your Builder report to check a ${s.code} builder’s licence, ASIC and insolvency records and court history in one go. Or check the ${s.regulator} register yourself, step by step below.`
            : `Builders in ${s.name} are licensed by ${s.regulator}. Here’s how to check a licence on the official register, and what else to check before you sign.`
        }
        crumbs={crumbs}
      >
        <div className="max-w-xl pt-2">
          {s.covered ? (
            <HeroSearch source="hero" />
          ) : (
            <div className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5">
              <p className="font-semibold text-brand-navy">
                Know Your Builder doesn’t cover {s.code} yet. Want to know when it does?
              </p>
              <WaitlistForm product={s.waitlist!} buttonLabel="Notify me" />
            </div>
          )}
        </div>
      </PageHeader>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Prose>
          {s.kybChecks && (
            <>
              <h2>What Know Your Builder checks in {s.code}</h2>
              <ul>
                {s.kybChecks.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p>
                Every finding links to its source record. <a href="/how-it-works">See how it works</a>.
              </p>
            </>
          )}

          <h2>How to check a builder licence in {s.code} yourself</h2>
          <p>
            {s.regulator} publishes licences on the{' '}
            <a href={s.registerUrl} rel="noopener">
              {s.registerName}
            </a>
            . It’s free and takes a couple of minutes.
          </p>
          <ol>
            {s.howTo.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ol>
          {s.extraRegister && (
            <p>
              <a href={s.extraRegister.url} rel="noopener">
                {s.extraRegister.name}
              </a>
              : {s.extraRegister.what}
            </p>
          )}
          <Callout title="Match the names">
            The licence holder must be the same person or company named on your contract and invoices. A
            licence held by someone else, or by a related company, isn’t the builder’s licence.
          </Callout>

          <h2>Home building insurance{s.deposit ? ' and deposits' : ''}</h2>
          <p>{s.insurance}</p>
          {s.deposit && <p>{s.deposit}</p>}

          <h2>Check more than the licence</h2>
          <p>
            A current licence doesn’t tell you whether the business is in financial trouble. These national
            registers cover businesses in every state:
          </p>
          <ul>
            {NATIONAL_CHECKS.map((c) => (
              <li key={c.name}>
                <a href={c.url} rel="noopener">
                  {c.name}
                </a>
                : {c.what}
              </li>
            ))}
          </ul>
          {!s.covered && (
            <p>
              Building in NSW or the ACT instead? <a href="/check">Know Your Builder</a> runs all of these
              checks for you, free.
            </p>
          )}

          <h2>Common questions</h2>
          {s.faqs.map((f) => (
            <div key={f.q}>
              <h3>{f.q}</h3>
              <p>{f.a}</p>
            </div>
          ))}

          <p className="!mt-10 text-sm text-brand-slate">
            Last reviewed {reviewed} against the {s.regulator} website. Rules change, so confirm with the
            regulator before you rely on a figure.
          </p>
        </Prose>

        <aside aria-label="Other states" className="lg:pt-12">
          <nav className="rounded-2xl border border-brand-line bg-white p-5 lg:sticky lg:top-24">
            <p className="text-sm font-semibold text-brand-navy">Other states and territories</p>
            <ul className="mt-3 grid grid-cols-4 gap-2 lg:grid-cols-2">
              {STATES.filter((o) => o.slug !== s.slug).map((o) => (
                <li key={o.slug}>
                  <a
                    href={`/check-builder-licence/${o.slug}`}
                    className="block rounded-lg border border-brand-line px-3 py-2 text-center text-sm font-semibold text-brand-navy hover:border-brand-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
                  >
                    {o.code}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>

      {s.covered && <SearchBand title={`Check a ${s.code} builder before you sign.`} />}
    </>
  );
}
