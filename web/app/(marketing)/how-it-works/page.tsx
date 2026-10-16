import type { Metadata } from 'next';
import { PageHeader, Prose, SearchBand, JsonLd, breadcrumbJsonLd, h2Class, eyebrowClass } from '@/components/marketing/ui';
import { SOURCE_COUNT, SOURCE_GROUPS } from '@/lib/marketing/content';
import { SITE_URL } from '@/lib/marketing/site';

export const metadata: Metadata = {
  title: 'How Know Your Builder works',
  description: `How a free Know Your Builder report is put together: the ${SOURCE_COUNT} official sources we search, how results are matched to the right business, and what a report can't tell you.`,
  alternates: { canonical: '/how-it-works' },
};

const crumbs = [
  { href: '/', label: 'Home' },
  { href: '/how-it-works', label: 'How it works' },
];

export default function HowItWorksPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(SITE_URL, crumbs)} />
      <PageHeader
        eyebrow="How it works"
        title="What happens when you check a builder."
        lead={`Know Your Builder searches ${SOURCE_COUNT} official registers, courts and tribunals at once and puts the results in one report, with every finding linked to its source.`}
        crumbs={crumbs}
      />

      <div className="mx-auto grid max-w-6xl gap-14 px-4 py-14 sm:px-6">
        <Prose>
          <h2>1. You tell us who the builder is</h2>
          <p>
            Enter the business name, ABN or ACN. If you search by name, we look it up on the Australian
            Business Register first and ask you to pick the right business when there’s more than one
            match. That matters: two businesses with similar names can have very different records.
          </p>
          <p>
            You can also add a director’s name on the <a href="/check">full search form</a>. That lets
            us check the person behind the company, including other companies they’ve been involved with.
          </p>

          <h2>2. We search every source at the same time</h2>
          <p>
            Each register is searched directly from its official source, and you can watch them complete
            one by one. Most reports finish within a few minutes. A few registers are slow or briefly
            unavailable at times; when that happens the report says so rather than showing a false
            “nothing found”.
          </p>

          <h2>3. You get one report</h2>
          <p>
            Findings are summarised under five risks: insolvency and financial distress, late payment and
            subcontractor disputes, licensing and regulatory standing, legal proceedings, and corporate
            structure (including phoenix-company warning signs). Each finding links to the record it came
            from, so you can read the original yourself. We ask for
            your email address so we can send you a link to the report.
          </p>
        </Prose>

        <section aria-labelledby="sources-heading" className="grid gap-8">
          <div className="grid max-w-2xl gap-3">
            <p className={eyebrowClass}>Sources</p>
            <h2 id="sources-heading" className={h2Class}>
              The {SOURCE_COUNT} sources in every report
            </h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {SOURCE_GROUPS.map((g) => (
              <div key={g.id} className="grid content-start gap-3 rounded-2xl border border-brand-line bg-white p-6">
                <h3 className="text-lg font-bold text-brand-navy">{g.title}</h3>
                <p className="text-[15px] leading-relaxed text-brand-slate">{g.summary}</p>
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
            ))}
          </div>
        </section>

        <Prose>
          <h2>What a report can’t tell you</h2>
          <ul>
            <li>
              <strong>It only covers NSW and the ACT for licences and courts.</strong> If your builder
              works elsewhere, check the licence on <a href="/check-builder-licence">your state’s register</a>.
            </li>
            <li>
              <strong>Registers lag behind events.</strong> A liquidation or court decision can take days
              or weeks to be published.
            </li>
            <li>
              <strong>Not every dispute reaches a published decision.</strong> Cases that settle, or are
              still running, often don’t appear.
            </li>
            <li>
              <strong>It isn’t a credit check or a quality rating.</strong> A clean report means nothing
              was found in these sources on the day you searched.
            </li>
          </ul>
          <p>
            Before you sign, also check the builder’s home building insurance, ask for references from
            recent clients, and have your contract reviewed.
          </p>

          <h2>About the people named in reports</h2>
          <p>
            Reports only contain information that government bodies, courts and tribunals have already
            published. We show each record as the source publishes it and don’t add our own judgement
            about any person. If you’re named in a report and something is wrong or out of date, our{' '}
            <a href="/privacy">privacy policy</a> explains how to ask us to review it.
          </p>
        </Prose>
      </div>

      <SearchBand />
    </>
  );
}
