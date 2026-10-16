import type { Metadata } from 'next';
import Link from 'next/link';
import { HeroSearch } from '@/components/marketing/HeroSearch';
import { ReportPreview } from '@/components/marketing/ReportPreview';
import { FAQS, SOURCE_COUNT, SOURCE_GROUPS } from '@/lib/marketing/content';

export const metadata: Metadata = {
  title: { absolute: 'Check a Builder Licence in NSW & ACT, Free | Trustworthy' },
  description:
    'Check your builder before you sign. One free report covering NSW and ACT builder licences, ASIC and insolvency notices, and court and tribunal records.',
  alternates: { canonical: '/' },
};

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trustworthypayments.com';

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE}/#organization`,
      name: 'Trustworthy Payments',
      url: SITE,
      logo: `${SITE}/brand/icon-512.png`,
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE}/#website`,
      url: SITE,
      name: 'Trustworthy',
      publisher: { '@id': `${SITE}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: `${SITE}/search?companyName={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQS.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ],
};

const TRUST_SOURCES = [
  'ABR',
  'ASIC',
  'Verify NSW licences',
  'Access Canberra',
  'Payment Times Register',
  'Federal, NSW & ACT courts',
  'Fair Work Ombudsman',
];

const STEPS = [
  { title: 'Enter the builder', body: 'Type the business name or ABN. We confirm you have the right business on the ABR before searching.' },
  { title: `We search ${SOURCE_COUNT} sources at once`, body: 'Licence registers, ASIC, insolvency notices, courts and tribunals. You can watch each one complete.' },
  { title: 'Read one clear report', body: 'Findings are grouped by risk, and every record links back to the register it came from.' },
];

const AUDIENCES = [
  {
    title: 'Owner-builders and homeowners',
    href: '/for/owner-builders',
    body: 'About to sign a contract or pay a deposit? Check the builder’s licence, insolvency notices and court history first.',
    size: 'lg',
  },
  {
    title: 'Subcontractors',
    href: '/for/subcontractors',
    body: 'Before you take on work, check whether the head contractor has insolvency notices, tax-debt notices or a history of payment disputes.',
    size: 'lg',
  },
  {
    title: 'Developers',
    href: '/for/developers',
    body: 'Vet every builder at tender with the same report, so you compare like with like.',
    size: 'sm',
  },
] as const;

const STAGES = [
  {
    when: 'Before you sign',
    product: 'Know Your Builder',
    body: 'A free due-diligence report on any NSW or ACT builder.',
    status: 'Available now',
    live: true,
    href: '/check',
  },
  {
    when: 'During the build',
    product: 'FundSight',
    body: 'Real-time visibility of project funds, so progress payments arrive when milestones are met.',
    status: 'Coming soon',
    live: false,
    href: '/fundsight',
  },
  {
    when: 'After completion',
    product: 'Digital Retention Trust',
    body: 'Retention money held in trust and released automatically when the defects period ends.',
    status: 'Coming soon',
    live: false,
    href: '/retention-trust',
  },
] as const;

const h2 = 'text-3xl font-extrabold tracking-tight text-brand-navy sm:text-4xl [text-wrap:balance]';
const eyebrow = 'text-xs font-semibold uppercase tracking-[0.14em] text-brand-ochre-text';

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* 1 · Hero — one sentence, one primary action (principle 1) */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,#FBEFD9_0%,rgba(251,239,217,0)_55%),radial-gradient(ellipse_at_90%_30%,#E4ECF6_0%,rgba(228,236,246,0)_50%)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pb-24 lg:pt-20">
          <div className="grid gap-6">
            <p className={eyebrow}>Free builder check · NSW &amp; ACT</p>
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-brand-navy sm:text-5xl lg:text-6xl [text-wrap:balance]">
              Check your builder before you sign.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-brand-slate">
              One free report on any NSW or ACT builder: licence status, ASIC and insolvency notices,
              and court and tribunal records, straight from official registers.
            </p>
            <div className="max-w-xl">
              <HeroSearch source="hero" />
            </div>
          </div>
          <ReportPreview />
        </div>
      </section>

      {/* 2 · Trust strip directly under the hero (principle 2) */}
      <section aria-labelledby="trust-heading" className="border-y border-brand-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:gap-8">
          <h2 id="trust-heading" className="shrink-0 text-sm font-semibold text-brand-navy">
            Data from official public registers
          </h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-brand-slate">
            {TRUST_SOURCES.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-brand-ochre">
                  <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {s}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 3 · Stats band — honest numbers only */}
      <section aria-label="At a glance" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <dl className="grid gap-px overflow-hidden rounded-2xl border border-brand-line bg-brand-line sm:grid-cols-3">
          {[
            [String(SOURCE_COUNT), 'official sources searched in every report'],
            ['$0', 'to run a report, no credit card needed'],
            ['NSW + ACT', 'builder licence and court coverage'],
          ].map(([value, label]) => (
            <div key={label} className="grid gap-1 bg-white px-6 py-7">
              <dt className="order-2 text-sm text-brand-slate">{label}</dt>
              <dd className="order-1 text-4xl font-extrabold tracking-tight text-brand-navy [font-variant-numeric:tabular-nums]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 4 · How it works */}
      <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-20 mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="grid max-w-2xl gap-3">
          <p className={eyebrow}>How it works</p>
          <h2 id="how-heading" className={h2}>
            From a name to a full check in a few minutes.
          </h2>
        </div>
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid content-start gap-3 rounded-2xl border border-brand-line bg-white p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-navy text-sm font-bold text-white" aria-hidden="true">
                {i + 1}
              </span>
              <h3 className="text-lg font-bold text-brand-navy">{s.title}</h3>
              <p className="text-[15px] leading-relaxed text-brand-slate">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 5 · Who it's for — bento */}
      <section id="who-its-for" aria-labelledby="who-heading" className="scroll-mt-20 bg-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid max-w-2xl gap-3">
            <p className={eyebrow}>Who it’s for</p>
            <h2 id="who-heading" className={h2}>
              Whoever’s money is on the line.
            </h2>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-[1fr_1fr_0.8fr]">
            {AUDIENCES.map((a) => (
              <article
                key={a.title}
                className={`grid content-start gap-3 rounded-2xl p-7 ${
                  a.size === 'lg' ? 'bg-brand-wash' : 'border border-brand-line bg-brand-paper md:col-span-2 lg:col-span-1'
                }`}
              >
                <h3 className="text-xl font-bold text-brand-navy">{a.title}</h3>
                <p className="leading-relaxed text-brand-slate">{a.body}</p>
                <Link
                  href={a.href}
                  className="mt-1 w-fit rounded font-semibold text-brand-navy underline decoration-brand-ochre decoration-2 underline-offset-4 hover:decoration-brand-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
                >
                  Read the guide
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 6 · Platform stages (Linear-style workflow sections) */}
      <section aria-labelledby="stages-heading" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid max-w-2xl gap-3">
          <p className={eyebrow}>The Trustworthy platform</p>
          <h2 id="stages-heading" className={h2}>
            Protection at every stage of the build.
          </h2>
        </div>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {STAGES.map((s) => (
            <li
              key={s.product}
              className={`grid content-start gap-3 rounded-2xl p-7 ${
                s.live ? 'bg-brand-navy text-white' : 'border border-brand-line bg-white'
              }`}
            >
              <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${s.live ? 'text-brand-ochre' : 'text-brand-slate'}`}>
                {s.when}
              </p>
              <h3 className={`text-xl font-bold ${s.live ? 'text-white' : 'text-brand-navy'}`}>{s.product}</h3>
              <p className={`leading-relaxed ${s.live ? 'text-[#C9D3E0]' : 'text-brand-slate'}`}>{s.body}</p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <span
                  className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${
                    s.live ? 'bg-brand-ochre text-brand-navy' : 'bg-brand-paper text-brand-slate'
                  }`}
                >
                  {s.status}
                </span>
                <Link
                  href={s.href}
                  className={`rounded text-sm font-semibold underline underline-offset-4 focus:outline-none focus-visible:ring-2 ${
                    s.live ? 'text-white decoration-brand-ochre focus-visible:ring-white' : 'text-brand-navy decoration-brand-ochre focus-visible:ring-brand-navy'
                  }`}
                >
                  {s.live ? 'Check a builder' : 'Join the waitlist'}
                  <span className="sr-only"> for {s.product}</span>
                </Link>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 7 · What we check — click to expand (principle 4), no JS */}
      <section id="what-we-check" aria-labelledby="check-heading" className="scroll-mt-20 bg-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid max-w-2xl gap-3">
            <p className={eyebrow}>What we check</p>
            <h2 id="check-heading" className={h2}>
              {SOURCE_COUNT} sources, six kinds of risk.
            </h2>
            <p className="leading-relaxed text-brand-slate">
              Open a card to see the registers behind it and what they can’t tell you, or read{' '}
              <Link href="/how-it-works" className="font-semibold text-brand-navy underline decoration-brand-ochre decoration-2 underline-offset-4">
                how it works
              </Link>
              .
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {SOURCE_GROUPS.map((g) => (
              <details key={g.id} className="group rounded-2xl border border-brand-line bg-brand-paper open:bg-white open:shadow-sm">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded-2xl p-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy [&::-webkit-details-marker]:hidden">
                  <span className="grid gap-1.5">
                    <span className="text-lg font-bold text-brand-navy">{g.title}</span>
                    <span className="text-[15px] leading-relaxed text-brand-slate">{g.summary}</span>
                  </span>
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-1 h-5 w-5 shrink-0 text-brand-navy transition-transform group-open:rotate-45 motion-reduce:transition-none">
                    <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </summary>
                <div className="grid gap-3 px-6 pb-6">
                  <ul className="grid gap-1.5">
                    {g.sources.map((s) => (
                      <li key={s} className="flex gap-2 text-sm text-brand-navy">
                        <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-ochre" />
                        {s}
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-brand-slate">
                    <span className="font-semibold text-brand-navy">Good to know: </span>
                    {g.limits}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 8 · FAQ */}
      <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-20 mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <div className="grid gap-3">
          <p className={eyebrow}>FAQ</p>
          <h2 id="faq-heading" className={h2}>
            Common questions
          </h2>
        </div>
        <div className="mt-8 divide-y divide-brand-line border-y border-brand-line">
          {FAQS.map((f) => (
            <details key={f.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-lg font-semibold text-brand-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy [&::-webkit-details-marker]:hidden">
                {f.q}
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none">
                  <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <p className="max-w-[65ch] pb-6 leading-relaxed text-brand-slate">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 9 · Closing CTA band — the search again */}
      <section id="check" aria-labelledby="cta-heading" className="scroll-mt-20 px-4 pb-20 sm:px-6">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-brand-navy px-6 py-14 text-center sm:px-12">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,rgba(216,138,0,0.35)_0%,rgba(216,138,0,0)_60%)]"
          />
          <div className="relative mx-auto grid max-w-2xl gap-6">
            <h2 id="cta-heading" className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl [text-wrap:balance]">
              Know who you’re paying before you pay them.
            </h2>
            <p className="text-[#C9D3E0]">Free report. NSW and ACT builders.</p>
            <HeroSearch source="closing" tone="dark" />
          </div>
        </div>
      </section>
    </>
  );
}
